// ask: evaluate a Model, then wrap the canonical answers.

import { wrapAnswers, type Answers } from "./questions.js";
import type { Model, Questions, RawAnswer, State, Usage } from "./types.js";

export async function ask<Q extends Questions>(
  model: Model,
  state: State,
  questions: Q,
  options?: { readonly signal?: AbortSignal },
): Promise<{
  readonly answers: Answers<Q>;
  readonly raw: Record<string, RawAnswer>;
  readonly usage: Usage;
  readonly ms: number;
  readonly provider: string;
  readonly model: string;
}> {
  const result = await model.evaluate({
    state,
    questions,
    ...(options?.signal !== undefined ? { signal: options.signal } : {}),
  });
  return {
    answers: wrapAnswers(result.answers, questions),
    raw: result.answers,
    usage: result.usage,
    ms: result.ms,
    provider: result.provider,
    model: result.model,
  };
}
