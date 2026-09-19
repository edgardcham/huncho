---
title: Calibration
description: "Whether journaled probabilities meant anything: Brier score against the base rate, a reliability table, accuracy by confidence band."
---

`calibrate(records, { question, label?, outcome, buckets? })` is a pure function over `JournalRecord[]`. It never calls a model. It answers whether one question's probabilities mean anything on labeled data.

## What you pass

- `question`: the answer key to score.
- `label`: required for `choice` and `score`. A choice label, or a score level index (`0`, `1`, …). `noul` uses its own probability and ignores `label`.
- `outcome(record)`: what actually happened for the event that probability is about. Return `undefined` to skip an unlabeled record.
- `buckets`: how many equal-width reliability bins to use on `[0, 1]`. Default `10`. Must be a positive integer at most `1000`. Empty bins are omitted.

Records with no answer for `question`, a choice/score whose `label` is missing from `probabilities`, or a probability that is not finite and in `[0, 1]`, are skipped. A choice or score answer scored without `label`, or a `buckets` outside its range, is a `ConfigError`. If nothing remains, the result is `{ n: 0, brier: NaN, baseRate: NaN, baseBrier: NaN, reliability: [], accuracyByConfidence: [] }`.

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
