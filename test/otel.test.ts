import { test } from "node:test";
import assert from "node:assert/strict";
import { huncho, noul, PolicyError, type Decision } from "../src/index.js";
import { withTracing, type Span, type Tracer } from "huncho/otel";
import { scriptedModel } from "huncho/testing";

type Recorded = {
  readonly name: string;
  readonly attributes: Record<string, string | number | boolean>;
  readonly exceptions: Error[];
  status: { readonly code: number; readonly message?: string } | undefined;
  ended: number;
  /** Whether `end` ran after `decide` settled, as the tracer observes it. */
  endedAfterSettle: boolean;
};

/** A tracer that keeps every span it starts and notes whether each was still open when its callback settled. */
function fakeTracer(): { tracer: Tracer; spans: Recorded[] } {
  const spans: Recorded[] = [];
  const tracer: Tracer = {
    startActiveSpan(name, fn) {
      const recorded: Recorded = { name, attributes: {}, exceptions: [], status: undefined, ended: 0, endedAfterSettle: false };
      spans.push(recorded);
      const span: Span = {
        setAttributes(attributes) {
          Object.assign(recorded.attributes, attributes);
        },
        recordException(exception) {
          recorded.exceptions.push(exception);
        },
        setStatus(status) {
          recorded.status = status;
        },
        end() {
          recorded.ended += 1;
        },
      };
      const result = fn(span);
      void Promise.resolve(result).then(
        () => {
          recorded.endedAfterSettle = recorded.ended === 1;
        },
        () => {
          recorded.endedAfterSettle = recorded.ended === 1;
        },
      );
      return result;
    },
  };
  return { tracer, spans };
}

const questions = { urgent: noul("Does this need a human within the hour?") };

function route(model: ReturnType<typeof scriptedModel>["model"]) {
  return huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
    .else("wait");
}

test("withTracing records one span per decide, named after the huncho, with the decision's attributes", async () => {
  const { model } = scriptedModel([{ answers: { urgent: { type: "noul", noul: 0.91 } } }]);
  const { tracer, spans } = fakeTracer();
  const traced = withTracing(route(model), tracer);

  assert.equal(traced.name, "support.route");
  const first = await traced.decide("Checkout is down.", { key: "T-1" });
  const second = await traced.decide("Still down.", { key: "T-1" });

  assert.equal(first.outcome, "page");
  assert.equal(second.previous, "page");
  assert.equal(spans.length, 2);
  for (const span of spans) {
    assert.equal(span.name, "support.route");
    assert.deepEqual(span.attributes, {
      "huncho.outcome": "page",
      "huncho.provider": "scripted",
      "huncho.model": "scripted",
      "huncho.ms": 0,
      "huncho.usage.input_tokens": 0,
      "huncho.usage.output_tokens": 0,
    });
    assert.deepEqual(span.exceptions, []);
    assert.equal(span.status, undefined);
    assert.equal(span.ended, 1);
    assert.equal(span.endedAfterSettle, true);
  }
});

test("withTracing passes input and options through and resolves with the decision decide returns", async () => {
  const { model, requests } = scriptedModel([{ answers: { urgent: { type: "noul", noul: 0.91 } } }]);
  const { tracer } = fakeTracer();
  const seen: Decision[] = [];
  const built = huncho("support.route", { model, onDecision: (decision) => seen.push(decision) })
    .ask(questions)
    .else("wait");
  const signal = new AbortController().signal;

  const decision = await withTracing(built, tracer).decide("plain", { key: "T-1", signal });

  assert.equal(requests[0]?.state, "plain");
  assert.equal(requests[0]?.signal, signal);
  assert.equal(decision.key, "T-1");
  assert.equal(seen[0], decision);
});

test("a rejected decide records the exception and an error status, ends the span, and rethrows", async () => {
  const { model } = scriptedModel([{ answers: { urgent: { type: "noul", noul: 0.1 } } }]);
  const { tracer, spans } = fakeTracer();
  const traced = withTracing(
    huncho("support.route", { model })
      .ask(questions)
      .when((a) => a.urgent.p, { enter: 0.8 }, "page"),
    tracer,
  );

  await assert.rejects(
    () => traced.decide("plain"),
    (err: unknown) => {
      assert.equal(PolicyError.isInstance(err), true);
      assert.equal(spans[0]?.exceptions[0], err);
      assert.equal(spans[0]?.status?.code, 2);
      assert.equal(spans[0]?.status?.message, (err as Error).message);
      return true;
    },
  );
  assert.equal(spans.length, 1);
  assert.deepEqual(spans[0]?.attributes, {});
  assert.equal(spans[0]?.ended, 1);
  assert.equal(spans[0]?.endedAfterSettle, true);
});

test("a nested decision is one span whose attributes are the root's", async () => {
  const { model } = scriptedModel([
    { answers: { urgent: { type: "noul", noul: 0.91 } } },
    { answers: { human: { type: "noul", noul: 0.88 } } },
  ]);
  const { tracer, spans } = fakeTracer();
  const child = huncho("support.escalate", { model })
    .ask({ human: noul("Should a person take this?") })
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: child });

  const decision = await withTracing(parent, tracer).decide("plain");

  assert.deepEqual(decision.path, ["escalate", "page"]);
  assert.equal(spans.length, 1);
  assert.equal(spans[0]?.name, "support.route");
  assert.equal(spans[0]?.attributes["huncho.outcome"], "page");
});
