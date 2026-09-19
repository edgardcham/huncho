// Calibrate: Brier, reliability and accuracy-by-confidence over journaled answers.
// Pure; never calls a model.

import type { JournalRecord } from "./journal.js";
import type { RawAnswer } from "./types.js";

export interface CalibrateOptions {
  /** Answer key whose probability is the prediction. */
  readonly question: string;
  /** Choice label or score level index. Required for choice and score. */
  readonly label?: string | number;
  /** What actually happened. Return undefined to skip the record. */
  readonly outcome: (rec: JournalRecord) => boolean | undefined;
  /** Equal-width reliability bins across 0..1. Default 10. */
  readonly buckets?: number;
}

export interface Calibration {
  readonly n: number;
  readonly brier: number;
  readonly baseRate: number;
  readonly baseBrier: number;
  readonly reliability: readonly {
    readonly lo: number;
    readonly hi: number;
    readonly n: number;
    readonly meanP: number;
    readonly observed: number;
  }[];
  readonly accuracyByConfidence: readonly {
    readonly lo: number;
    readonly hi: number;
    readonly n: number;
    readonly accuracy: number;
  }[];
}

const CONFIDENCE = [0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;

type Pair = { readonly p: number; readonly y: number };

export function calibrate(records: readonly JournalRecord[], options: CalibrateOptions): Calibration {
  const bins = options.buckets ?? 10;
  if (!Number.isInteger(bins) || bins < 1 || bins > 1000) {
    throw new Error("calibrate() buckets must be a positive integer at most 1000");
  }

  const pairs: Pair[] = [];
  for (const rec of records) {
    const answer = rec.answers[options.question];
    if (answer === undefined) continue;
    const happened = options.outcome(rec);
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
    throw new Error(`calibrate() needs label for choice and score questions ("${question}")`);
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
