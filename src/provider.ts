// A Provider is a callable factory: provider() or provider(id) returns a Model.
// createProvider wraps an in-process evaluate: timing, usage defaults, provider names.

import type { EvaluateResult, Model, Questions, RawAnswer, State, Usage } from "./types.js";

export interface Provider {
  (id?: string): Model;
  readonly name: string;
  readonly defaultModel: string;
}

export interface CreateProviderOptions {
  readonly name: string;
  /** Used when the provider is called without an id. `"default"` if omitted. */
  readonly defaultModel?: string;
  readonly evaluate: (req: {
    readonly model: string;
    readonly state: State;
    readonly questions: Questions;
    readonly signal?: AbortSignal;
  }) => Promise<{
    readonly answers: Record<string, RawAnswer>;
    readonly usage?: Usage;
    readonly requestId?: string;
  }>;
}

export function createProvider(options: CreateProviderOptions): Provider {
  const defaultModel = options.defaultModel ?? "default";
  return makeProvider(options.name, defaultModel, (id) => ({
    provider: options.name,
    id,
    async evaluate(req): Promise<EvaluateResult> {
      const started = Date.now();
      const evaluated = await options.evaluate({
        model: id,
        state: req.state,
        questions: req.questions,
        ...(req.signal !== undefined ? { signal: req.signal } : {}),
      });
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

export function makeProvider(name: string, defaultModel: string, model: (id: string) => Model): Provider {
  const call = (id?: string): Model => model(id ?? defaultModel);
  Object.defineProperty(call, "name", { value: name });
  Object.defineProperty(call, "defaultModel", { value: defaultModel });
  return call as Provider;
}
