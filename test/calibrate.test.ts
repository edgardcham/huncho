import { test } from "node:test";
import assert from "node:assert/strict";
import { calibrate, type JournalRecord } from "../src/index.js";

function record(overrides: Partial<JournalRecord> = {}): JournalRecord {
  return {
    t: "2026-09-19T08:00:00.000Z",
    huncho: "support.route",
    key: "ticket-1",
    provider: "scripted",
    model: "scripted-1",
    stateHash: "state",
    questionsHash: "questions",
    answers: { urgent: { type: "noul", noul: 0.5 } },
    outcome: "page",
    path: ["page"],
    usage: { inputTokens: 1, outputTokens: 1 },
    ms: 1,
    ...overrides,
  };
}

function noulRecord(p: number, key = "ticket"): JournalRecord {
  return record({ key, answers: { urgent: { type: "noul", noul: p } } });
}

test("six labeled noul records produce the hand-computed Brier, base rate and buckets", () => {
  // p      y   (p-y)^2   conf = max(p, 1-p)
  // 0      0   0         1
  // 0.25   0   0.0625    0.75
  // 0.5    0   0.25      0.5
  // 0.5    1   0.25      0.5
  // 0.75   1   0.0625    0.75
  // 1      1   0         1
  const truths = new Map<string, boolean>([
    ["a", false],
    ["b", false],
    ["c", false],
    ["d", true],
    ["e", true],
    ["f", true],
  ]);
  const records = [
    noulRecord(0, "a"),
    noulRecord(0.25, "b"),
    noulRecord(0.5, "c"),
    noulRecord(0.5, "d"),
    noulRecord(0.75, "e"),
    noulRecord(1, "f"),
  ];

  const report = calibrate(records, {
    question: "urgent",
    outcome: (rec) => truths.get(rec.key),
  });

  assert.equal(report.n, 6);
  assert.equal(report.brier, 0.625 / 6);
  assert.equal(report.baseRate, 0.5);
  assert.equal(report.baseBrier, 0.25);
  assert.deepEqual(report.reliability, [
    { lo: 0, hi: 0.1, n: 1, meanP: 0, observed: 0 },
    { lo: 0.2, hi: 0.3, n: 1, meanP: 0.25, observed: 0 },
    { lo: 0.5, hi: 0.6, n: 2, meanP: 0.5, observed: 0.5 },
    { lo: 0.7, hi: 0.8, n: 1, meanP: 0.75, observed: 1 },
    { lo: 0.9, hi: 1, n: 1, meanP: 1, observed: 1 },
  ]);
  assert.deepEqual(report.accuracyByConfidence, [
    { lo: 0.5, hi: 0.6, n: 2, accuracy: 0.5 },
    { lo: 0.7, hi: 0.8, n: 2, accuracy: 1 },
    { lo: 0.9, hi: 1, n: 2, accuracy: 1 },
  ]);
});

test("empty input returns n 0, NaN metrics and empty arrays without throwing", () => {
  const report = calibrate([], {
    question: "urgent",
    outcome: () => true,
  });
  assert.equal(report.n, 0);
  assert.equal(Number.isNaN(report.brier), true);
  assert.equal(Number.isNaN(report.baseRate), true);
  assert.equal(Number.isNaN(report.baseBrier), true);
  assert.deepEqual(report.reliability, []);
  assert.deepEqual(report.accuracyByConfidence, []);
});

test("undefined outcomes, missing answers, unknown labels and unusable probabilities are skipped", () => {
  const records = [
    noulRecord(0.75, "labeled"),
    noulRecord(0.2, "unlabeled"),
    record({ key: "other-question", answers: { topic: { type: "noul", noul: 0.9 } } }),
    record({
      key: "unknown-label",
      answers: {
        urgent: {
          type: "choice",
          choice: "bug",
          probabilities: { bug: 1 },
          confidence: 1,
        },
      },
    }),
    noulRecord(Number.NaN, "nan"),
    noulRecord(1.5, "high"),
    noulRecord(-0.1, "low"),
  ];
  const report = calibrate(records, {
    question: "urgent",
    label: "billing",
    outcome: (rec) => (rec.key === "unlabeled" ? undefined : true),
  });
  assert.equal(report.n, 1);
  assert.equal(report.brier, 0.0625);
  assert.equal(report.baseRate, 1);
  assert.equal(report.baseBrier, 0);
});

test("choice and score use the labeled probability", () => {
  const choiceRec = record({
    answers: {
      topic: {
        type: "choice",
        choice: "billing",
        probabilities: { billing: 0.75, bug: 0.25 },
        confidence: 0.6,
      },
    },
  });
  const scoreRec = record({
    answers: {
      topic: {
        type: "score",
        score: 2,
        probabilities: { "0": 0.1, "1": 0.15, "2": 0.75 },
        confidence: 0.7,
      },
    },
  });

  const byLabel = calibrate([choiceRec], { question: "topic", label: "billing", outcome: () => true });
  assert.equal(byLabel.n, 1);
  assert.equal(byLabel.brier, 0.0625);
  assert.equal(byLabel.baseRate, 1);

  const byLevel = calibrate([scoreRec], { question: "topic", label: 2, outcome: () => true });
  assert.equal(byLevel.n, 1);
  assert.equal(byLevel.brier, 0.0625);
  assert.equal(byLevel.baseRate, 1);
});

test("choice and score without a label throw", () => {
  const rec = record({
    answers: {
      topic: {
        type: "choice",
        choice: "billing",
        probabilities: { billing: 0.8, bug: 0.2 },
        confidence: 0.7,
      },
    },
  });
  assert.throws(
    () => calibrate([rec], { question: "topic", outcome: () => true }),
    (err: unknown) => {
      assert.equal(err instanceof Error, true);
      assert.equal((err as Error).message, 'calibrate() needs label for choice and score questions ("topic")');
      return true;
    },
  );
});

test("non-integer, non-positive or huge buckets throw", () => {
  const rec = noulRecord(0.75, "a");
  for (const buckets of [0, -1, 1.5, Number.NaN, 1001]) {
    assert.throws(
      () => calibrate([rec], { question: "urgent", outcome: () => true, buckets }),
      (err: unknown) => {
        assert.equal(err instanceof Error, true);
        assert.equal((err as Error).message, "calibrate() buckets must be a positive integer at most 1000");
        return true;
      },
    );
  }
});

test("buckets splits reliability into that many equal-width bins", () => {
  const truths = new Map<string, boolean>([
    ["a", false],
    ["b", false],
    ["c", true],
    ["d", true],
  ]);
  const report = calibrate(
    [noulRecord(0.25, "a"), noulRecord(0.25, "b"), noulRecord(0.75, "c"), noulRecord(1, "d")],
    { question: "urgent", outcome: (rec) => truths.get(rec.key), buckets: 2 },
  );
  assert.deepEqual(report.reliability, [
    { lo: 0, hi: 0.5, n: 2, meanP: 0.25, observed: 0 },
    { lo: 0.5, hi: 1, n: 2, meanP: 0.875, observed: 1 },
  ]);
});
