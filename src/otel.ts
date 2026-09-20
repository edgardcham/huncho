/**
 * huncho/otel: one span per decide. The tracer is passed in and typed by shape, so the
 * OpenTelemetry API is never imported and nothing joins the dependency tree.
 *
 * @module huncho/otel
 */

import type { Decision } from "./huncho.js";
import type { Questions } from "./types.js";

/**
 * The part of a `Huncho` that decides: what `withTracing` takes and what it
 * returns. Every `Huncho` is one; the traced value is one too, so it can be
 * decided with or wrapped again, but not built further.
 *
 * @typeParam I What `decide` takes.
 * @typeParam Q The questions asked, so the decision's `answers` are typed.
 * @typeParam D The outcome union `decide` can return.
 * @example
 * ```ts
 * import { huncho, noul, type NoulQuestion, type State } from "huncho";
 * import { jev } from "huncho/jev";
 * import type { Decider } from "huncho/otel";
 *
 * const route = huncho("support.route", { model: jev() })
 *   .ask({ urgent: noul("Does this need a human within the hour?") })
 *   .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
 *   .else("wait");
 *
 * const decider: Decider<State, { urgent: NoulQuestion }, "page" | "wait"> = route;
 * ```
 */
export interface Decider<I, Q extends Questions, D extends string> {
  /** The name given to `huncho()`. The span is named after it. */
  readonly name: string;
  /** Decide, as `Huncho.decide` does. */
  decide(
    input: I,
    options?: {
      readonly key?: string;
      readonly signal?: AbortSignal;
      readonly previous?: string | null;
      readonly parentId?: string;
    },
  ): Promise<Decision<Q, D>>;
}

/**
 * What `withTracing` needs from a span: the four methods it calls, declared
 * as the OpenTelemetry API declares them on its `Span`, so any OpenTelemetry
 * span fits without a cast. `setStatus` receives `{ code: 2 }`, the API's
 * `SpanStatusCode.ERROR`, when `decide` rejects.
 *
 * @example
 * ```ts
 * import type { Span } from "huncho/otel";
 *
 * const attributes: Record<string, string | number | boolean> = {};
 * const span: Span = {
 *   setAttributes: (given) => Object.assign(attributes, given),
 *   recordException: (exception) => console.error(exception),
 *   setStatus: () => {},
 *   end: () => console.log(attributes),
 * };
 * ```
 */
export interface Span {
  /** Record attributes on the span. */
  setAttributes(attributes: Record<string, string | number | boolean>): void;
  /** Record a thrown error on the span. */
  recordException(exception: Error): void;
  /** Set the span's status; `code` `2` is an error. */
  setStatus(status: { readonly code: number; readonly message?: string }): void;
  /** Close the span. */
  end(): void;
}

/**
 * What `withTracing` needs from a tracer: `startActiveSpan`, declared as the
 * OpenTelemetry API declares it on its `Tracer`, so `trace.getTracer("huncho")`
 * fits without a cast. The span it starts is active until `fn` settles, so
 * spans opened inside, by HTTP instrumentation for instance, nest under it.
 *
 * @example
 * ```ts
 * import type { Tracer } from "huncho/otel";
 *
 * const logging: Tracer = {
 *   startActiveSpan(name, fn) {
 *     console.log(`start ${name}`);
 *     return fn({
 *       setAttributes: (attributes) => console.log(name, attributes),
 *       recordException: (exception) => console.error(name, exception),
 *       setStatus: () => {},
 *       end: () => console.log(`end ${name}`),
 *     });
 *   },
 * };
 * ```
 */
export interface Tracer {
  /** Start a span named `name`, run `fn` with it active, and return what `fn` returns. */
  startActiveSpan<T>(name: string, fn: (span: Span) => T): T;
}

/** `SpanStatusCode.ERROR` in the OpenTelemetry API. */
const ERROR = 2;

/**
 * Wrap `decide` in one span per call, named after the huncho. When the
 * decision resolves the span carries `huncho.outcome`, `huncho.provider`,
 * `huncho.model`, `huncho.ms`, `huncho.usage.input_tokens` and
 * `huncho.usage.output_tokens`, the values the `Decision` reports; for a
 * nested decision, `ms` and usage are the root huncho's own call, and the
 * children decide inside the span without spans of their own. When `decide`
 * rejects, the span records the exception and an error status and the
 * rejection passes through unchanged. The span is active for the whole call.
 *
 * The result decides and nothing else: wrap a huncho after its builder chain.
 *
 * @param huncho A `Huncho`, or anything with `name` and `decide`.
 * @param tracer An OpenTelemetry tracer, or anything with `startActiveSpan`.
 * @example
 * ```ts
 * import { huncho, noul } from "huncho";
 * import { jev } from "huncho/jev";
 * import { withTracing, type Tracer } from "huncho/otel";
 *
 * declare const tracer: Tracer; // trace.getTracer("huncho") from the OpenTelemetry API
 *
 * const route = withTracing(
 *   huncho("support.route", { model: jev() })
 *     .ask({ urgent: noul("Does this need a human within the hour?") })
 *     .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
 *     .else("wait"),
 *   tracer,
 * );
 *
 * const decision = await route.decide("Checkout is down.", { key: "T-1041" }); // one span, "support.route"
 * decision.outcome; // "page" | "wait"
 * ```
 */
export function withTracing<I, Q extends Questions, D extends string>(
  huncho: Decider<I, Q, D>,
  tracer: Tracer,
): Decider<I, Q, D> {
  return {
    name: huncho.name,
    decide(input, options) {
      return tracer.startActiveSpan(huncho.name, async (span) => {
        try {
          const decision = await huncho.decide(input, options);
          span.setAttributes(attributes(decision));
          return decision;
        } catch (err) {
          const exception = err instanceof Error ? err : new Error(String(err));
          span.recordException(exception);
          span.setStatus({ code: ERROR, message: exception.message });
          throw err;
        } finally {
          span.end();
        }
      });
    },
  };
}

/** What a decision puts on its span, under the `huncho.` namespace. */
function attributes(decision: Decision): Record<string, string | number> {
  return {
    "huncho.outcome": decision.outcome,
    "huncho.provider": decision.provider,
    "huncho.model": decision.model,
    "huncho.ms": decision.ms,
    "huncho.usage.input_tokens": decision.usage.inputTokens,
    "huncho.usage.output_tokens": decision.usage.outputTokens,
  };
}
