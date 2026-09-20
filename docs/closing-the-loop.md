---
title: Closing the loop
description: "Decide, label, calibrate, sweep: one journal from a threshold picked by hand to a threshold read from what actually happened."
---

A policy starts with thresholds picked by hand: `page` at 0.8, hold until 0.6, because those numbers sounded right. The loop replaces them with numbers read from the journal. Four steps, each a page of its own; this page walks them in order over one journal, with the code a support desk would run. [The labels example](../examples/labels.ts) runs decide, label and calibrate end to end, [the sweep example](../examples/sweep.ts) runs decide, label and sweep, and both print a real run.

```text
decide ──▶ journal ──▶ label ──▶ calibrate ──▶ sweep ──▶ with() ──▶ decide
```

## Decide

Give the huncho a journal and decide as usual. Every `decide` appends one record, and `decision.id` is the same string the record carries; keep it beside the thing decided, because the label is written against it.

```ts
import { huncho, noul } from "huncho";
import { jev } from "huncho/jev";
import { fileJournal } from "huncho/node";

const route = huncho("support.route", { model: jev(), journal: fileJournal("decisions.jsonl") })
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
  .else("wait");

// Keep `decision.id` beside the ticket: the label is written against it.
const decision = await route.decide("Checkout is down. Every customer gets a 500 at payment.", { key: "T-1041" });
decision.id; // "6f1d2c3e-8a4b-4c5d-9e6f-7a8b9c0d1e2f", the same string on the record
```

The `key` is the entity the decision is about; a ticket's follow-ups see the outcome it last got, so `page` holds through a dip below `enter`. `decision.via` says whether the outcome entered, held or fell through to `else`, and so does the record. [Journal and replay](journal.md#fields) is the record contract.

## Label

The truth arrives later and from somewhere else: the on-call engineer did page, or did not. Write it as a label against the decision's `id`. Only `id`, `t` and `truth` are needed, and `truth` is in the shape of the question being judged, a boolean for a `noul`.

```ts
import { fileLabels } from "huncho/node";

const labels = fileLabels("labels.jsonl");

// Once the incident log says what happened to T-1041: the on-call engineer did page.
await labels.write({ id: decision.id, t: new Date().toISOString(), truth: true });
```

Both files are append-only JSONL, so this can run in a different process on a different day from the decision, and a correction is one more `write`: when one `id` has several labels, the latest `t` wins. Label the decision you actually judged; a parent's label says nothing about its children. [Calibration](calibration.md#labels) has the label shapes for `choice` and `score` questions and the two adapters, `memoryLabels()` and `fileLabels(path)`.

## Calibrate

Before moving a threshold, ask whether the probability under it means anything. `calibrate` joins records to labels by `id` and scores the question's probabilities against what happened.

```ts
import { calibrate } from "huncho";
import { readJournal } from "huncho/node";

const records = await readJournal("decisions.jsonl");
const c = await calibrate(records, { question: "urgent", outcome: labels });

c.n;                      // decisions that had a label
c.brier < c.baseBrier;    // does the probability beat always guessing the base rate?
c.reliability;            // per bin: mean predicted probability against how often it happened
```

If `brier` is not below `baseBrier`, the question is not helping and no threshold on it will: change the question, the shape the model sees, or the model, and journal again. If it is, the reliability table says how to read the numbers: a bin whose `meanP` sits above its `observed` is over-confident, and a threshold there fires more often than its probability suggests. [Calibration](calibration.md#the-numbers) is what each number means.

## Sweep

Now the threshold. `sweep` replays the journal through every candidate `enter` paired with every candidate `exit` on the `page` clause, with no model call, and reads the same labels as "should this decision have been `page`".

```ts
import { sweep } from "huncho";

const result = await sweep(records, route, {
  outcome: "page",
  enter: { from: 0.5, to: 0.9, step: 0.1 },
  exit: { from: 0.3, to: 0.9, step: 0.1 },
  labels,
});

result.rows.find((row) => row.current); // { enter: 0.8, exit: 0.6 }, as configured, with the same columns
result.best;                            // the row with the highest f1, ties to fewer flaps
```

Each row is `{ enter, exit, current, n, chosen, flaps, precision, recall, f1 }`. Read `best` against the `current` row: what it gains in recall, what it costs in precision, and what `flaps` says about how often a ticket would have flipped between `page` and `wait` under it. Down a column of equal `enter`, a lower `exit` holds `page` longer and flaps less; along a row of equal `exit`, a higher `enter` asks for more certainty before paging at all. [Sweep](sweep.md#rows) is the column definitions and how `best` is chosen.

## Ship it

`best` is a reading of the decisions already made, not an instruction. Build the candidate with `with()`, replay it to see which recorded decisions would move, and if the moves are the ones the labels asked for, change the thresholds in code:

```ts
import { replay } from "huncho";

const best = result.best;
if (best !== undefined) {
  const candidate = route.with({ page: { enter: best.enter, exit: best.exit } });
  const { changed, results } = replay(records, candidate);

  changed;                              // how many recorded decisions would move
  results.filter((row) => row.changed); // each one, with its record and how the candidate reached it
}
```

The next decisions are journaled under the new thresholds, the next labels land against them, and the loop runs again. A few hundred labelled decisions make `best` an answer rather than a demonstration; the eight in the cookbook show the shape.

## Journals from before 0.4

Records written before 0.4 have no `id`, so a label has nothing to join to: `calibrate` skips those records, and `sweep` leaves them out of precision, recall and f1 while still counting them in `n`, `chosen` and `flaps`. They still replay, and they still calibrate through the callback form, `outcome: (record) => boolean | undefined`, when the truth can be looked up from something the record does carry, such as its `key`. [Journal and replay](journal.md#versioning) has the record versions.
