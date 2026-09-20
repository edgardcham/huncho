import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AnswerError,
  ConfigError,
  huncho,
  noul,
  readJournal,
  replay,
  type Huncho,
  type JournalRecord,
  type RawAnswer,
} from "../src/index.js";
import { scriptedModel } from "huncho/testing";

const questions = {
  urgent: noul("Does this need a human within the hour?"),
};

function answers(noul: number): Record<string, RawAnswer> {
  return { urgent: { type: "noul", noul } };
}

function record(overrides: Partial<JournalRecord> = {}): JournalRecord {
  return {
    t: "2026-09-19T08:00:00.000Z",
    id: "6f1d2c3e-8a4b-4c5d-9e6f-7a8b9c0d1e2f",
    huncho: "support.route",
    key: "ticket-1",
    provider: "scripted",
    model: "scripted",
    stateHash: "state",
    questionsHash: "questions",
    answers: answers(0.91),
    outcome: "page",
    via: "enter",
    path: ["page"],
    usage: { inputTokens: 0, outputTokens: 0 },
    ms: 1,
    ...overrides,
  };
}

function route(model: ReturnType<typeof scriptedModel>["model"]) {
  return huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
    .else("wait");
}

test("replaying an unchanged huncho moves nothing and does not call the model", () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }]);
  const records = [
    record({ key: "ticket-1", answers: answers(0.91), outcome: "page" }),
    record({ key: "ticket-1", answers: answers(0.7), outcome: "page", previous: "page" }),
    record({ key: "ticket-2", answers: answers(0.4), outcome: "wait" }),
  ];

  const replayed = replay(records, route(model));

  assert.equal(requests.length, 0);
  assert.equal(replayed.n, 3);
  assert.equal(replayed.changed, 0);
  assert.deepEqual(
    replayed.results.map((row) => ({ outcome: row.outcome, via: row.via, changed: row.changed })),
    [
      { outcome: "page", via: "enter", changed: false },
      { outcome: "page", via: "hold", changed: false },
      { outcome: "wait", via: "else", changed: false },
    ],
  );
  assert.equal(replayed.results[0]?.record, records[0]);
  assert.deepEqual(replayed.outcomes, { page: 2, wait: 1 });
});

test("raising a threshold with with() flips the records that no longer enter", () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }]);
  const records = [
    record({ key: "a", answers: answers(0.85), outcome: "page" }),
    record({ key: "b", answers: answers(0.95), outcome: "page" }),
  ];

  const replayed = replay(records, route(model).with({ page: { enter: 0.9 } }));

  assert.equal(requests.length, 0);
  assert.equal(replayed.changed, 1);
  assert.equal(replayed.results[0]?.outcome, "wait");
  assert.equal(replayed.results[0]?.changed, true);
  assert.equal(replayed.results[1]?.outcome, "page");
  assert.equal(replayed.results[1]?.changed, false);
  assert.deepEqual(replayed.outcomes, { wait: 1, page: 1 });
});

test("records for other huncho names are ignored", () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }]);
  const records = [
    record({ huncho: "billing.route", answers: answers(0.95), outcome: "page" }),
    record({ answers: answers(0.4), outcome: "wait" }),
  ];

  const replayed = replay(records, route(model));

  assert.equal(requests.length, 0);
  assert.equal(replayed.n, 1);
  assert.equal(replayed.changed, 0);
  assert.equal(replayed.results[0]?.record, records[1]);
  assert.deepEqual(replayed.outcomes, { wait: 1 });
});

test("a record missing a question the huncho now asks throws naming the question", () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }]);
  const built = huncho("support.route", { model })
    .ask({
      urgent: noul("Does this need a human within the hour?"),
      refund: noul("Is this a refund request?"),
    })
    .when((a) => a.urgent.p, { enter: 0.8 }, "page")
    .else("wait");

  assert.throws(
    () => replay([record()], built),
    (err: unknown) => {
      assert.equal(AnswerError.isInstance(err), true);
      assert.match((err as Error).message, /^no answer for question "refund"/);
      return true;
    },
  );
  assert.equal(requests.length, 0);
});

test("a slice that starts mid-hold keeps the journaled previous for that key", () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }]);
  const records = [
    record({ key: "ticket-1", answers: answers(0.7), outcome: "page", previous: "page" }),
    record({ key: "ticket-1", answers: answers(0.65), outcome: "page", previous: "page" }),
  ];

  const replayed = replay(records, route(model));

  assert.equal(requests.length, 0);
  assert.equal(replayed.changed, 0);
  assert.deepEqual(
    replayed.results.map((row) => row.outcome),
    ["page", "page"],
  );

  const raised = replay(
    [
      records[0]!,
      record({ key: "ticket-1", answers: answers(0.85), outcome: "page", previous: "page" }),
    ],
    route(model).with({ page: { enter: 0.9, exit: 0.72 } }),
  );
  assert.deepEqual(
    raised.results.map((row) => ({ outcome: row.outcome, changed: row.changed })),
    [
      { outcome: "wait", changed: true },
      { outcome: "wait", changed: true },
    ],
  );
});

test("outcome counts stay correct when a name collides with Object.prototype", () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }]);
  const built = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "constructor")
    .else("wait");
  const records = [
    record({ answers: answers(0.91), outcome: "constructor" }),
    record({ key: "ticket-2", answers: answers(0.91), outcome: "constructor" }),
    record({ key: "ticket-3", answers: answers(0.1), outcome: "wait" }),
  ];

  const replayed = replay(records, built);

  assert.equal(requests.length, 0);
  assert.equal(replayed.changed, 0);
  assert.equal(replayed.outcomes.constructor, 2);
  assert.equal(replayed.outcomes.wait, 1);
  assert.equal(Object.hasOwn(replayed.outcomes, "constructor"), true);
});

test("replay chains hysteresis per key in record order", () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }]);
  const records = [
    record({ key: "ticket-1", answers: answers(0.91), outcome: "wait" }),
    record({ key: "ticket-1", answers: answers(0.7), outcome: "wait" }),
    record({ key: "ticket-2", answers: answers(0.7), outcome: "wait" }),
  ];

  const replayed = replay(records, route(model));

  assert.equal(requests.length, 0);
  assert.deepEqual(
    replayed.results.map((row) => ({ key: row.record.key, outcome: row.outcome, changed: row.changed })),
    [
      { key: "ticket-1", outcome: "page", changed: true },
      { key: "ticket-1", outcome: "page", changed: true },
      { key: "ticket-2", outcome: "wait", changed: false },
    ],
  );
  assert.equal(replayed.changed, 2);
  assert.deepEqual(replayed.outcomes, { page: 2, wait: 1 });
});

test("replay results say how the current policy reached each outcome, so a diff can tell a hold from an entry", () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }]);
  const records = [
    record({ key: "ticket-1", answers: answers(0.91), outcome: "page", via: "enter" }),
    record({ key: "ticket-1", answers: answers(0.7), outcome: "page", via: "hold", previous: "page" }),
    record({ key: "ticket-2", answers: answers(0.7), outcome: "wait", via: "else" }),
  ];

  const loosened = replay(records, route(model).with({ page: { enter: 0.7, exit: 0.6 } }));

  assert.equal(requests.length, 0);
  assert.deepEqual(
    loosened.results.map((row) => ({ before: row.record.via, outcome: row.outcome, via: row.via, changed: row.changed })),
    [
      { before: "enter", outcome: "page", via: "enter", changed: false },
      { before: "hold", outcome: "page", via: "enter", changed: false },
      { before: "else", outcome: "page", via: "enter", changed: true },
    ],
  );
});

test("a journal written before id and via existed still replays", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }]);
  const dir = await mkdtemp(join(tmpdir(), "huncho-replay-"));
  const path = join(dir, "decisions.jsonl");
  const older = [
    {
      t: "2026-09-19T08:00:00.000Z",
      huncho: "support.route",
      key: "ticket-1",
      provider: "scripted",
      model: "scripted",
      stateHash: "state",
      questionsHash: "questions",
      answers: answers(0.91),
      outcome: "page",
      path: ["page"],
      usage: { inputTokens: 0, outputTokens: 0 },
      ms: 1,
    },
    {
      t: "2026-09-19T08:01:00.000Z",
      huncho: "support.route",
      key: "ticket-1",
      provider: "scripted",
      model: "scripted",
      stateHash: "state",
      questionsHash: "questions",
      answers: answers(0.7),
      outcome: "page",
      previous: "page",
      path: ["page"],
      usage: { inputTokens: 0, outputTokens: 0 },
      ms: 1,
    },
  ];
  await writeFile(path, older.map((rec) => `${JSON.stringify(rec)}\n`).join(""));
  try {
    const records = await readJournal(path);
    const replayed = replay(records, route(model));

    assert.equal(requests.length, 0);
    assert.equal(records.length, 2);
    assert.equal("id" in (records[0] ?? {}), false);
    assert.equal("via" in (records[0] ?? {}), false);
    assert.equal(replayed.changed, 0);
    assert.deepEqual(
      replayed.results.map((row) => ({ outcome: row.outcome, via: row.via })),
      [
        { outcome: "page", via: "enter" },
        { outcome: "page", via: "hold" },
      ],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("replay needs the policy a huncho built, because only that one can say via", () => {
  const foreign = {
    name: "support.route",
    questions,
    policy: { decide: () => "page" as const },
  } as unknown as Huncho<unknown, typeof questions, "page">;

  assert.throws(
    () => replay([record()], foreign),
    (err: unknown) => {
      assert.equal(ConfigError.isInstance(err), true);
      assert.match((err as Error).message, /^policy was not built by policy\(\)/);
      return true;
    },
  );
});
