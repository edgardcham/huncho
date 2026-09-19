import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryJournal, sha256, stableStringify, type JournalRecord } from "../src/index.js";

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
