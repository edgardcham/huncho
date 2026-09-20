---
title: Calibration
description: "Whether journaled probabilities meant anything: Brier score against the base rate, a reliability table, accuracy by confidence band."
---

`calibrate(records, { question, label?, outcome, buckets? })` is a pure function over `JournalRecord[]`. It never calls a model. It answers whether one question's probabilities mean anything on labeled data.

## The loop

A decision is journaled with its probabilities. Later, the truth arrives: the ticket did or did not need a page, the topic was billing after all. Record that truth as a label against the decision's `id`, and calibrate joins the two.

```ts
import { calibrate, huncho, noul } from "huncho";
import { jev } from "huncho/jev";
import { fileJournal, fileLabels, readJournal } from "huncho/node";

const journal = fileJournal("decisions.jsonl");
const labels = fileLabels("labels.jsonl");

const route = huncho("support.route", { model: jev(), journal })
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
  .else("wait");

// Now: decide, and keep `decision.id` beside the ticket.
const decision = await route.decide("Checkout is down.", { key: "T-1041" });

// Later, once a human has resolved the ticket: label the decision that was judged.
await labels.write({ id: decision.id, t: new Date().toISOString(), truth: true });

// Any time after: score every labeled decision. The join by id is calibrate's.
const c = await calibrate(await readJournal("decisions.jsonl"), { question: "urgent", outcome: labels });
c.brier < c.baseBrier;
```

[The labels example](../examples/labels.ts) runs this end to end against a temporary directory. The same labels answer the next question, which threshold to pick: [sweep](sweep.md) replays every candidate pair over the journal and scores each against them.

## What you pass

- `question`: the answer key to score.
- `label`: required for `choice` and `score`. A choice label, or a score level index (`0`, `1`, …). `noul` uses its own probability and ignores `label`.
- `outcome`: what actually happened, one of three shapes.
  - A `Labels` store, such as `memoryLabels()` or `fileLabels(path)`. It is read, so the result is a `Promise<Calibration>`.
  - A `Label[]`, when the labels are already in hand. The result is a `Calibration`.
  - `(record) => boolean | undefined`, when the truth is derivable from something you already have. Return `undefined` to skip a record. The result is a `Calibration`.
- `buckets`: how many equal-width reliability bins to use on `[0, 1]`. Default `10`. Must be a positive integer at most `1000`. Empty bins are omitted.

Records with no answer for `question`, no label (or an `undefined` callback result), a choice/score whose `label` is missing from `probabilities`, or a probability that is not finite and in `[0, 1]`, are skipped. A choice or score answer scored without `label`, or a `buckets` outside its range, is a `ConfigError`. If nothing remains, the result is `{ n: 0, brier: NaN, baseRate: NaN, baseBrier: NaN, reliability: [], accuracyByConfidence: [] }`.

## Labels

A `Label` is `{ id, t, truth, note? }`: the `id` of the decision it is about, `t` for when the truth was recorded (ISO-8601, or any form `Date.parse` reads), `truth` in the shape of the question being judged, and free text in `note` that calibrate ignores.

| Question | `truth` | Counts as true when |
| --- | --- | --- |
| `noul` | `boolean`, did it happen | `truth` is `true` |
| `choice` | `string`, the label that turned out to be right | `truth === label` |
| `score` | `number`, the level index that turned out to be right | `truth === label` |

A `truth` of the wrong shape for the question it judges (a string for a `noul`, a boolean for a `choice`, anything but an integer for a `score`) is an `AnswerError` naming the decision `id`, so a wrong label cannot silently count as false.

A label applies to exactly the decision whose `id` it names. Labelling a parent says nothing about its children; label the decision you actually judged. When one `id` has several labels, the latest `t` wins, so a correction is one more `write`; timestamps are compared as times, not text, so `Z` against `+02:00` or seconds against milliseconds compare correctly, and equal times go to the later write. A `t` that is not a date is an `AnswerError` naming the `id`. A record with no label is skipped. Journals written before 0.4 have no `id`, so their records are never joined; score them with a callback.

`Labels` is a seam with two adapters, the same shape as `Journal`: `write(label)` may be sync or async, `read()` returns every label in write order.

- `memoryLabels()` keeps them in process, with a `labels` array in write order.
- `fileLabels(path)`, from `huncho/node`, appends one JSON object per line. Writes on one adapter are serialised in call order and `read` waits for writes already queued, so a label written just before `calibrate` reads is counted. A missing file is empty, and a trailing incomplete line from an interrupted append is skipped so earlier labels stay readable. `node:fs/promises` is imported on first use, like the file journal.

## The numbers

`n` is the labeled sample size.

`brier` is the mean squared error of the probability: the average of `(p - y)^2`, with `y` 1 when the event happened and 0 when it did not. `0` is perfect. Always saying `0.5` scores `0.25`.

`baseRate` is the fraction of labeled records where the event happened.

`baseBrier` is the Brier score of always predicting that base rate — a caller who knows the class balance and nothing else.

**If `brier` is not lower than `baseBrier`, the question is not helping.** The probabilities are no better than guessing the base rate. Skill is how far `brier` sits below `baseBrier`.

## Reliability

Each occupied bin is `{ lo, hi, n, meanP, observed }`. `meanP` is the average predicted probability in `[lo, hi)`; the last bin includes `1`. `observed` is how often the event actually happened in that bin.

When `meanP` and `observed` stay close, a reported `0.8` happened about 80% of the time. When `meanP` is higher than `observed`, the question is over-confident; the other way, under-confident.

## Accuracy by confidence

The binary call is `p >= 0.5`. Confidence is `max(p, 1 - p)` — how far the probability sits from "don't know". Bands are `0.5-0.6`, `0.6-0.7`, `0.7-0.8`, `0.8-0.9`, `0.9-1`. Empty bands are omitted.

A probability near `0.5` means "don't know", not "medium". Accuracy in the low bands is the one to distrust first.
