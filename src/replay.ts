// Replay: re-run Policy over journaled answers. Pure; never calls a Model.

import type { Huncho } from "./huncho.js";
import type { JournalRecord } from "./journal.js";
import { wrapAnswers } from "./questions.js";
import type { Questions } from "./types.js";

export interface Replay {
  readonly results: readonly {
    readonly record: JournalRecord;
    readonly outcome: string;
    readonly changed: boolean;
  }[];
  readonly n: number;
  readonly changed: number;
  readonly outcomes: Record<string, number>;
}

/** Re-apply a huncho's current policy to journal records. No inference. */
export function replay<I, Q extends Questions, O extends string>(
  records: readonly JournalRecord[],
  instance: Huncho<I, Q, O>,
): Replay {
  const questions = instance.questions;
  if (questions === undefined) throw new Error(`huncho "${instance.name}" has no questions`);

  const held = new Map<string, string>();
  const results: Replay["results"][number][] = [];
  const counts = new Map<string, number>();
  let changed = 0;

  for (const record of records) {
    if (record.huncho !== instance.name) continue;
    const answers = wrapAnswers(record.answers, questions);
    const previous = held.has(record.key) ? held.get(record.key) : record.previous;
    const outcome =
      previous === undefined ? instance.policy.decide(answers) : instance.policy.decide(answers, previous);
    const moved = outcome !== record.outcome;
    if (moved) changed += 1;
    held.set(record.key, outcome);
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
    results.push({ record, outcome, changed: moved });
  }

  return { results, n: results.length, changed, outcomes: Object.fromEntries(counts) };
}
