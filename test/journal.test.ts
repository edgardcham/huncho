import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import {
  fileJournal,
  memoryJournal,
  readJournal,
  sha256,
  stableStringify,
  type JournalRecord,
} from "../src/index.js";

function record(overrides: Partial<JournalRecord> = {}) {
  return {
    t: "2026-09-19T08:00:00.000Z",
    huncho: "support.route",
    key: "ticket-1",
    provider: "scripted",
    model: "scripted-1",
    stateHash: "state",
    questionsHash: "questions",
    answers: { urgent: { type: "noul" as const, noul: 0.91 } },
    outcome: "page",
    path: ["page"],
    usage: { inputTokens: 12, outputTokens: 4 },
    ms: 7,
    ...overrides,
  };
}

test("same state in different key order produces the same stateHash", async () => {
  const left = { subject: "invoice", body: { text: "overdue", n: 2 } };
  const right = { body: { n: 2, text: "overdue" }, subject: "invoice" };
  assert.equal(stableStringify(left), stableStringify(right));
  assert.equal(await sha256(stableStringify(left)), await sha256(stableStringify(right)));
});

test("distinct dates produce distinct hashes", async () => {
  const earlier = { when: new Date("2026-01-01T00:00:00.000Z") };
  const later = { when: new Date("2026-06-01T00:00:00.000Z") };
  assert.equal(stableStringify(earlier), '{"when":"2026-01-01T00:00:00.000Z"}');
  assert.equal(stableStringify(earlier), stableStringify({ when: "2026-01-01T00:00:00.000Z" }));
  assert.notEqual(stableStringify(earlier), stableStringify(later));
  assert.notEqual(await sha256(stableStringify(earlier)), await sha256(stableStringify(later)));
});

test("toJSON receives the property key and is applied once", () => {
  const keyed = {
    a: {
      toJSON(key: string) {
        return key;
      },
    },
  };
  assert.equal(stableStringify(keyed), JSON.stringify(keyed));

  const nested = {
    toJSON() {
      return {
        toJSON() {
          return "inner";
        },
      };
    },
  };
  assert.equal(stableStringify(nested), JSON.stringify(nested));
});

test("memory journal preserves write order and returns copies", async () => {
  const journal = memoryJournal();
  const first = record({ key: "a", outcome: "page", path: ["page"] });
  const second = record({
    key: "b",
    outcome: "billing",
    previous: "page",
    path: ["billing"],
    state: { subject: "invoice" },
  });

  journal.write(first);
  journal.write(second);
  first.outcome = "mutated-input";
  first.answers.urgent = { type: "noul", noul: 0 };

  const once = await journal.read();
  assert.equal(once.length, 2);
  assert.equal(once[0]?.key, "a");
  assert.equal(once[0]?.outcome, "page");
  assert.equal(once[0]?.answers.urgent?.type, "noul");
  if (once[0]?.answers.urgent?.type === "noul") assert.equal(once[0].answers.urgent.noul, 0.91);
  assert.equal(once[1]?.key, "b");
  assert.equal(once[1]?.previous, "page");
  assert.deepEqual(once[1]?.state, { subject: "invoice" });
  assert.equal(journal.records.length, 2);

  const firstCopy = once[0];
  assert.ok(firstCopy);
  (firstCopy as { outcome: string }).outcome = "mutated-read";
  firstCopy.answers.urgent = { type: "noul", noul: 0.1 };

  const twice = await journal.read();
  assert.equal(twice[0]?.outcome, "page");
  if (twice[0]?.answers.urgent?.type === "noul") assert.equal(twice[0].answers.urgent.noul, 0.91);
  assert.equal(twice[1]?.outcome, "billing");
});

test("concurrent writes land in call order", async () => {
  await withTempPath(async (path) => {
    const journal = fileJournal(path);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        journal.write(record({ key: `k${i}`, outcome: `o${i}`, path: [`o${i}`] })),
      ),
    );
    const records = await journal.read();
    assert.deepEqual(
      records.map((rec) => rec.key),
      Array.from({ length: 10 }, (_, i) => `k${i}`),
    );
  });
});

test("read waits for pending writes", async () => {
  await withTempPath(async (path) => {
    const journal = fileJournal(path);
    const writes = Promise.all(
      Array.from({ length: 10 }, (_, i) => journal.write(record({ key: `k${i}` }))),
    );
    const records = await journal.read();
    assert.equal(records.length, 10);
    assert.equal(records[0]?.key, "k0");
    assert.equal(records[9]?.key, "k9");
    await writes;
  });
});

test("a missing file reads as empty", async () => {
  await withTempPath(async (path) => {
    assert.deepEqual(await readJournal(path), []);
    assert.deepEqual(await fileJournal(path).read(), []);
  });
});

test("state is omitted unless includeState; unknown fields survive a round trip", async () => {
  await withTempPath(async (path) => {
    const extra = { ...record({ state: { subject: "invoice" } }), extra: "keep" };
    await fileJournal(path).write(extra);
    const omitted = await readJournal(path);
    assert.equal(omitted.length, 1);
    assert.equal("state" in (omitted[0] ?? {}), false);
    assert.equal((omitted[0] as { extra?: string }).extra, "keep");
  });

  await withTempPath(async (path) => {
    const withState = record({ state: { subject: "invoice" } });
    await fileJournal(path, { includeState: true }).write(withState);
    const kept = await readJournal(path);
    assert.deepEqual(kept[0]?.state, { subject: "invoice" });
  });
});

test("importing the package entry does not load node: modules", async () => {
  const worker = new Worker(new URL("./file-journal-edge-worker.js", import.meta.url));
  const result = await new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`worker exited ${code}`));
    });
  });
  await worker.terminate();
  assert.equal(result.ok, true, result.error);
});

async function withTempPath(fn: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "huncho-journal-"));
  try {
    await fn(join(dir, "decisions.jsonl"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
