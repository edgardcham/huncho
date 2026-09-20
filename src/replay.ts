// Replay: re-run Policy over journaled answers. Pure; never calls a Model.

import { noQuestions, type Huncho } from "./huncho.js";
import type { JournalRecord } from "./journal.js";
import { explain, type Via } from "./policy.js";
import { wrapAnswers } from "./questions.js";
import type { Questions } from "./types.js";

/**
 * What `replay` returns: every record's new outcome, how many moved, and the totals.
 *
 * @example
 * ```ts
 * import type { Replay } from "huncho";
 *
 * function report(result: Replay): string {
 *   const moved = result.results
 *     .filter((r) => r.changed)
 *     .map((r) => `${r.record.key}: ${r.record.outcome} (${r.record.via}) -> ${r.outcome} (${r.via})`);
 *   return `${result.changed} of ${result.n} would change\n${moved.join("\n")}`;
 * }
 * ```
 */
export interface Replay {
  /** One entry per record the huncho wrote, in record order. */
  readonly results: readonly {
    /** The record as read from the journal. */
    readonly record: JournalRecord;
    /** What the current policy decides for it. */
    readonly outcome: string;
    /** How the current policy reached `outcome`; the record's own `via` says how it was reached live. */
    readonly via: Via;
    /** True when `outcome` differs from what the record has. */
    readonly changed: boolean;
  }[];
  /** How many records were replayed. */
  readonly n: number;
  /** How many outcomes moved. */
  readonly changed: number;
  /** New outcome to count. */
  readonly outcomes: Record<string, number>;
}

/**
 * Re-apply a huncho's current policy to journal records. No model call: the
 * recorded answers are wrapped and decided again, chaining hysteresis per key
 * in record order. Records from other hunchos are skipped by name. Change a
 * threshold with `with()` and replay to see what would move before shipping it.
 *
 * @param records Journal records, in the order they were written.
 * @param instance The huncho whose questions and policy to apply; usually a `with()` copy.
 * @throws `ConfigError` when the huncho has no questions.
 * @throws `AnswerError` when a record lacks an answer the questions now ask for.
 * @throws `PolicyError` when a record matches no clause and there is no `else`.
 * @example
 * ```ts
 * import { huncho, noul, replay } from "huncho";
 * import { jev } from "huncho/jev";
 * import { readJournal } from "huncho/node";
 *
 * const route = huncho("support.route", { model: jev() })
 *   .ask({ urgent: noul("Does this need a human within the hour?") })
 *   .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
 *   .else("wait");
 *
 * const stricter = route.with({ page: { enter: 0.9, exit: 0.7 } });
 * const { n, changed, outcomes } = replay(await readJournal("decisions.jsonl"), stricter);
 * changed;  // how many outcomes would move
 * outcomes; // { page: 12, wait: 171 }
 * ```
 */
export function replay<I, Q extends Questions, O extends string>(
  records: readonly JournalRecord[],
  instance: Huncho<I, Q, O>,
): Replay {
  const questions = instance.questions;
  if (questions === undefined) throw noQuestions(instance.name);

  const held = new Map<string, string>();
  const results: Replay["results"][number][] = [];
  const counts = new Map<string, number>();
  let changed = 0;

  for (const record of records) {
    if (record.huncho !== instance.name) continue;
    const answers = wrapAnswers(record.answers, questions);
    const previous = held.has(record.key) ? held.get(record.key) : record.previous;
    const { outcome, via } = explain(instance.policy, answers, previous);
    const moved = outcome !== record.outcome;
    if (moved) changed += 1;
    held.set(record.key, outcome);
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
    results.push({ record, outcome, via, changed: moved });
  }

  return { results, n: results.length, changed, outcomes: Object.fromEntries(counts) };
}
