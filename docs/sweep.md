---
title: Sweep
description: "Which threshold to pick, from the journal: every candidate enter and exit on one clause, replayed, with the flap cost of each and precision and recall against what should have happened."
---

`sweep(records, huncho, { outcome, enter, exit?, labels? })` is a pure function over `JournalRecord[]`. It never calls a model. It answers "what should `enter` be?" by replaying the journal through every candidate pair of thresholds on one numeric clause and tabulating what each would have decided.

## The loop

Decisions are journaled with their probabilities. When the truth arrives, it is labelled against each decision's `id`, as [calibration](calibration.md#the-loop) does. Sweep then takes the journal, the huncho as configured today, and the candidates, and returns one row per pair.

```ts
import { huncho, noul, sweep } from "huncho";
import { jev } from "huncho/jev";
import { fileLabels, readJournal } from "huncho/node";

const route = huncho("support.route", { model: jev() })
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
  .else("wait");

const result = await sweep(await readJournal("decisions.jsonl"), route, {
  outcome: "page",
  enter: { from: 0.5, to: 0.9, step: 0.1 },
  exit: { from: 0.3, to: 0.9, step: 0.1 },
  labels: fileLabels("labels.jsonl"),
});

result.best;                            // the row with the highest f1, ties to fewer flaps
result.rows.find((row) => row.current); // the same columns for { enter: 0.8, exit: 0.6 }, today's thresholds
```

Each row is a `replay` of the journal through `route.with({ page: { enter, exit } })`, so hysteresis chains per key in record order the way it did live. [The sweep example](../examples/sweep.ts) runs the loop end to end against a temporary directory.

## What you pass

- `outcome`: the numeric clause to vary, named by its outcome. It has to be one of the huncho's own outcomes, typed, and it has to come from exactly one `when(select, { enter, exit }, outcome)`. An outcome from a boolean clause has no thresholds to vary, the `else` outcome has no clause at all, and an outcome two clauses produce does not say which to vary, since `with()` would move both; each is a `ConfigError` naming the huncho.
- `enter`: candidate `enter` thresholds. Either the numbers themselves, or `{ from, to, step }`, walked from `from` to `to` inclusive. `from` must be at most `to`, `step` positive and the walk at most 1000 candidates; every candidate must be finite. Anything else is a `ConfigError`.
- `exit`: candidate `exit` thresholds, the same two shapes. Omit it and every row's `exit` equals its `enter`, which is no hysteresis.
- `labels`: whether each decision should have been `outcome`, one of three shapes, the same three `calibrate` takes. Omit it and the rows carry counts and flaps only.
  - A `Labels` store, such as `memoryLabels()` or `fileLabels(path)`. It is read, so the result is a `Promise<Sweep>`.
  - A `Label[]`, when the labels are already in hand. The result is a `Sweep`.
  - `(record) => boolean | undefined`. Return `undefined` to leave a record out of precision and recall. The result is a `Sweep`.

The grid is every `enter` paired with every `exit`. A pair with `exit` above `enter` is not a policy the huncho would accept, so it is left out rather than thrown. The thresholds the huncho has today are always a row, whether or not the candidates include them, so there is always a `current` row to read the others against. Rows are sorted by `enter`, then `exit`, and a pair listed twice is one row.

Records from other hunchos are skipped by name. A record whose answers lack a question the huncho asks is an `AnswerError`, and a record no clause matches on a huncho with no `else` is a `PolicyError`, as in `replay`.

## Rows

| Column | Meaning |
| --- | --- |
| `enter`, `exit` | The pair this row tried. |
| `current` | `true` on exactly one row: the huncho's thresholds as configured. |
| `n` | Records replayed: every record the huncho wrote. The same on every row. |
| `chosen` | Records that landed on `outcome`, whether the clause entered or held. |
| `flaps` | Records whose outcome differs from the previous record with the same key. Two thresholds exist to make this number small; a sweep shows what each `exit` buys. |
| `precision` | Of the labelled records chosen, the share that should have been. Only with labels. |
| `recall` | Of the labelled records that should have been chosen, the share that was. Only with labels. |
| `f1` | `2tp / (2tp + fp + fn)`, the harmonic mean of the two. Only with labels. |

Without labels the three score columns are absent from every row, not `undefined`. With labels, a row that chose no labelled record has `precision: NaN`, a sweep on labels where nothing should have been chosen has `recall: NaN`, and `f1` is `NaN` only when both hold. A record with no label, or an `undefined` callback result, is left out of the three scores and still replayed, so it counts in `n`, `chosen` and `flaps`.

## Labels

The labels are the ones [calibration](calibration.md#labels) reads: `{ id, t, truth, note? }`, joined to records by decision `id`, the latest `t` per id winning, a `t` that is not a date an `AnswerError`. What differs is the question a `truth` answers. Calibrate scores one question's probability, so a `truth` is read in that question's shape. Sweep scores one outcome, so a `truth` is read as whether the decision should have been `outcome`:

| `truth` | Should have been `outcome` when |
| --- | --- |
| `boolean` | `truth` is `true` |
| `string`, the outcome that was right | `truth === outcome` |
| `number` | Never read: a score level cannot be compared to an outcome. An `AnswerError` naming the decision `id`. |

A boolean label written for a `noul` reads the same way here as in calibrate. A string label written for a `choice` reads as the outcome that was right, which fits when outcomes are named after the choices they route; when they are not, say what should have happened with the callback form.

## Best

`best` is the row with the highest `f1`. Two rows with the same `f1` go to the one with fewer flaps, then to the earlier row in the table. It is absent without labels, and absent when no row has an `f1`, which happens when no labelled record was chosen by any row and none should have been.

`best` is a reading of the journal, not a recommendation to switch: it is the pair that would have done best on the decisions already made. Compare it with the `current` row, look at what `flaps` costs, and then replay the candidate with `with()` before shipping it, as [journal and replay](journal.md) describes.
