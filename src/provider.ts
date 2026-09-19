// A Provider is a callable factory: provider() or provider(id) returns a Model.
// createProvider wraps an in-process evaluate: timing, usage defaults, names, ProviderError.

import { HunchoError, ProviderError, see } from "./errors.js";
import type { EvaluateResult, Model, Questions, RawAnswer, State, Usage } from "./types.js";

/**
 * A callable factory for models: `provider()` is the default model,
 * `provider("id")` another. Nothing is read from the environment until the
 * first call, so importing a provider is free and a missing key fails where
 * the model is made, not at import.
 *
 * @example
 * ```ts
 * import { huncho, noul, type Provider } from "huncho";
 * import { jev } from "huncho/jev";
 *
 * function route(provider: Provider) {
 *   return huncho("support.route", { model: provider() })
 *     .ask({ urgent: noul("Does this need a human within the hour?") })
 *     .else("wait");
 * }
 *
 * route(jev);
 * jev.name;         // "jev"
 * jev.defaultModel; // "jev-latest"
 * ```
 */
export interface Provider {
  /**
   * A model. With no `id`, the provider's `defaultModel`.
   *
   * @throws `ConfigError` when the provider's key is neither passed nor in the environment.
   */
  (id?: string): Model;
  /** Provider name, reported as `Model.provider` on every decision. */
  readonly name: string;
  /** Model id used when called with no argument. */
  readonly defaultModel: string;
}

/**
 * What `createProvider` needs: a name and one function that answers questions.
 *
 * @example
 * ```ts
 * import type { CreateProviderOptions } from "huncho";
 *
 * const options: CreateProviderOptions = {
 *   name: "coin",
 *   evaluate: async ({ questions }) => ({
 *     answers: Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "noul", noul: 0.5 }])),
 *   }),
 * };
 * ```
 */
export interface CreateProviderOptions {
  /** Provider name, reported as `Model.provider` and on every journal record. */
  readonly name: string;
  /** Used when the provider is called without an id. `"default"` if omitted. */
  readonly defaultModel?: string;
  /**
   * Answer the questions. Return one canonical answer per question id; timing
   * is measured around the call, and anything thrown that is not already a
   * `HunchoError` is wrapped in a `ProviderError`.
   */
  readonly evaluate: (req: {
    /** The model id the provider was called with. */
    readonly model: string;
    /** What to judge. */
    readonly state: State;
    /** What to answer, keyed by id. */
    readonly questions: Questions;
    /** Abort the call. */
    readonly signal?: AbortSignal;
  }) => Promise<{
    /** One canonical answer per question id. */
    readonly answers: Record<string, RawAnswer>;
    /** Tokens consumed. Zero when omitted. */
    readonly usage?: Usage;
    /** The vendor's request id, when there is one. */
    readonly requestId?: string;
  }>;
}

/**
 * Make a provider from any function that answers questions: an in-process
 * model, a vendor without a wire yet, a wrapper that caches. The result times
 * every call, defaults usage to zero, and turns a thrown error into a
 * `ProviderError` with `retryable: false` unless it already is a `HunchoError`;
 * an abort is rethrown as the signal's reason.
 *
 * @example
 * ```ts
 * import { ask, createProvider, noul } from "huncho";
 *
 * const keyword = createProvider({
 *   name: "keyword",
 *   evaluate: async ({ state, questions }) => {
 *     const hit = typeof state === "string" && /down|outage|500/.test(state) ? 0.95 : 0.05;
 *     return { answers: Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "noul", noul: hit }])) };
 *   },
 * });
 *
 * const { answers } = await ask(keyword(), "Checkout is down.", { urgent: noul("Does this need a human within the hour?") });
 * answers.urgent.yes; // true
 * ```
 */
export function createProvider(options: CreateProviderOptions): Provider {
  const defaultModel = options.defaultModel ?? "default";
  return makeProvider(options.name, defaultModel, (id) => ({
    provider: options.name,
    id,
    async evaluate(req): Promise<EvaluateResult> {
      const started = Date.now();
      let evaluated;
      try {
        evaluated = await options.evaluate({
          model: id,
          state: req.state,
          questions: req.questions,
          ...(req.signal !== undefined ? { signal: req.signal } : {}),
        });
      } catch (cause) {
        if (req.signal?.aborted) throw req.signal.reason ?? cause;
        if (HunchoError.isInstance(cause)) throw cause;
        throw new ProviderError(
          `${options.name}: evaluate threw, ${see("docs/providers.md#custom-provider")}`,
          { provider: options.name, retryable: false, cause },
        );
      }
      return {
        provider: options.name,
        model: id,
        answers: evaluated.answers,
        usage: evaluated.usage ?? { inputTokens: 0, outputTokens: 0 },
        ms: Date.now() - started,
        ...(evaluated.requestId !== undefined ? { requestId: evaluated.requestId } : {}),
      };
    },
  }));
}

/** The callable-with-properties shape every provider factory returns. Internal to the provider adapters. */
export function makeProvider(name: string, defaultModel: string, model: (id: string) => Model): Provider {
  const call = (id?: string): Model => model(id ?? defaultModel);
  Object.defineProperty(call, "name", { value: name });
  Object.defineProperty(call, "defaultModel", { value: defaultModel });
  return call as Provider;
}
