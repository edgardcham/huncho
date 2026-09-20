// Sweep: replay a journal through every candidate threshold pair on one numeric clause
// and tabulate what each would have done. Pure; never calls a Model.

import { ConfigError, see } from "./errors.js";
import type { Huncho } from "./huncho.js";
import type { JournalRecord } from "./journal.js";
import { truthForOutcome, type Label, type Labels } from "./labels.js";
import { thresholds } from "./policy.js";
import { replay, type Replay } from "./replay.js";
import type { Questions } from "./types.js";

/**
 * Candidate thresholds: the values themselves, or a range walked from `from`
 * to `to` inclusive in steps of `step`.
 *
 * @example
 * ```ts
 * import type { Candidates } from "huncho";
 *
 * const listed: Candidates = [0.6, 0.7, 0.8];
 * const walked: Candidates = { from: 0.5, to: 0.9, step: 0.1 }; // 0.5, 0.6, 0.7, 0.8, 0.9
 * ```
 */
export type Candidates =
  | readonly number[]
  | {
      /** First candidate. */
      readonly from: number;
      /** Last candidate, included when the steps land on it. */
      readonly to: number;
      /** Distance between candidates. Positive. */
      readonly step: number;
    };

/**
 * What `sweep` needs: which clause to vary, the thresholds to try, and, for
 * precision and recall, what should have happened.
 *
 * @typeParam O The huncho's own outcomes, so `outcome` has to be one of them.
 * @example
 * ```ts
 * import type { SweepOptions } from "huncho";
 * import { fileLabels } from "huncho/node";
 *
 * const flapsOnly: SweepOptions<"page" | "wait"> = {
 *   outcome: "page",
 *   enter: { from: 0.5, to: 0.9, step: 0.1 },
 *   exit: { from: 0.3, to: 0.9, step: 0.1 },
 * };
 * const scored: SweepOptions<"page" | "wait"> = {
 *   outcome: "page",
 *   enter: [0.6, 0.7, 0.8],
 *   labels: fileLabels("labels.jsonl"),
 * };
 * ```
 */
export interface SweepOptions<O extends string = string> {
  /** The numeric clause to vary, named by its outcome. */
  readonly outcome: O;
  /** Candidate `enter` thresholds. */
  readonly enter: Candidates;
  /** Candidate `exit` thresholds. Omit it and every row has `exit` equal to its `enter`, which is no hysteresis. */
  readonly exit?: Candidates;
  /** Whether each decision should have been `outcome`: labels joined to records by decision `id`, or a callback per record. An unlabelled record, or an `undefined` result, is left out of precision and recall. */
  readonly labels?: Labels | readonly Label[] | ((rec: JournalRecord) => boolean | undefined);
}

/**
 * What `sweep` returns: one row per threshold pair tried, and the row to pick
 * when labels were given. Rows are in `enter` order, then `exit`. Exactly one
 * row has `current: true`, the thresholds the huncho is configured with today,
 * so every other row reads as a change from it.
 *
 * @example
 * ```ts
 * import type { Sweep } from "huncho";
 *
 * function table(result: Sweep): string {
 *   return result.rows
 *     .map((row) => {
 *       const mark = row.current ? "*" : " ";
 *       const scored = row.f1 === undefined ? "" : `  f1=${row.f1.toFixed(2)}`;
 *       return `${mark} enter=${row.enter} exit=${row.exit} chosen=${row.chosen}/${row.n} flaps=${row.flaps}${scored}`;
 *     })
 *     .join("\n");
 * }
 * ```
 */
export interface Sweep {
  /** One row per valid `(enter, exit)` pair, `exit` at most `enter`. */
  readonly rows: readonly {
    /** The `enter` threshold this row tried. */
    readonly enter: number;
    /** The `exit` threshold this row tried. */
    readonly exit: number;
    /** True on the one row whose thresholds are the huncho's as configured. */
    readonly current: boolean;
    /** Records replayed: every record the huncho wrote. */
    readonly n: number;
    /** Records that landed on the outcome, entered or held. */
    readonly chosen: number;
    /** How many records got a different outcome from the previous record with the same key. */
    readonly flaps: number;
    /** Of the labelled records chosen, the share that should have been. `NaN` when none was chosen. Only with labels. */
    readonly precision?: number;
    /** Of the labelled records that should have been chosen, the share that was. `NaN` when none should have been. Only with labels. */
    readonly recall?: number;
    /** Harmonic mean of precision and recall, `2tp / (2tp + fp + fn)`. `NaN` when no labelled record was chosen and none should have been. Only with labels. */
    readonly f1?: number;
  }[];
  /** The row with the highest `f1`, ties to fewer flaps, then to the earlier row. Absent without labels, or when no row has an `f1`. */
  readonly best?: Sweep["rows"][number];
}

/** A walked range stops here: past it the grid is a mistake in `step`, not a sweep. */
const MOST_CANDIDATES = 1000;

type Truth = (rec: JournalRecord) => boolean | undefined;

type Cell = { readonly enter: number; readonly exit: number };

type Grid = { readonly current: Cell; readonly cells: readonly Cell[] };

/**
 * Try every candidate `enter` and `exit` on one numeric clause and see what
 * each pair would have decided for the journal: how many records land on the
 * outcome, how often keys flap between outcomes, and, with labels, precision,
 * recall and f1 against what should have happened. Each row is a `replay`
 * through `huncho.with()`, so hysteresis chains per key the way it did live.
 * No model call.
 *
 * The grid is every `enter` paired with every `exit`; pairs with `exit` above
 * `enter` are left out. The configured thresholds are always a row, marked
 * `current`, whether or not the candidates include them. Without `exit`, each
 * row's `exit` equals its `enter`.
 *
 * With a `Labels` store the result is a promise, since the store is read;
 * with a `Label[]`, a callback or no labels it is the `Sweep` itself. A
 * label's `truth` says whether the decision should have been `outcome`: a
 * boolean directly, a string when it equals `outcome`; a number cannot be
 * compared to an outcome and is an `AnswerError`.
 *
 * @param records Journal records, in the order they were written. Other hunchos' records are skipped by name.
 * @param instance The huncho whose clause to vary. Its thresholds today are the `current` row.
 * @param options Which clause, which candidates, and what should have happened.
 * @throws `ConfigError` when `outcome` names a boolean clause, no clause or more than one clause on the huncho, when a candidate is not finite, when a range has `from` above `to`, a `step` that is not positive or more than 1000 candidates, or when the huncho has no questions.
 * @throws `AnswerError` when a record lacks an answer the questions ask for, when a label's `t` is not a date, or when a label's `truth` is a number.
 * @throws `PolicyError` when a record matches no clause and there is no `else`.
 * @example
 * ```ts
 * import { huncho, noul, sweep } from "huncho";
 * import { jev } from "huncho/jev";
 * import { fileLabels, readJournal } from "huncho/node";
 *
 * const route = huncho("support.route", { model: jev() })
 *   .ask({ urgent: noul("Does this need a human within the hour?") })
 *   .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
 *   .else("wait");
 *
 * const result = await sweep(await readJournal("decisions.jsonl"), route, {
 *   outcome: "page",
 *   enter: { from: 0.5, to: 0.9, step: 0.1 },
 *   exit: { from: 0.3, to: 0.9, step: 0.1 },
 *   labels: fileLabels("labels.jsonl"),
 * });
 * result.best;                            // { enter: 0.7, exit: 0.5, current: false, n: 183, chosen: 41, flaps: 3, precision: 0.85, recall: 0.92, f1: 0.88 }
 * result.rows.find((row) => row.current); // the same columns for { enter: 0.8, exit: 0.6 }
 * ```
 */
export function sweep<I, Q extends Questions, O extends string>(
  records: readonly JournalRecord[],
  instance: Huncho<I, Q, O>,
  options: SweepOptions<NoInfer<O>> & { readonly labels: Labels },
): Promise<Sweep>;
export function sweep<I, Q extends Questions, O extends string>(
  records: readonly JournalRecord[],
  instance: Huncho<I, Q, O>,
  options: SweepOptions<NoInfer<O>> & { readonly labels?: readonly Label[] | Truth },
): Sweep;
export function sweep<I, Q extends Questions, O extends string>(
  records: readonly JournalRecord[],
  instance: Huncho<I, Q, O>,
  options: SweepOptions<NoInfer<O>>,
): Sweep | Promise<Sweep>;
export function sweep<I, Q extends Questions, O extends string>(
  records: readonly JournalRecord[],
  instance: Huncho<I, Q, O>,
  options: SweepOptions<O>,
): Sweep | Promise<Sweep> {
  const grid = gridOf(instance, options);
  const { labels, outcome } = options;
  if (labels === undefined) return tabulate(records, instance, outcome, grid, undefined);
  if (typeof labels === "function") return tabulate(records, instance, outcome, grid, labels);
  if ("read" in labels) {
    return labels.read().then((rows) => tabulate(records, instance, outcome, grid, truthForOutcome(rows, outcome)));
  }
  return tabulate(records, instance, outcome, grid, truthForOutcome(labels, outcome));
}

/** The configured pair, and every valid candidate pair with the configured one among them, in `enter` then `exit` order. */
function gridOf<I, Q extends Questions, O extends string>(instance: Huncho<I, Q, O>, options: SweepOptions<O>): Grid {
  const producing = thresholds(instance.policy, options.outcome);
  const [configured] = producing;
  if (configured === undefined) {
    throw new ConfigError(
      `huncho "${instance.name}" has no when() clause producing "${options.outcome}", so sweep() has nothing to vary, ${see("docs/sweep.md#what-you-pass")}`,
    );
  }
  if (producing.length > 1) {
    throw new ConfigError(
      `huncho "${instance.name}" produces "${options.outcome}" from ${producing.length} clauses and sweep() varies one; give the clause to vary its own outcome, ${see("docs/sweep.md#what-you-pass")}`,
    );
  }
  if (configured.kind === "boolean") {
    throw new ConfigError(
      `huncho "${instance.name}" produces "${options.outcome}" from a boolean clause, which has no enter and exit to vary; sweep() needs a numeric clause, ${see("docs/sweep.md#what-you-pass")}`,
    );
  }
  const current: Cell = { enter: configured.enter, exit: configured.exit };
  const enters = candidates("enter", options.enter);
  const exits = options.exit === undefined ? undefined : candidates("exit", options.exit);

  const cells = new Map<string, Cell>();
  const add = (cell: Cell) => {
    if (cell.exit <= cell.enter) cells.set(`${cell.enter}/${cell.exit}`, cell);
  };
  for (const enter of enters) {
    if (exits === undefined) add({ enter, exit: enter });
    else for (const exit of exits) add({ enter, exit });
  }
  add(current);

  return {
    current,
    cells: [...cells.values()].sort((a, b) => a.enter - b.enter || a.exit - b.exit),
  };
}

function candidates(which: "enter" | "exit", spec: Candidates): number[] {
  if (!("step" in spec)) {
    for (const value of spec) {
      if (!Number.isFinite(value)) {
        throw new ConfigError(
          `sweep() ${which} candidates must be finite numbers, got ${String(value)}, ${see("docs/sweep.md#what-you-pass")}`,
        );
      }
    }
    return [...spec];
  }
  const { from, to, step } = spec;
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(step) || step <= 0 || from > to) {
    throw new ConfigError(
      `sweep() ${which} range needs finite from at most to and a positive step, got from ${String(from)}, to ${String(to)}, step ${String(step)}, ${see("docs/sweep.md#what-you-pass")}`,
    );
  }
  // The count is fixed up front, so a step too small to move the float still ends. The nudge keeps
  // (0.9 - 0.5) / 0.1, which is 3.9999999999999996, at four steps; twelve significant digits absorb
  // the drift of repeated addition, so 0.1 steps land on 0.7, not 0.7000000000000001.
  const steps = Math.floor((to - from) / step + 1e-9);
  if (!(steps < MOST_CANDIDATES)) {
    throw new ConfigError(
      `sweep() ${which} range from ${String(from)} to ${String(to)} by ${String(step)} walks more than ${MOST_CANDIDATES} candidates, ${see("docs/sweep.md#what-you-pass")}`,
    );
  }
  return Array.from({ length: steps + 1 }, (_, i) => Number((from + i * step).toPrecision(12)));
}

function tabulate<I, Q extends Questions, O extends string>(
  records: readonly JournalRecord[],
  instance: Huncho<I, Q, O>,
  outcome: O,
  { current, cells }: Grid,
  truth: Truth | undefined,
): Sweep {
  const rows: Sweep["rows"][number][] = cells.map((cell) => {
    const replayed = replay(records, instance.with(overrideOf(outcome, cell)));
    const counted = {
      enter: cell.enter,
      exit: cell.exit,
      current: cell.enter === current.enter && cell.exit === current.exit,
      n: replayed.n,
      chosen: replayed.results.filter((row) => row.outcome === outcome).length,
      flaps: flapsOf(replayed),
    };
    return truth === undefined ? counted : { ...counted, ...scored(replayed, outcome, truth) };
  });
  const best = bestOf(rows);
  return best === undefined ? { rows } : { rows, best };
}

/** `{ [outcome]: cell }` as `with()` takes it. A computed key of generic type widens to an index signature; the cast names the one key it has. */
function overrideOf<O extends string>(outcome: O, cell: Cell): { readonly [K in O]?: Cell } {
  return { [outcome]: cell } as { readonly [K in O]?: Cell };
}

/** Records whose outcome differs from the previous record with the same key. */
function flapsOf(replayed: Replay): number {
  const last = new Map<string, string>();
  let flaps = 0;
  for (const { record, outcome } of replayed.results) {
    const before = last.get(record.key);
    if (before !== undefined && before !== outcome) flaps += 1;
    last.set(record.key, outcome);
  }
  return flaps;
}

function scored(
  replayed: Replay,
  outcome: string,
  truth: Truth,
): { readonly precision: number; readonly recall: number; readonly f1: number } {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const row of replayed.results) {
    const should = truth(row.record);
    if (should === undefined) continue;
    const chosen = row.outcome === outcome;
    if (chosen && should) tp += 1;
    else if (chosen) fp += 1;
    else if (should) fn += 1;
  }
  return { precision: tp / (tp + fp), recall: tp / (tp + fn), f1: (2 * tp) / (2 * tp + fp + fn) };
}

function bestOf(rows: Sweep["rows"]): Sweep["rows"][number] | undefined {
  let best: Sweep["rows"][number] | undefined;
  let bestF1 = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const f1 = row.f1;
    if (f1 === undefined || Number.isNaN(f1)) continue;
    if (best === undefined || f1 > bestF1 || (f1 === bestF1 && row.flaps < best.flaps)) {
      best = row;
      bestF1 = f1;
    }
  }
  return best;
}
