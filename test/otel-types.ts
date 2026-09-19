import { huncho, noul, type Decision, type NoulQuestion, type State } from "../src/index.js";
import { withTracing, type Decider, type Span, type Tracer } from "huncho/otel";
import { scriptedModel } from "huncho/testing";

// The shapes `@opentelemetry/api` declares for `Tracer` and `Span`, reduced to what
// matters for assignability: the overloads, the generics, the enum and the `this` returns.
// A tracer typed like this must be accepted without a cast.

declare enum SpanStatusCode {
  UNSET = 0,
  OK = 1,
  ERROR = 2,
}
type Attributes = { [key: string]: string | number | boolean | undefined };
type SpanStatus = { code: SpanStatusCode; message?: string };
type Exception = string | { message: string; name?: string; stack?: string } | { name: string } | { code: string | number };
type TimeInput = number | Date | [number, number];
interface OtelSpanContext {
  traceId: string;
  spanId: string;
}
interface OtelSpan {
  spanContext(): OtelSpanContext;
  setAttribute(key: string, value: string | number | boolean): this;
  setAttributes(attributes: Attributes): this;
  addEvent(name: string, attributes?: Attributes, startTime?: TimeInput): this;
  setStatus(status: SpanStatus): this;
  updateName(name: string): this;
  end(endTime?: TimeInput): void;
  isRecording(): boolean;
  recordException(exception: Exception, time?: TimeInput): void;
}
interface OtelSpanOptions {
  kind?: number;
  attributes?: Attributes;
}
interface OtelContext {
  getValue(key: symbol): unknown;
}
interface OtelTracer {
  startSpan(name: string, options?: OtelSpanOptions, context?: OtelContext): OtelSpan;
  startActiveSpan<F extends (span: OtelSpan) => unknown>(name: string, fn: F): ReturnType<F>;
  startActiveSpan<F extends (span: OtelSpan) => unknown>(name: string, options: OtelSpanOptions, fn: F): ReturnType<F>;
  startActiveSpan<F extends (span: OtelSpan) => unknown>(
    name: string,
    options: OtelSpanOptions,
    context: OtelContext,
    fn: F,
  ): ReturnType<F>;
}

declare const otelTracer: OtelTracer;
declare const otelSpan: OtelSpan;
const { model } = scriptedModel([{ answers: {} }]);

const route = huncho("support.route", { model })
  .shape((ticket: { id: string }) => ticket.id)
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
  .else("wait");

async function prove() {
  const tracer: Tracer = otelTracer;
  const span: Span = otelSpan;
  void span;

  const traced = withTracing(route, tracer);
  const decision = await traced.decide({ id: "ticket-1" });
  const outcome: "page" | "wait" = decision.outcome;
  const p: number = decision.answers.urgent.p;
  void outcome;
  void p;

  // @ts-expect-error — the traced decide keeps the shape's input type
  await traced.decide("plain");

  // @ts-expect-error — the outcome union survives wrapping
  const onlyPage: "page" = decision.outcome;
  void onlyPage;

  // @ts-expect-error — the traced value decides and nothing else
  traced.when((a) => a.urgent.p, { enter: 0.9 }, "page");

  const again = withTracing(traced, tracer);
  const decider: Decider<{ id: string }, { urgent: NoulQuestion }, "page" | "wait"> = again;
  void decider;

  // @ts-expect-error — a tracer without startActiveSpan is not a tracer
  withTracing(route, { startSpan: otelTracer.startSpan });

  const plain: Decider<State, Record<string, never>, never> = huncho("support.route", { model });
  void plain;

  const hooked = huncho("support.route", {
    model,
    onDecision: (decision: Decision) => {
      const name: string = decision.huncho;
      void name;
    },
  });
  void hooked;

  // @ts-expect-error — the hook takes a Decision
  huncho("support.route", { model, onDecision: (n: number) => n });
}

void prove;
