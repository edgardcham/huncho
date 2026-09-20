import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AnswerError,
  calibrate,
  fileLabels,
  memoryLabels,
  type Calibration,
  type JournalRecord,
  type Label,
  type Labels,
} from "../src/index.js";

function record(overrides: Partial<JournalRecord> = {}): JournalRecord {
  return {
    t: "2026-09-19T08:00:00.000Z",
    id: "6f1d2c3e-8a4b-4c5d-9e6f-7a8b9c0d1e2f",
    huncho: "support.route",
    key: "ticket-1",
    provider: "scripted",
    model: "scripted-1",
    stateHash: "state",
    questionsHash: "questions",
    answers: { urgent: { type: "noul", noul: 0.5 } },
    outcome: "page",
    via: "enter",
    path: ["page"],
    usage: { inputTokens: 1, outputTokens: 1 },
    ms: 1,
    ...overrides,
  };
}

function noulRecord(p: number, id: string): JournalRecord {
  return record({ id, key: `ticket-${id}`, answers: { urgent: { type: "noul", noul: p } } });
}

function topicRecord(id: string, probabilities: Record<string, number>): JournalRecord {
  const choice = Object.entries(probabilities).sort(([, a], [, b]) => b - a)[0]?.[0] ?? "";
  return record({ id, answers: { topic: { type: "choice", choice, probabilities, confidence: 0.6 } } });
}

function label(id: string, truth: Label["truth"], t = "2026-09-19T15:00:00.000Z"): Label {
  return { id, t, truth };
}

/** The six-record set calibrate.test.ts scores by hand: Brier 0.625/6, base rate 0.5. */
const known = {
  records: [
    noulRecord(0, "a"),
    noulRecord(0.25, "b"),
    noulRecord(0.5, "c"),
    noulRecord(0.5, "d"),
    noulRecord(0.75, "e"),
    noulRecord(1, "f"),
  ],
  truths: new Map<string, boolean>([
    ["a", false],
    ["b", false],
    ["c", false],
    ["d", true],
    ["e", true],
    ["f", true],
  ]),
};

function byCallback(): Calibration {
  return calibrate(known.records, { question: "urgent", outcome: (rec) => known.truths.get(rec.id) });
}

test("a Label[] gives the same numbers as the equivalent callback", () => {
  const labels = [...known.truths].map(([id, truth]) => label(id, truth));
  assert.deepEqual(calibrate(known.records, { question: "urgent", outcome: labels }), byCallback());
  assert.equal(byCallback().brier, 0.625 / 6);
});

test("a Labels store is read and gives the same numbers, as a promise", async () => {
  const labels = memoryLabels();
  for (const [id, truth] of known.truths) labels.write(label(id, truth));
  const pending = calibrate(known.records, { question: "urgent", outcome: labels });
  assert.ok(pending instanceof Promise);
  assert.deepEqual(await pending, byCallback());
});

test("the later t wins when one id has two labels", () => {
  const rec = noulRecord(0.9, "a");
  const early = label("a", false, "2026-09-19T15:00:00.000Z");
  const late = label("a", true, "2026-09-19T16:00:00.000Z");
  const lateWins = calibrate([rec], { question: "urgent", outcome: [late, early] });
  assert.equal(lateWins.baseRate, 1);
  const stillLateWins = calibrate([rec], { question: "urgent", outcome: [early, late] });
  assert.equal(stillLateWins.baseRate, 1);
});

test("an unlabelled record is skipped, not counted", () => {
  const report = calibrate([noulRecord(0.75, "labelled"), noulRecord(0.2, "unlabelled")], {
    question: "urgent",
    outcome: [label("labelled", true)],
  });
  assert.equal(report.n, 1);
  assert.equal(report.brier, 0.0625);
});

test("a label for a record that lacks the question is skipped", () => {
  const report = calibrate([record({ id: "x", answers: { topic: { type: "noul", noul: 0.9 } } })], {
    question: "urgent",
    outcome: [label("x", true)],
  });
  assert.equal(report.n, 0);
});

test("a choice truth counts as true when it equals the label and false otherwise", () => {
  const records = [topicRecord("right", { billing: 0.75, bug: 0.25 }), topicRecord("wrong", { billing: 0.25, bug: 0.75 })];
  const report = calibrate(records, {
    question: "topic",
    label: "billing",
    outcome: [label("right", "billing"), label("wrong", "bug")],
  });
  assert.equal(report.n, 2);
  assert.equal(report.baseRate, 0.5);
  assert.equal(report.brier, 0.0625);
});

test("a score truth is compared to the level index", () => {
  const rec = record({
    id: "s",
    answers: { quality: { type: "score", score: 2, probabilities: { "0": 0.1, "1": 0.15, "2": 0.75 }, confidence: 0.7 } },
  });
  assert.equal(calibrate([rec], { question: "quality", label: 2, outcome: [label("s", 2)] }).baseRate, 1);
  assert.equal(calibrate([rec], { question: "quality", label: 2, outcome: [label("s", 1)] }).baseRate, 0);
});

test("a truth of the wrong shape is an AnswerError naming the decision id", () => {
  const cases: { readonly rec: JournalRecord; readonly truth: Label["truth"]; readonly label?: string | number }[] = [
    { rec: noulRecord(0.9, "n"), truth: "yes" },
    { rec: noulRecord(0.9, "n"), truth: 1 },
    { rec: topicRecord("c", { billing: 0.75, bug: 0.25 }), truth: true, label: "billing" },
    { rec: topicRecord("c", { billing: 0.75, bug: 0.25 }), truth: 0, label: "billing" },
    {
      rec: record({ id: "s", answers: { quality: { type: "score", score: 1, probabilities: { "0": 0.5, "1": 0.5 }, confidence: 0.5 } } }),
      truth: "1",
      label: 1,
    },
    {
      rec: record({ id: "s", answers: { quality: { type: "score", score: 1, probabilities: { "0": 0.5, "1": 0.5 }, confidence: 0.5 } } }),
      truth: 1.5,
      label: 1,
    },
  ];
  for (const { rec, truth, label: expected } of cases) {
    const question = Object.keys(rec.answers)[0] ?? "";
    assert.throws(
      () => calibrate([rec], { question, ...(expected === undefined ? {} : { label: expected }), outcome: [label(rec.id, truth)] }),
      (err: unknown) => {
        assert.equal(AnswerError.isInstance(err), true);
        assert.match((err as Error).message, new RegExp(`^label for decision "${rec.id}" has truth ${JSON.stringify(truth)}`));
        return true;
      },
      `${rec.id}: ${JSON.stringify(truth)}`,
    );
  }
});

test("a wrong-shaped truth in a Labels store rejects the promise", async () => {
  const labels = memoryLabels();
  labels.write(label("n", "yes"));
  await assert.rejects(
    () => calibrate([noulRecord(0.9, "n")], { question: "urgent", outcome: labels }),
    (err: unknown) => AnswerError.isInstance(err),
  );
});

test("memory labels keep write order and hand out copies", async () => {
  const labels = memoryLabels();
  const first = { id: "a", t: "2026-09-19T15:00:00.000Z", truth: true, note: "first" };
  labels.write(first);
  labels.write(label("b", "billing"));
  first.truth = false;

  const once = await labels.read();
  assert.deepEqual(once, [{ id: "a", t: "2026-09-19T15:00:00.000Z", truth: true, note: "first" }, label("b", "billing")]);
  (once[0] as { truth: Label["truth"] }).truth = "mutated";
  assert.equal((await labels.read())[0]?.truth, true);
  assert.equal(labels.labels.length, 2);
});

test("file labels round-trip through read", async () => {
  await withTempPath(async (path) => {
    const labels: Labels = fileLabels(path);
    await labels.write(label("a", true));
    await labels.write({ id: "b", t: "2026-09-19T15:00:00.000Z", truth: "billing", note: "refund issued" });
    await labels.write(label("c", 2));
    assert.deepEqual(await labels.read(), [
      label("a", true),
      { id: "b", t: "2026-09-19T15:00:00.000Z", truth: "billing", note: "refund issued" },
      label("c", 2),
    ]);
    assert.deepEqual(await fileLabels(path).read(), await labels.read());
  });
});

test("file labels feed calibrate across processes", async () => {
  await withTempPath(async (path) => {
    const writer = fileLabels(path);
    for (const [id, truth] of known.truths) await writer.write(label(id, truth));
    assert.deepEqual(await calibrate(known.records, { question: "urgent", outcome: fileLabels(path) }), byCallback());
  });
});

test("concurrent file label writes land in call order and read waits for them", async () => {
  await withTempPath(async (path) => {
    const labels = fileLabels(path);
    const writes = Promise.all(Array.from({ length: 10 }, (_, i) => labels.write(label(`k${i}`, i % 2 === 0))));
    const read = await labels.read();
    assert.deepEqual(
      read.map((l) => l.id),
      Array.from({ length: 10 }, (_, i) => `k${i}`),
    );
    await writes;
  });
});

test("a torn last line does not hide earlier labels", async () => {
  await withTempPath(async (path) => {
    await fileLabels(path).write(label("kept", true));
    await appendFile(path, '{"id":"torn","t":');
    assert.deepEqual(await fileLabels(path).read(), [label("kept", true)]);
  });
});

test("a complete invalid line is rejected and a missing file reads as empty", async () => {
  await withTempPath(async (path) => {
    assert.deepEqual(await fileLabels(path).read(), []);
    await fileLabels(path).write(label("kept", true));
    await appendFile(path, "not-json\n");
    await assert.rejects(() => fileLabels(path).read(), SyntaxError);
  });
});

async function withTempPath(fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "huncho-labels-"));
  try {
    await fn(join(dir, "labels.jsonl"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
