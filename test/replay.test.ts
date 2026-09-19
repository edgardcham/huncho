import { test } from "node:test";
import assert from "node:assert/strict";
import { huncho, noul, replay, type JournalRecord, type RawAnswer } from "../src/index.js";
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
    replayed.results.map((row) => ({ outcome: row.outcome, changed: row.changed })),
    [
      { outcome: "page", changed: false },
      { outcome: "page", changed: false },
      { outcome: "wait", changed: false },
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
      assert.equal(err instanceof Error, true);
      assert.equal((err as Error).message, 'no answer for question "refund"');
      return true;
    },
  );
  assert.equal(requests.length, 0);
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
