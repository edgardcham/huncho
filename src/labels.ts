// Labels: what actually happened, keyed by decision id, and the join that turns
// them into the truth calibrate scores. Pure; the file adapter is in node.ts.

import { AnswerError, see } from "./errors.js";
import type { JournalRecord } from "./journal.js";
import type { RawAnswer } from "./types.js";

/**
 * What actually happened for one decision, in the shape of the question being
 * judged: a boolean for a `noul` (did it happen), the label that turned out to
 * be right for a `choice`, the level index that turned out to be right for a
 * `score`. A label applies to exactly the decision whose `id` it names;
 * labelling a parent says nothing about its children.
 *
 * @example
 * ```ts
 * import type { Label } from "huncho";
 *
 * const paged: Label = {
 *   id: "6f1d2c3e-8a4b-4c5d-9e6f-7a8b9c0d1e2f", // decision.id
 *   t: "2026-09-19T15:00:00.000Z",
 *   truth: true,
 *   note: "on-call picked it up within the hour",
 * };
 * const topic: Label = { id: "8b2e4d6f-1a3c-4e5b-9d7f-2c4a6e8b0d1f", t: "2026-09-19T15:00:00.000Z", truth: "billing" };
 * ```
 */
export interface Label {
  /** The `id` of the decision this label is about. */
  readonly id: string;
  /** When the truth was recorded, as ISO-8601 or any form `Date.parse` reads. When one id has several labels, the latest wins. */
  readonly t: string;
  /** What happened: a boolean for a `noul`, a choice label for a `choice`, a level index for a `score`. */
  readonly truth: boolean | string | number;
  /** Free text for the reader; calibrate ignores it. */
  readonly note?: string;
}

/**
 * Where labels are written. Two adapters ship: `memoryLabels()` and, from
 * `huncho/node`, `fileLabels(path)`. Implement it to keep labels anywhere else;
 * `write` may be sync or async. `calibrate` takes a `Labels` in place of an
 * `outcome` callback and joins records to labels by `id`.
 *
 * @example
 * ```ts
 * import type { Label, Labels } from "huncho";
 *
 * const rows: Label[] = [];
 * const logged: Labels = {
 *   write(label) {
 *     rows.push(label);
 *     console.log(label.id, label.truth);
 *   },
 *   async read() {
 *     return rows;
 *   },
 * };
 * ```
 */
export interface Labels {
  /** Record one label. Later labels for the same `id` replace earlier ones when calibrate reads them. */
  write(label: Label): void | Promise<void>;
  /** Every label written so far, in order. */
  read(): Promise<Label[]>;
}

/**
 * In-memory labels. `labels` is write order; `read` returns copies. For tests
 * and for scripts that calibrate in the same process.
 *
 * @example
 * ```ts
 * import { calibrate, memoryJournal, memoryLabels, huncho, noul } from "huncho";
 * import { scriptedModel } from "huncho/testing";
 *
 * const journal = memoryJournal();
 * const labels = memoryLabels();
 * const { model } = scriptedModel([{ answers: { urgent: { type: "noul", noul: 0.91 } } }]);
 * const route = huncho("support.route", { model, journal })
 *   .ask({ urgent: noul("Does this need a human within the hour?") })
 *   .else("wait");
 *
 * const decision = await route.decide("Checkout is down.");
 * labels.write({ id: decision.id, t: new Date().toISOString(), truth: true });
 * const c = await calibrate(await journal.read(), { question: "urgent", outcome: labels });
 * c.n; // 1
 * ```
 */
export function memoryLabels(): Labels & {
  /** Every label written, in order. The live array, not a copy. */
  labels: Label[];
} {
  const labels: Label[] = [];
  return {
    labels,
    write(label) {
      labels.push({ ...label });
    },
    async read() {
      return labels.map((label) => ({ ...label }));
    },
  };
}

/**
 * The join calibrate runs: records to labels by `id`, the latest `t` per id
 * winning (compared as parsed times, so precision and offset do not matter;
 * equal times go to the later write), `truth` read in the shape of the answer
 * being scored. The result is the callback calibrate's maths already consumes:
 * `undefined` for a record with no label, else whether the scored side happened.
 */
export function truthOf(
  labels: readonly Label[],
  question: string,
  expected: string | number | undefined,
): (rec: JournalRecord) => boolean | undefined {
  const latest = latestById(labels);
  return (rec) => {
    const label = latest.get(rec.id);
    const answer = rec.answers[question];
    if (label === undefined || answer === undefined) return undefined;
    return happened(label, answer, expected);
  };
}

/**
 * The join sweep runs: the same records-to-labels resolution as `truthOf`,
 * with `truth` read as whether the decision should have been `outcome`. A
 * boolean says so directly; a string is the outcome that was right, so it
 * counts when it equals `outcome`; a number names a score level, which no
 * outcome can be compared to, so it is an `AnswerError` naming the id.
 */
export function truthForOutcome(labels: readonly Label[], outcome: string): (rec: JournalRecord) => boolean | undefined {
  const latest = latestById(labels);
  return (rec) => {
    const label = latest.get(rec.id);
    if (label === undefined) return undefined;
    const { truth } = label;
    if (typeof truth === "boolean") return truth;
    if (typeof truth === "string") return truth === outcome;
    throw new AnswerError(
      `label for decision "${label.id}" has truth ${JSON.stringify(truth)}: a number names a score level, which cannot be compared to outcome "${outcome}"; label with a boolean or the outcome that was right, ${see("docs/sweep.md#labels")}`,
    );
  };
}

/** Each id's latest label by `t`, compared as parsed times; equal times go to the later write. */
function latestById(labels: readonly Label[]): Map<string, Label> {
  const latest = new Map<string, { readonly label: Label; readonly at: number }>();
  for (const label of labels) {
    const at = Date.parse(label.t);
    if (Number.isNaN(at)) {
      throw new AnswerError(
        `label for decision "${label.id}" has t ${JSON.stringify(label.t)}, which is not a date, ${see("docs/calibration.md#labels")}`,
      );
    }
    const held = latest.get(label.id);
    if (held === undefined || at >= held.at) latest.set(label.id, { label, at });
  }
  return new Map([...latest].map(([id, { label }]) => [id, label]));
}

function happened(label: Label, answer: RawAnswer, expected: string | number | undefined): boolean {
  const { truth } = label;
  if (answer.type === "noul") {
    if (typeof truth === "boolean") return truth;
    throw mismatch(label, `a noul takes a boolean truth`);
  }
  if (answer.type === "choice") {
    if (typeof truth === "string") return truth === String(expected);
    throw mismatch(label, `a choice takes the label that was right, a string`);
  }
  if (Number.isInteger(truth)) return truth === Number(expected);
  throw mismatch(label, `a score takes the level index that was right, an integer`);
}

function mismatch(label: Label, rule: string): AnswerError {
  return new AnswerError(
    `label for decision "${label.id}" has truth ${JSON.stringify(label.truth)}: ${rule}, ${see("docs/calibration.md#labels")}`,
  );
}
