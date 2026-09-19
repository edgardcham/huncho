// Questions and Answers: builders and typed wrappers over canonical raw answers.

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

/** Probability of yes. */
export function noul(
  instructions: Content,
  criteria?: NoulQuestion["criteria"],
): NoulQuestion {
  return criteria === undefined
    ? { type: "noul", instructions }
    : { type: "noul", instructions, criteria };
}

/** One of a named set. Labels come from the record keys or from a list. */
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

/** A position on an ordered rubric, lowest level first. At least two levels. */
export function score(instructions: Content, levels: readonly Content[]): ScoreQuestion {
  if (levels.length < 2) throw new Error("score() needs at least two levels");
  return { type: "score", instructions, criteria: levels };
}

export interface NoulAnswer {
  readonly p: number;
  /** True when `p` is at least 0.5. */
  readonly yes: boolean;
}

export interface ChoiceAnswer<L extends string = string> {
  readonly choice: L;
  readonly probabilities: Record<L, number>;
  readonly confidence: number;
  /** Probability of one label. */
  p(label: L): number;
  /** True when `label` was chosen and its probability is at least `min` (default 0). */
  is(label: L, min?: number): boolean;
}

export interface ScoreAnswer {
  readonly score: number;
  /** `score / (levels - 1)`, 0..1. */
  readonly ratio: number;
  /** Nearest level index. */
  readonly level: number;
  readonly levels: number;
  readonly probabilities: Record<string, number>;
  readonly confidence: number;
}

export type AnswerOf<Q> = Q extends NoulQuestion
  ? NoulAnswer
  : Q extends ChoiceQuestion<infer L>
    ? ChoiceAnswer<L>
    : Q extends ScoreQuestion
      ? ScoreAnswer
      : never;

export type Answers<Q extends Questions> = { [K in keyof Q]: AnswerOf<Q[K]> };

export function wrapAnswers<Q extends Questions>(
  raw: Record<string, RawAnswer>,
  questions: Q,
): Answers<Q> {
  const answers: Record<string, NoulAnswer | ChoiceAnswer | ScoreAnswer> = {};
  for (const [key, question] of Object.entries(questions)) {
    const rawAnswer = raw[key];
    if (rawAnswer === undefined) missing(key);
    answers[key] = wrapAnswer(rawAnswer, question, key);
  }
  return answers as Answers<Q>;
}

function missing(key: string): never {
  throw new Error(`no answer for question "${key}"`);
}

function isLabelList<L extends string>(
  criteria: { readonly [K in L]: Content | null } | readonly L[],
): criteria is readonly L[] {
  return Array.isArray(criteria);
}

function wrapAnswer(raw: RawAnswer, question: Question, key: string): NoulAnswer | ChoiceAnswer | ScoreAnswer {
  if (question.type === "noul" && raw.type === "noul") return wrapNoul(raw);
  if (question.type === "choice" && raw.type === "choice") return wrapChoice(raw);
  if (question.type === "score" && raw.type === "score") return wrapScore(raw, question, key);
  missing(key);
}

function wrapNoul(raw: RawNoulAnswer): NoulAnswer {
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
  if (!Number.isFinite(raw.score) || raw.score < 0 || raw.score > last) missing(key);
  return {
    score: raw.score,
    ratio: raw.score / last,
    level: Math.round(raw.score),
    levels,
    probabilities: raw.probabilities,
    confidence: raw.confidence,
  };
}
