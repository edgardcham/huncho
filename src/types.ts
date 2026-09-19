// Model seam: the one method every layer above calls.
// Transport, wires and providers implement this contract in later tickets.

/**
 * JSON-serialisable value a question can carry as instructions or criteria.
 *
 * @example
 * ```ts
 * import type { Content } from "huncho";
 *
 * const rubric: Content = { tone: "formal", limit: 200, tags: ["billing", "refund"] };
 * ```
 */
export type Content =
  | string
  | number
  | boolean
  | null
  | readonly Content[]
  | { readonly [key: string]: Content };

/**
 * What a model evaluates: a string, an object, or an array. When a decision is
 * journaled, its `stateHash` is taken over stable JSON, so key order does not matter.
 *
 * @example
 * ```ts
 * import type { State } from "huncho";
 *
 * const text: State = "The invoice is overdue and the card was declined twice.";
 * const record: State = { subject: "Checkout is down", body: "Every customer gets a 500." };
 * ```
 */
export type State = string | Record<string, unknown> | readonly unknown[];

/**
 * Probability of yes. Build one with {@link noul}; write it out when a question
 * is data rather than code.
 *
 * @example
 * ```ts
 * import type { NoulQuestion } from "huncho";
 *
 * const urgent: NoulQuestion = {
 *   type: "noul",
 *   instructions: "Does this need a human within the hour?",
 *   criteria: { true: "Money or access is blocked now.", false: "It can wait until tomorrow." },
 * };
 * ```
 */
export interface NoulQuestion {
  /** Discriminant. */
  readonly type: "noul";
  /** What the model is asked. */
  readonly instructions: Content;
  /** What counts as yes and what counts as no, when the instructions alone leave room. */
  readonly criteria?: {
    /** What a yes looks like. */
    readonly true?: Content;
    /** What a no looks like. */
    readonly false?: Content;
  };
}

/**
 * One of a named set. `L` is the union of labels, so an answer's `choice` and
 * `p(label)` are typed to the set. Build one with {@link choice}.
 *
 * @example
 * ```ts
 * import type { ChoiceQuestion } from "huncho";
 *
 * const topic: ChoiceQuestion<"billing" | "bug" | "other"> = {
 *   type: "choice",
 *   instructions: "What is it about?",
 *   criteria: { billing: "Money, invoices, refunds.", bug: "Something is broken.", other: null },
 * };
 * ```
 */
export interface ChoiceQuestion<L extends string = string> {
  /** Discriminant. */
  readonly type: "choice";
  /** What the model is asked. */
  readonly instructions: Content;
  /** One entry per label. The value describes the label, or is `null` when the name is enough. */
  readonly criteria: { readonly [K in L]: Content | null };
}

/**
 * A position on an ordered rubric, lowest level first. At least two levels.
 * Build one with {@link score}.
 *
 * @example
 * ```ts
 * import type { ScoreQuestion } from "huncho";
 *
 * const quality: ScoreQuestion = {
 *   type: "score",
 *   instructions: "How complete is the answer?",
 *   criteria: ["Misses the question", "Partly answers it", "Answers it fully"],
 * };
 * ```
 */
export interface ScoreQuestion {
  /** Discriminant. */
  readonly type: "score";
  /** What the model is asked. */
  readonly instructions: Content;
  /** The levels in order, index 0 lowest. */
  readonly criteria: readonly Content[];
}

/**
 * Any of the three question types.
 *
 * @example
 * ```ts
 * import { noul, type Question } from "huncho";
 *
 * const question: Question = noul("Does this need a human within the hour?");
 * question.type; // "noul" | "choice" | "score"
 * ```
 */
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/**
 * A record of questions keyed by id. The ids are the keys of the answers that come back.
 *
 * @example
 * ```ts
 * import { choice, noul, type Questions } from "huncho";
 *
 * const questions: Questions = {
 *   urgent: noul("Does this need a human within the hour?"),
 *   topic: choice("What is it about?", ["billing", "bug", "other"]),
 * };
 * ```
 */
export type Questions = Record<string, Question>;

/**
 * Canonical noul answer as a model returns it. `noul` is in 0..1.
 *
 * @example
 * ```ts
 * import type { RawNoulAnswer } from "huncho";
 *
 * const answer: RawNoulAnswer = { type: "noul", noul: 0.91 };
 * ```
 */
export interface RawNoulAnswer {
  /** Discriminant. */
  readonly type: "noul";
  /** Probability of yes, 0..1. */
  readonly noul: number;
}

/**
 * Canonical choice answer as a model returns it. `probabilities` sums to about 1
 * and `choice` is its argmax.
 *
 * @example
 * ```ts
 * import type { RawChoiceAnswer } from "huncho";
 *
 * const answer: RawChoiceAnswer = {
 *   type: "choice",
 *   choice: "billing",
 *   probabilities: { billing: 0.84, bug: 0.1, other: 0.06 },
 *   confidence: 0.84,
 * };
 * ```
 */
export interface RawChoiceAnswer {
  /** Discriminant. */
  readonly type: "choice";
  /** The label with the highest probability. */
  readonly choice: string;
  /** Probability per label. Sums to about 1. */
  readonly probabilities: Record<string, number>;
  /** Probability of `choice`. */
  readonly confidence: number;
}

/**
 * Canonical score answer as a model returns it. `probabilities` is keyed by level
 * index as a string and sums to about 1.
 *
 * @example
 * ```ts
 * import type { RawScoreAnswer } from "huncho";
 *
 * const answer: RawScoreAnswer = {
 *   type: "score",
 *   score: 1.8,
 *   probabilities: { "0": 0.05, "1": 0.15, "2": 0.8 },
 *   confidence: 0.8,
 * };
 * ```
 */
export interface RawScoreAnswer {
  /** Discriminant. */
  readonly type: "score";
  /** Expected level, 0..levels-1. Fractional when the model hedges between levels. */
  readonly score: number;
  /** Probability per level index, keyed as a string. Sums to about 1. */
  readonly probabilities: Record<string, number>;
  /** Probability of the nearest level. */
  readonly confidence: number;
  /** Level index to level description, when the provider echoes the rubric. */
  readonly legend?: Record<string, string>;
}

/**
 * Any canonical answer. The `type` field matches the question that was asked.
 *
 * @example
 * ```ts
 * import type { RawAnswer } from "huncho";
 *
 * function probability(answer: RawAnswer): number {
 *   return answer.type === "noul" ? answer.noul : answer.confidence;
 * }
 * ```
 */
export type RawAnswer = RawNoulAnswer | RawChoiceAnswer | RawScoreAnswer;

/**
 * Tokens a model call consumed, as the provider reports them.
 *
 * @example
 * ```ts
 * import type { Usage } from "huncho";
 *
 * const usage: Usage = { inputTokens: 412, outputTokens: 38 };
 * usage.inputTokens + usage.outputTokens; // 450
 * ```
 */
export interface Usage {
  /** Tokens in the request. */
  readonly inputTokens: number;
  /** Tokens in the response. */
  readonly outputTokens: number;
}

/**
 * What a {@link Model} is asked: the state to judge and the questions to answer.
 *
 * @example
 * ```ts
 * import { noul, type EvaluateRequest } from "huncho";
 *
 * const request: EvaluateRequest = {
 *   state: "Checkout is down for every customer.",
 *   questions: { urgent: noul("Does this need a human within the hour?") },
 *   signal: AbortSignal.timeout(10_000),
 * };
 * ```
 */
export interface EvaluateRequest {
  /** What the model judges. */
  readonly state: State;
  /** What it is asked, keyed by id. */
  readonly questions: Questions;
  /** Abort the call. The rejection is the signal's reason, not a `ProviderError`. */
  readonly signal?: AbortSignal;
}

/**
 * What a {@link Model} returns: one canonical answer per question, plus cost and provenance.
 *
 * @example
 * ```ts
 * import { noul, type EvaluateResult } from "huncho";
 * import { jev } from "huncho/jev";
 *
 * const result: EvaluateResult = await jev().evaluate({
 *   state: "Checkout is down for every customer.",
 *   questions: { urgent: noul("Does this need a human within the hour?") },
 * });
 * result.answers.urgent?.type; // "noul"
 * result.ms;                   // wall-clock milliseconds
 * ```
 */
export interface EvaluateResult {
  /** Name of the provider that answered, as in `Model.provider`. */
  readonly provider: string;
  /** Id of the model that answered, as in `Model.id`. */
  readonly model: string;
  /**
   * Canonical answers, one per question. Keys are exactly the keys of
   * `EvaluateRequest.questions`.
   */
  readonly answers: Record<string, RawAnswer>;
  /** Tokens consumed. Zero when the provider does not report usage. */
  readonly usage: Usage;
  /** Wall-clock milliseconds for the call. */
  readonly ms: number;
  /** The vendor's request id, when the response carried one. */
  readonly requestId?: string;
}

/**
 * A decision model. One method; adapters hide HTTP, auth, retries and dialects.
 * Get one from a provider (`jev()`, `openrouter("id")`) or {@link createProvider};
 * implement it directly when you need full control.
 *
 * `evaluate` rejects with a `ProviderError` (`provider`, `retryable`, optional
 * `status`, `requestId`, `body`, `cause`). Never a bare fetch error.
 *
 * @example
 * ```ts
 * import { ask, noul, type Model, type RawAnswer } from "huncho";
 *
 * const alwaysYes: Model = {
 *   provider: "constant",
 *   id: "yes",
 *   async evaluate({ questions }) {
 *     const answers: Record<string, RawAnswer> = {};
 *     for (const id of Object.keys(questions)) answers[id] = { type: "noul", noul: 1 };
 *     return { provider: "constant", model: "yes", answers, usage: { inputTokens: 0, outputTokens: 0 }, ms: 0 };
 *   },
 * };
 *
 * const { answers } = await ask(alwaysYes, "anything", { ok: noul("Is it fine?") });
 * answers.ok.yes; // true
 * ```
 */
export interface Model {
  /** Provider name, reported on every decision and journal record. */
  readonly provider: string;
  /** Model id, reported on every decision and journal record. */
  readonly id: string;
  /**
   * Judge `state` against `questions`.
   *
   * @throws `ProviderError` when the model fails to answer; `retryable` says whether trying again can help.
   */
  evaluate(req: EvaluateRequest): Promise<EvaluateResult>;
}
