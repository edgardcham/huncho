// ask: evaluate a Model, then wrap the canonical answers.

import { wrapAnswers, type Answers } from "./questions.js";
import type { Model, Questions, RawAnswer, State, Usage } from "./types.js";

/**
 * Ask a model some questions about a state and get typed answers back. One
 * model call, no policy, no journal; the building block a huncho is made of.
 *
 * @param model Where the answers come from: `jev()`, `openrouter()`, or anything that implements {@link Model}.
 * @param state What the model judges.
 * @param questions What it is asked, keyed by id. Answer types follow from the question types.
 * @param options `signal` aborts the call; the rejection is the signal's reason.
 * @throws `ProviderError` when the model fails to answer.
 * @throws `AnswerError` when an answer is missing or malformed.
 * @example
 * ```ts
 * import { ask, choice, noul } from "huncho";
 * import { jev } from "huncho/jev";
 *
 * const { answers, usage } = await ask(jev(), "The invoice is overdue and the card was declined twice.", {
 *   urgent: noul("Does this need a human within the hour?"),
 *   topic: choice("What is it about?", ["billing", "bug", "other"]),
 * });
 * answers.urgent.yes;         // true
 * answers.topic.p("billing"); // 0.84
 * usage.inputTokens;          // what the call cost
 * ```
 */
export async function ask<Q extends Questions>(
  model: Model,
  state: State,
  questions: Q,
  options?: { readonly signal?: AbortSignal },
): Promise<{
  /** Typed answers, key for key with `questions`. */
  readonly answers: Answers<Q>;
  /** The canonical answers as the model returned them, for a journal or a fixture. */
  readonly raw: Record<string, RawAnswer>;
  /** Tokens consumed. */
  readonly usage: Usage;
  /** Wall-clock milliseconds for the call. */
  readonly ms: number;
  /** Name of the provider that answered. */
  readonly provider: string;
  /** Id of the model that answered. */
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
