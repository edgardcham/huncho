// Calibrate: Brier, reliability and accuracy-by-confidence over journaled answers.
// Pure; never calls a model.

import { ConfigError, see } from "./errors.js";
import type { JournalRecord } from "./journal.js";
import { truthOf, type Label, type Labels } from "./labels.js";
import type { RawAnswer } from "./types.js";

/**
 * What `calibrate` needs: which probability to score and what actually happened.
 *
 * @example
 * ```ts
 * import type { CalibrateOptions } from "huncho";
 * import { fileLabels } from "huncho/node";
 *
 * const byCallback: CalibrateOptions = {
 *   question: "topic",
 *   label: "billing",
 *   outcome: (rec) => rec.path.includes("billing"),
 *   buckets: 5,
 * };
 * const byLabels: CalibrateOptions = {
 *   question: "topic",
 *   label: "billing",
 *   outcome: fileLabels("labels.jsonl"),
 * };
 * ```
 */
export interface CalibrateOptions {
  /** Answer key whose probability is the prediction. */
  readonly question: string;
  /** Choice label or score level index. Required for choice and score. */
  readonly label?: string | number;
  /** What actually happened: labels joined to records by decision `id`, or a callback per record. An unlabelled record, or an `undefined` result, is skipped. */
  readonly outcome: Labels | readonly Label[] | ((rec: JournalRecord) => boolean | undefined);
  /** Equal-width reliability bins across 0..1. Default 10. */
  readonly buckets?: number;
}

/**
 * What `calibrate` returns. Lower `brier` is better; compare it with
 * `baseBrier`, what always predicting the base rate would have scored. A
 * well-calibrated model has `observed` close to `meanP` in every reliability
 * row. With no scored records, `n` is 0 and the scores are `NaN`.
 *
 * @example
 * ```ts
 * import type { Calibration } from "huncho";
 *
 * function useful(c: Calibration): boolean {
 *   return c.n >= 100 && c.brier < c.baseBrier;
 * }
 * ```
 */
export interface Calibration {
  /** How many records were scored. */
  readonly n: number;
  /** Mean squared error of the probabilities, 0 (perfect) to 1. */
  readonly brier: number;
  /** How often the outcome happened. */
  readonly baseRate: number;
  /** The Brier score of always predicting `baseRate`. Beat this or the probabilities add nothing. */
  readonly baseBrier: number;
  /** Predicted against observed, per probability bin. Empty bins are left out. */
  readonly reliability: readonly {
    /** Bin start, inclusive. */
    readonly lo: number;
    /** Bin end. Exclusive, except the last bin. */
    readonly hi: number;
    /** Records in the bin. */
    readonly n: number;
    /** Mean predicted probability in the bin. */
    readonly meanP: number;
    /** Share of records in the bin where the outcome happened. */
    readonly observed: number;
  }[];
  /** How often the majority side was right, per confidence band from 0.5 up. Empty bands are left out. */
  readonly accuracyByConfidence: readonly {
    /** Band start, inclusive. */
    readonly lo: number;
    /** Band end. Exclusive, except the last band. */
    readonly hi: number;
    /** Records in the band. */
    readonly n: number;
    /** Share of records where `p >= 0.5` matched the outcome. */
    readonly accuracy: number;
  }[];
}

const CONFIDENCE = [0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;

type Pair = { readonly p: number; readonly y: number };

/**
 * Score journaled probabilities against what actually happened: Brier score
 * against the base rate, a reliability table, accuracy by confidence band.
 * Pure; no model call. Records without the question, records with no label or
 * an `undefined` callback result, and probabilities outside 0..1 are skipped.
 *
 * With a `Labels` store the result is a promise, since the store is read;
 * with a `Label[]` or a callback it is the `Calibration` itself. Labels join
 * records by `id`, the latest `t` per id winning. A `noul` is scored against
 * the boolean `truth`; a `choice` or `score` against `truth === label`.
 *
 * @param records Journal records; any huncho's, as long as they answer `question`.
 * @param options Which answer to score and how to know the truth.
 * @throws `ConfigError` when `buckets` is not a positive integer at most 1000, or a choice or score question has no `label`.
 * @throws `AnswerError` when a label's `truth` is not the shape of the question it judges (a `noul` takes a boolean, a `choice` a string, a `score` an integer level index), or a label's `t` is not a date. The message names the decision id.
 * @example
 * ```ts
 * import { calibrate } from "huncho";
 * import { fileLabels, readJournal } from "huncho/node";
 *
 * // Labels were written as truths arrived: { id: decision.id, t, truth: true }.
 * const c = await calibrate(await readJournal("decisions.jsonl"), {
 *   question: "urgent",
 *   outcome: fileLabels("labels.jsonl"),
 * });
 * c.brier < c.baseBrier; // the probabilities beat the base rate
 * c.reliability;         // [{ lo: 0.8, hi: 0.9, n: 14, meanP: 0.85, observed: 0.79 }, …]
 *
 * // Or say per record what happened, from anything you already know.
 * const resolved = new Set(["T-1041", "T-1044"]); // tickets a human did page on
 * calibrate(await readJournal("decisions.jsonl"), {
 *   question: "urgent",
 *   outcome: (rec) => resolved.has(rec.key),
 * }).n;
 * ```
 */
export function calibrate(
  records: readonly JournalRecord[],
  options: CalibrateOptions & { readonly outcome: Labels },
): Promise<Calibration>;
export function calibrate(
  records: readonly JournalRecord[],
  options: CalibrateOptions & { readonly outcome: readonly Label[] | ((rec: JournalRecord) => boolean | undefined) },
): Calibration;
export function calibrate(
  records: readonly JournalRecord[],
  options: CalibrateOptions,
): Calibration | Promise<Calibration>;
export function calibrate(
  records: readonly JournalRecord[],
  options: CalibrateOptions,
): Calibration | Promise<Calibration> {
  const bins = options.buckets ?? 10;
  if (!Number.isInteger(bins) || bins < 1 || bins > 1000) {
    throw new ConfigError(
      `calibrate() buckets must be a positive integer at most 1000, ${see("docs/calibration.md#what-you-pass")}`,
    );
  }
  const { outcome, question, label } = options;
  if (typeof outcome === "function") return score(records, options, outcome, bins);
  if ("read" in outcome) {
    return outcome.read().then((labels) => score(records, options, truthOf(labels, question, label), bins));
  }
  return score(records, options, truthOf(outcome, question, label), bins);
}

function score(
  records: readonly JournalRecord[],
  options: CalibrateOptions,
  truth: (rec: JournalRecord) => boolean | undefined,
  bins: number,
): Calibration {
  const pairs: Pair[] = [];
  for (const rec of records) {
    const answer = rec.answers[options.question];
    if (answer === undefined) continue;
    const happened = truth(rec);
    if (happened === undefined) continue;
    const p = predicted(answer, options.label, options.question);
    if (p === undefined || !Number.isFinite(p) || p < 0 || p > 1) continue;
    pairs.push({ p, y: happened ? 1 : 0 });
  }

  const n = pairs.length;
  if (n === 0) {
    return {
      n: 0,
      brier: Number.NaN,
      baseRate: Number.NaN,
      baseBrier: Number.NaN,
      reliability: [],
      accuracyByConfidence: [],
    };
  }

  let sumY = 0;
  let sumSq = 0;
  for (const { p, y } of pairs) {
    sumY += y;
    sumSq += (p - y) ** 2;
  }
  const baseRate = sumY / n;
  let sumBaseSq = 0;
  for (const { y } of pairs) sumBaseSq += (baseRate - y) ** 2;

  return {
    n,
    brier: sumSq / n,
    baseRate,
    baseBrier: sumBaseSq / n,
    reliability: reliabilityOf(pairs, bins),
    accuracyByConfidence: accuracyOf(pairs),
  };
}

function predicted(answer: RawAnswer, label: string | number | undefined, question: string): number | undefined {
  if (answer.type === "noul") return answer.noul;
  if (label === undefined) {
    throw new ConfigError(
      `calibrate() needs a label for the choice or score question "${question}", ${see("docs/calibration.md#what-you-pass")}`,
    );
  }
  return answer.probabilities[String(label)];
}

function reliabilityOf(pairs: readonly Pair[], bins: number): Calibration["reliability"][number][] {
  const acc = Array.from({ length: bins }, (_, i) => ({
    lo: i / bins,
    hi: (i + 1) / bins,
    n: 0,
    sumP: 0,
    sumY: 0,
  }));
  const last = bins - 1;
  for (const { p, y } of pairs) {
    const index = Math.min(last, Math.max(0, Math.floor(p * bins)));
    const bin = acc[index]!;
    bin.n += 1;
    bin.sumP += p;
    bin.sumY += y;
  }
  const out: Calibration["reliability"][number][] = [];
  for (const bin of acc) {
    if (bin.n === 0) continue;
    out.push({
      lo: bin.lo,
      hi: bin.hi,
      n: bin.n,
      meanP: bin.sumP / bin.n,
      observed: bin.sumY / bin.n,
    });
  }
  return out;
}

function accuracyOf(pairs: readonly Pair[]): Calibration["accuracyByConfidence"][number][] {
  const out: Calibration["accuracyByConfidence"][number][] = [];
  for (let i = 0; i < CONFIDENCE.length - 1; i++) {
    const lo = CONFIDENCE[i]!;
    const hi = CONFIDENCE[i + 1]!;
    const last = i === CONFIDENCE.length - 2;
    let n = 0;
    let right = 0;
    for (const { p, y } of pairs) {
      const confidence = Math.max(p, 1 - p);
      const inside = last ? confidence >= lo && confidence <= hi : confidence >= lo && confidence < hi;
      if (!inside) continue;
      n += 1;
      if ((p >= 0.5 ? 1 : 0) === y) right += 1;
    }
    if (n === 0) continue;
    out.push({ lo, hi, n, accuracy: right / n });
  }
  return out;
}
