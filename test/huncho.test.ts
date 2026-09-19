import { test } from "node:test";
import assert from "node:assert/strict";
import {
  huncho,
  memoryJournal,
  noul,
  sha256,
  stableStringify,
  type RawAnswer,
} from "../src/index.js";
import { scriptedModel } from "huncho/testing";

const questions = {
  urgent: noul("Does this need a human within the hour?"),
};

function answers(noul: number): Record<string, RawAnswer> {
  return { urgent: { type: "noul", noul } };
}

function route(
  model: ReturnType<typeof scriptedModel>["model"],
  journal?: ReturnType<typeof memoryJournal>,
) {
  const built = huncho("support.route", journal === undefined ? { model } : { model, journal })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
    .else("wait");
  return built;
}

test("shape output is exactly what the model receives", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }]);
  const input = { subject: "invoice", secret: "card-number" };
  const built = huncho("support.route", { model })
    .shape((ticket: typeof input) => ({ subject: ticket.subject }))
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "page")
    .else("wait");

  const decision = await built.decide(input);
  assert.deepEqual(requests[0]?.state, { subject: "invoice" });
  assert.equal(requests[0]?.questions, questions);
  assert.deepEqual(decision.state, { subject: "invoice" });
  assert.equal("secret" in (requests[0]?.state as object), false);
});

test("without shape the input is the state the model sees", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }]);
  const state = { subject: "invoice", body: "overdue" };
  await route(model).decide(state);
  assert.equal(requests[0]?.state, state);
});

test("hysteresis holds across decide calls with the same key and not across keys", async () => {
  const { model } = scriptedModel([
    { answers: answers(0.91) },
    { answers: answers(0.7) },
    { answers: answers(0.7) },
    { answers: answers(0.5) },
  ]);
  const built = route(model);

  const first = await built.decide("one", { key: "ticket-1" });
  const held = await built.decide("two", { key: "ticket-1" });
  const other = await built.decide("three", { key: "ticket-2" });
  const dropped = await built.decide("four", { key: "ticket-1" });

  assert.equal(first.outcome, "page");
  assert.equal(first.previous, undefined);
  assert.equal(held.outcome, "page");
  assert.equal(held.previous, "page");
  assert.equal(other.outcome, "wait");
  assert.equal(other.previous, undefined);
  assert.equal(dropped.outcome, "wait");
  assert.equal(dropped.previous, "page");
});

test("decide writes one journal record with the outcome, key and hashes", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }, { answers: answers(0.7) }]);
  const journal = memoryJournal();
  const built = route(model, journal);
  const state = { subject: "invoice" };

  const first = await built.decide(state, { key: "ticket-1" });
  const second = await built.decide({ subject: "follow-up" }, { key: "ticket-1" });
  const records = await journal.read();

  assert.equal(records.length, 2);
  const expectedFirst = {
    huncho: "support.route",
    key: "ticket-1",
    provider: "scripted",
    model: "scripted",
    stateHash: await sha256(stableStringify(state)),
    questionsHash: await sha256(stableStringify(questions)),
    answers: answers(0.91),
    outcome: "page",
    path: ["page"],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  assert.equal(records[0]?.t.includes("T"), true);
  assert.equal(Number.isNaN(Date.parse(records[0]?.t ?? "")), false);
  assert.equal(records[0]?.state, undefined);
  assert.deepEqual(
    {
      huncho: records[0]?.huncho,
      key: records[0]?.key,
      provider: records[0]?.provider,
      model: records[0]?.model,
      stateHash: records[0]?.stateHash,
      questionsHash: records[0]?.questionsHash,
      answers: records[0]?.answers,
      outcome: records[0]?.outcome,
      path: records[0]?.path,
      usage: records[0]?.usage,
    },
    expectedFirst,
  );
  assert.equal(records[0]?.previous, undefined);
  assert.equal(records[1]?.outcome, "page");
  assert.equal(records[1]?.previous, "page");
  assert.equal(records[1]?.key, "ticket-1");
  assert.deepEqual(first.path, ["page"]);
  assert.equal(first.stateHash, expectedFirst.stateHash);
  assert.equal(first.outcome, "page");
  assert.equal(second.outcome, "page");
  assert.equal(second.previous, "page");
  assert.equal(second.key, "ticket-1");
});

test("decide defaults the hysteresis key to default", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }]);
  const journal = memoryJournal();
  const decision = await route(model, journal).decide("plain");
  const records = await journal.read();
  assert.equal(decision.key, "default");
  assert.equal(records[0]?.key, "default");
});

test("an abort signal reaches the model", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }]);
  const signal = new AbortController().signal;
  await route(model).decide("plain", { signal });
  assert.equal(requests[0]?.signal, signal);
});

test("evaluate asks the model and skips policy, memory and the journal", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }, { answers: answers(0.7) }]);
  const journal = memoryJournal();
  const built = huncho("support.route", { model, journal })
    .shape((ticket: { subject: string; secret: string }) => ({ subject: ticket.subject }))
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
    .else("wait");

  const evaluated = await built.evaluate({ subject: "invoice", secret: "hidden" });
  assert.deepEqual(requests[0]?.state, { subject: "invoice" });
  assert.deepEqual(evaluated.state, { subject: "invoice" });
  assert.equal(evaluated.answers.urgent.p, 0.91);
  assert.equal(evaluated.raw.urgent?.type, "noul");
  assert.deepEqual(evaluated.usage, { inputTokens: 0, outputTokens: 0 });
  assert.equal(Number.isFinite(evaluated.ms) && evaluated.ms >= 0, true);
  assert.equal((await journal.read()).length, 0);

  const decision = await built.decide({ subject: "later", secret: "hidden" }, { key: "ticket-1" });
  assert.equal(decision.outcome, "wait");
  assert.equal(decision.previous, undefined);
  assert.equal((await journal.read()).length, 1);
});

test("builder methods return new values and leave the previous policy untouched", async () => {
  const { model } = scriptedModel([{ answers: answers(0.1) }, { answers: answers(0.1) }]);
  const asked = huncho("support.route", { model }).ask(questions);
  const paged = asked.when((a) => a.urgent.p, { enter: 0.8 }, "page");
  const complete = paged.else("wait");

  assert.notEqual(asked, paged);
  assert.notEqual(paged, complete);
  await assert.rejects(
    () => paged.decide("plain"),
    (err: unknown) => {
      assert.equal((err as Error).message, 'no outcome for policy "support.route"');
      return true;
    },
  );
  assert.equal((await complete.decide("plain")).outcome, "wait");
});

test("ask after when starts a new policy for the new questions", async () => {
  const { model } = scriptedModel([{ answers: { mood: { type: "noul", noul: 0.91 } } }]);
  const built = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "page")
    .ask({ mood: noul("Is the customer upset?") })
    .else("wait");

  const decision = await built.decide("plain");
  assert.equal(decision.outcome, "wait");
});

test("forked builders do not share hysteresis memory", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }, { answers: answers(0.7) }]);
  const root = huncho("support.route", { model }).ask(questions);
  const left = root.when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page").else("wait");
  const right = root.when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page").else("wait");

  assert.equal((await left.decide("one", { key: "ticket-1" })).outcome, "page");
  const other = await right.decide("two", { key: "ticket-1" });
  assert.equal(other.outcome, "wait");
  assert.equal(other.previous, undefined);
});

test("overlapping decide calls on one key run in order", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }, { answers: answers(0.7) }]);
  const built = route(model);
  const [first, second] = await Promise.all([
    built.decide("one", { key: "ticket-1" }),
    built.decide("two", { key: "ticket-1" }),
  ]);
  assert.equal(first.outcome, "page");
  assert.equal(first.previous, undefined);
  assert.equal(second.outcome, "page");
  assert.equal(second.previous, "page");
});

test("decide without ask names the huncho", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }]);
  await assert.rejects(
    () => huncho("support.route", { model }).decide("plain"),
    (err: unknown) => {
      assert.equal((err as Error).message, 'huncho "support.route" has no questions');
      return true;
    },
  );
});
