// Questions and Answers: builders and typed wrappers over canonical raw answers.

import { AnswerError, ConfigError, see } from "./errors.js";
import type {
  ChoiceQuestion,
  Content,
  NoulQuestion,
  Question,
  Questions,
  RawAnswer,
  RawChoiceAnswer,
  RawNoulAnswer,
  RawScoreAnswer,
  ScoreQuestion,
} from "./types.js";

/**
 * Probability of yes. The answer is `p` in 0..1 and `yes`, true from 0.5 up.
 *
 * @param instructions What the model is asked.
 * @param criteria What counts as yes and what counts as no, when the instructions alone leave room.
 * @example
 * ```ts
 * import { ask, noul } from "huncho";
 * import { jev } from "huncho/jev";
 *
 * const { answers } = await ask(jev(), "The invoice is overdue and the card was declined twice.", {
 *   urgent: noul("Does this need a human within the hour?", {
 *     true: "Money or access is blocked now.",
 *     false: "It can wait until tomorrow.",
 *   }),
 * });
 * answers.urgent.p;   // 0.91
 * answers.urgent.yes; // true
 * ```
 */
export function noul(
  instructions: Content,
  criteria?: NoulQuestion["criteria"],
): NoulQuestion {
  return criteria === undefined
    ? { type: "noul", instructions }
    : { type: "noul", instructions, criteria };
}

/**
 * One of a named set. Labels come from the record keys or from a list, and the
 * answer's `choice`, `p(label)` and `is(label)` are typed to them, so a label
 * that was never offered is a compile error.
 *
 * @param instructions What the model is asked.
 * @param criteria A list of labels, or a record from label to a description (`null` when the name is enough).
 * @example
 * ```ts
 * import { ask, choice } from "huncho";
 * import { jev } from "huncho/jev";
 *
 * const { answers } = await ask(jev(), "The invoice is overdue and the card was declined twice.", {
 *   topic: choice("What is it about?", ["billing", "bug", "other"]),
 *   tone: choice("How does the customer sound?", { calm: null, upset: "Threatens to leave or escalate." }),
 * });
 * answers.topic.choice;       // "billing"
 * answers.topic.p("billing"); // 0.84
 * answers.tone.is("upset", 0.7);
 * ```
 */
export function choice<const L extends string>(
  instructions: Content,
  criteria: { readonly [K in L]: Content | null } | readonly L[],
): ChoiceQuestion<L> {
  const record = isLabelList(criteria)
    ? (Object.fromEntries(criteria.map((label) => [label, null])) as {
        readonly [K in L]: Content | null;
      })
    : criteria;
  return { type: "choice", instructions, criteria: record };
}

/**
 * A position on an ordered rubric, lowest level first. The answer's `score` is
 * the expected level index, `ratio` scales it to 0..1 and `level` rounds it.
 *
 * @param instructions What the model is asked.
 * @param levels The rubric in order, index 0 lowest. At least two.
 * @throws `ConfigError` when fewer than two levels are given.
 * @example
 * ```ts
 * import { ask, score } from "huncho";
 * import { jev } from "huncho/jev";
 *
 * const { answers } = await ask(jev(), "Q: Why is the sky blue? A: Rayleigh scattering favours short wavelengths.", {
 *   quality: score("How complete is the answer?", ["Misses the question", "Partly answers it", "Answers it fully"]),
 * });
 * answers.quality.score; // 1.8
 * answers.quality.level; // 2
 * answers.quality.ratio; // 0.9
 * ```
 */
export function score(instructions: Content, levels: readonly Content[]): ScoreQuestion {
  if (levels.length < 2) {
    throw new ConfigError(`score() needs at least two levels, ${see("README.md#ask-a-question")}`);
  }
  return { type: "score", instructions, criteria: levels };
}

/**
 * Typed answer to a {@link noul} question.
 *
 * @example
 * ```ts
 * import type { NoulAnswer } from "huncho";
 *
 * function label(answer: NoulAnswer): string {
 *   return answer.yes ? `yes (${answer.p.toFixed(2)})` : `no (${answer.p.toFixed(2)})`;
 * }
 * ```
 */
export interface NoulAnswer {
  /** Probability of yes, 0..1. */
  readonly p: number;
  /** True when `p` is at least 0.5. */
  readonly yes: boolean;
}

/**
 * Typed answer to a {@link choice} question. `L` is the label union the question offered.
 *
 * @example
 * ```ts
 * import type { ChoiceAnswer } from "huncho";
 *
 * function route(topic: ChoiceAnswer<"billing" | "bug" | "other">): string {
 *   if (topic.is("billing", 0.7)) return "finance";
 *   return topic.p("bug") > 0.5 ? "engineering" : "triage";
 * }
 * ```
 */
export interface ChoiceAnswer<L extends string = string> {
  /** The label with the highest probability. */
  readonly choice: L;
  /** Probability per label. Sums to about 1. */
  readonly probabilities: Record<L, number>;
  /** Probability of `choice`. */
  readonly confidence: number;
  /** Probability of one label. */
  p(label: L): number;
  /** True when `label` was chosen and its probability is at least `min` (default 0). */
  is(label: L, min?: number): boolean;
}

/**
 * Typed answer to a {@link score} question.
 *
 * @example
 * ```ts
 * import type { ScoreAnswer } from "huncho";
 *
 * function passes(quality: ScoreAnswer): boolean {
 *   return quality.level === quality.levels - 1 && quality.confidence >= 0.7;
 * }
 * ```
 */
export interface ScoreAnswer {
  /** Expected level index, 0..`levels - 1`. Fractional when the model hedges between levels. */
  readonly score: number;
  /** `score / (levels - 1)`, 0..1. */
  readonly ratio: number;
  /** Nearest level index. */
  readonly level: number;
  /** How many levels the rubric has. */
  readonly levels: number;
  /** Probability per level index, keyed as a string. Sums to about 1. */
  readonly probabilities: Record<string, number>;
  /** Probability of the nearest level. */
  readonly confidence: number;
}

/**
 * The typed answer for one question type: {@link NoulAnswer}, {@link ChoiceAnswer}
 * with the question's labels, or {@link ScoreAnswer}.
 *
 * @example
 * ```ts
 * import { choice, type AnswerOf } from "huncho";
 *
 * const topic = choice("What is it about?", ["billing", "bug", "other"]);
 * type Topic = AnswerOf<typeof topic>; // ChoiceAnswer<"billing" | "bug" | "other">
 * ```
 */
export type AnswerOf<Q> = Q extends NoulQuestion
  ? NoulAnswer
  : Q extends ChoiceQuestion<infer L>
    ? ChoiceAnswer<L>
    : Q extends ScoreQuestion
      ? ScoreAnswer
      : never;

/**
 * Typed answers for a record of questions, key for key. This is what a policy
 * clause receives and what `ask` and `decide` return.
 *
 * @example
 * ```ts
 * import { choice, noul, type Answers } from "huncho";
 *
 * const questions = {
 *   urgent: noul("Does this need a human within the hour?"),
 *   topic: choice("What is it about?", ["billing", "bug", "other"]),
 * };
 *
 * function page(answers: Answers<typeof questions>): boolean {
 *   return answers.urgent.p >= 0.8 && !answers.topic.is("other");
 * }
 * ```
 */
export type Answers<Q extends Questions> = { [K in keyof Q]: AnswerOf<Q[K]> };

/**
 * Wrap canonical answers in their typed forms, checked against the questions
 * they answer. `ask` and `decide` call this for you; call it yourself on raw
 * answers from a journal record.
 *
 * @throws `AnswerError` when a question has no answer, the answer's type does not match the question, a `noul` is outside `[0, 1]` or a `score` is outside the rubric.
 * @example
 * ```ts
 * import { noul, wrapAnswers } from "huncho";
 *
 * const questions = { urgent: noul("Does this need a human within the hour?") };
 * const answers = wrapAnswers({ urgent: { type: "noul", noul: 0.91 } }, questions);
 * answers.urgent.yes; // true
 * ```
 */
export function wrapAnswers<Q extends Questions>(
  raw: Record<string, RawAnswer>,
  questions: Q,
): Answers<Q> {
  const answers: Record<string, NoulAnswer | ChoiceAnswer | ScoreAnswer> = {};
  for (const [key, question] of Object.entries(questions)) {
    const rawAnswer = raw[key];
    if (rawAnswer === undefined) {
      throw new AnswerError(`no answer for question "${key}", ${see("docs/providers.md#errors")}`);
    }
    answers[key] = wrapAnswer(rawAnswer, question, key);
  }
  return answers as Answers<Q>;
}

function malformed(key: string, question: Question): never {
  throw new AnswerError(
    `answer for question "${key}" is not a well-formed ${question.type} answer, ${see("docs/providers.md#errors")}`,
  );
}

function isLabelList<L extends string>(
  criteria: { readonly [K in L]: Content | null } | readonly L[],
): criteria is readonly L[] {
  return Array.isArray(criteria);
}

function wrapAnswer(raw: RawAnswer, question: Question, key: string): NoulAnswer | ChoiceAnswer | ScoreAnswer {
  if (question.type === "noul" && raw.type === "noul") return wrapNoul(raw, question, key);
  if (question.type === "choice" && raw.type === "choice") return wrapChoice(raw);
  if (question.type === "score" && raw.type === "score") return wrapScore(raw, question, key);
  malformed(key, question);
}

function wrapNoul(raw: RawNoulAnswer, question: NoulQuestion, key: string): NoulAnswer {
  if (!Number.isFinite(raw.noul) || raw.noul < 0 || raw.noul > 1) malformed(key, question);
  return { p: raw.noul, yes: raw.noul >= 0.5 };
}

function wrapChoice<L extends string>(raw: RawChoiceAnswer): ChoiceAnswer<L> {
  const probabilities = raw.probabilities as Record<L, number>;
  return {
    choice: raw.choice as L,
    probabilities,
    confidence: raw.confidence,
    p: (label) => probabilities[label] ?? 0,
    is: (label, min = 0) => raw.choice === label && (probabilities[label] ?? 0) >= min,
  };
}

function wrapScore(raw: RawScoreAnswer, question: ScoreQuestion, key: string): ScoreAnswer {
  const levels = question.criteria.length;
  const last = levels - 1;
  if (!Number.isFinite(raw.score) || raw.score < 0 || raw.score > last) malformed(key, question);
  return {
    score: raw.score,
    ratio: raw.score / last,
    level: Math.round(raw.score),
    levels,
    probabilities: raw.probabilities,
    confidence: raw.confidence,
  };
}
