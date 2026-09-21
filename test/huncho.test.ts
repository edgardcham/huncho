import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ConfigError,
  createProvider,
  huncho,
  memoryJournal,
  noul,
  PolicyError,
  replay,
  sha256,
  stableStringify,
  type Decision,
  type Journal,
  type RawAnswer,
  type State,
} from "../src/index.js";
import { scriptedModel } from "huncho/testing";

const questions = {
  urgent: noul("Does this need a human within the hour?"),
};

const childQuestions = {
  human: noul("Should a person take this?"),
};

function answers(noul: number): Record<string, RawAnswer> {
  return { urgent: { type: "noul", noul } };
}

function childAnswers(noul: number): Record<string, RawAnswer> {
  return { human: { type: "noul", noul } };
}

function route(
  model: ReturnType<typeof scriptedModel>["model"],
  journal?: ReturnType<typeof memoryJournal>,
) {
  const built = huncho("support.route", journal === undefined ? { model } : { model, journal })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
    .else("wait");
  return built;
}

test("shape output is exactly what the model receives", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }]);
  const input = { subject: "invoice", secret: "card-number" };
  const built = huncho("support.route", { model })
    .shape((ticket: typeof input) => ({ subject: ticket.subject }))
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "page")
    .else("wait");

  const decision = await built.decide(input);
  assert.deepEqual(requests[0]?.state, { subject: "invoice" });
  assert.equal(requests[0]?.questions, questions);
  assert.deepEqual(decision.state, { subject: "invoice" });
  assert.equal("secret" in (requests[0]?.state as object), false);
});

test("without shape the input is the state the model sees", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }]);
  const state = { subject: "invoice", body: "overdue" };
  await route(model).decide(state);
  assert.equal(requests[0]?.state, state);
});

test("hysteresis holds across decide calls with the same key and not across keys", async () => {
  const { model } = scriptedModel([
    { answers: answers(0.91) },
    { answers: answers(0.7) },
    { answers: answers(0.7) },
    { answers: answers(0.5) },
  ]);
  const built = route(model);

  const first = await built.decide("one", { key: "ticket-1" });
  const held = await built.decide("two", { key: "ticket-1" });
  const other = await built.decide("three", { key: "ticket-2" });
  const dropped = await built.decide("four", { key: "ticket-1" });

  assert.equal(first.outcome, "page");
  assert.equal(first.previous, undefined);
  assert.equal(held.outcome, "page");
  assert.equal(held.previous, "page");
  assert.equal(other.outcome, "wait");
  assert.equal(other.previous, undefined);
  assert.equal(dropped.outcome, "wait");
  assert.equal(dropped.previous, "page");
});

test("decide writes one journal record with the outcome, key and hashes", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }, { answers: answers(0.7) }]);
  const journal = memoryJournal();
  const built = route(model, journal);
  const state = { subject: "invoice" };

  const first = await built.decide(state, { key: "ticket-1" });
  const second = await built.decide({ subject: "follow-up" }, { key: "ticket-1" });
  const records = await journal.read();

  assert.equal(records.length, 2);
  const expectedFirst = {
    huncho: "support.route",
    key: "ticket-1",
    provider: "scripted",
    model: "scripted",
    stateHash: await sha256(stableStringify(state)),
    questionsHash: await sha256(stableStringify(questions)),
    answers: answers(0.91),
    outcome: "page",
    path: ["page"],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  assert.equal(records[0]?.t.includes("T"), true);
  assert.equal(Number.isNaN(Date.parse(records[0]?.t ?? "")), false);
  assert.equal(records[0]?.state, undefined);
  assert.deepEqual(
    {
      huncho: records[0]?.huncho,
      key: records[0]?.key,
      provider: records[0]?.provider,
      model: records[0]?.model,
      stateHash: records[0]?.stateHash,
      questionsHash: records[0]?.questionsHash,
      answers: records[0]?.answers,
      outcome: records[0]?.outcome,
      path: records[0]?.path,
      usage: records[0]?.usage,
    },
    expectedFirst,
  );
  assert.equal(records[0]?.previous, undefined);
  assert.equal(records[1]?.outcome, "page");
  assert.equal(records[1]?.previous, "page");
  assert.equal(records[1]?.key, "ticket-1");
  assert.deepEqual(first.path, ["page"]);
  assert.equal(first.stateHash, expectedFirst.stateHash);
  assert.equal(first.outcome, "page");
  assert.equal(second.outcome, "page");
  assert.equal(second.previous, "page");
  assert.equal(second.key, "ticket-1");
});

test("every decide gets its own id, shared with the record it wrote, and a root has no parentId", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }, { answers: answers(0.91) }]);
  const journal = memoryJournal();
  const built = route(model, journal);

  const first = await built.decide("one", { key: "ticket-1" });
  const second = await built.decide("two", { key: "ticket-2" });
  const records = await journal.read();

  assert.equal(typeof first.id, "string");
  assert.notEqual(first.id, "");
  assert.notEqual(first.id, second.id);
  assert.equal(records[0]?.id, first.id);
  assert.equal(records[1]?.id, second.id);
  assert.equal(first.parentId, undefined);
  assert.equal("parentId" in first, false);
  assert.equal(records[0]?.parentId, undefined);
  assert.equal("parentId" in (records[0] ?? {}), false);
});

test("a parentId supplied by the caller lands on the decision and its record under a fresh id", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }, { answers: answers(0.91) }]);
  const journal = memoryJournal();
  const built = route(model, journal);

  const chooser = await built.decide("one", { key: "ticket-1" });
  const chosen = await built.decide("two", { key: "ticket-1", parentId: chooser.id });
  const records = await journal.read();

  assert.equal(chosen.parentId, chooser.id);
  assert.notEqual(chosen.id, chooser.id);
  assert.equal(records[1]?.id, chosen.id);
  assert.equal(records[1]?.parentId, chooser.id);
  assert.equal(chooser.parentId, undefined);
  assert.equal(records[0]?.parentId, undefined);
  const replayed = replay(records, built);
  assert.equal(replayed.n, 2);
  assert.equal(replayed.changed, 0);
});

test("via says whether a numeric clause entered, held, or the else covered it", async () => {
  const { model } = scriptedModel([
    { answers: answers(0.91) },
    { answers: answers(0.7) },
    { answers: answers(0.5) },
    { answers: answers(0.7) },
  ]);
  const journal = memoryJournal();
  const built = route(model, journal);

  const entered = await built.decide("one", { key: "ticket-1" });
  const held = await built.decide("two", { key: "ticket-1" });
  const fell = await built.decide("three", { key: "ticket-1" });
  const stayed = await built.decide("four", { key: "ticket-1" });

  assert.deepEqual(
    [entered, held, fell, stayed].map((d) => [d.outcome, d.via]),
    [
      ["page", "enter"],
      ["page", "hold"],
      ["wait", "else"],
      ["wait", "else"],
    ],
  );
  assert.deepEqual(
    (await journal.read()).map((rec) => rec.via),
    ["enter", "hold", "else", "else"],
  );
});

test("via says whether a boolean clause entered, held, or the else covered it", async () => {
  const { model } = scriptedModel([{ answers: answers(0.9) }, { answers: answers(0.45) }, { answers: answers(0.2) }]);
  const journal = memoryJournal();
  const built = huncho("support.route", { model, journal })
    .ask(questions)
    .when((a) => a.urgent.yes, "page", { exit: (a) => a.urgent.p >= 0.4 })
    .else("wait");

  const entered = await built.decide("one", { key: "ticket-1" });
  const held = await built.decide("two", { key: "ticket-1" });
  const fell = await built.decide("three", { key: "ticket-1" });

  assert.deepEqual(
    [entered, held, fell].map((d) => [d.outcome, d.via]),
    [
      ["page", "enter"],
      ["page", "hold"],
      ["wait", "else"],
    ],
  );
  assert.deepEqual(
    (await journal.read()).map((rec) => rec.via),
    ["enter", "hold", "else"],
  );
});

test("decide defaults the hysteresis key to default", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }]);
  const journal = memoryJournal();
  const decision = await route(model, journal).decide("plain");
  const records = await journal.read();
  assert.equal(decision.key, "default");
  assert.equal(records[0]?.key, "default");
});

test("an abort signal reaches the model", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }]);
  const signal = new AbortController().signal;
  await route(model).decide("plain", { signal });
  assert.equal(requests[0]?.signal, signal);
});

test("evaluate asks the model and skips policy, memory and the journal", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }, { answers: answers(0.7) }]);
  const journal = memoryJournal();
  const built = huncho("support.route", { model, journal })
    .shape((ticket: { subject: string; secret: string }) => ({ subject: ticket.subject }))
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
    .else("wait");

  const evaluated = await built.evaluate({ subject: "invoice", secret: "hidden" });
  assert.deepEqual(requests[0]?.state, { subject: "invoice" });
  assert.deepEqual(evaluated.state, { subject: "invoice" });
  assert.equal(evaluated.answers.urgent.p, 0.91);
  assert.equal(evaluated.raw.urgent?.type, "noul");
  assert.deepEqual(evaluated.usage, { inputTokens: 0, outputTokens: 0 });
  assert.equal(Number.isFinite(evaluated.ms) && evaluated.ms >= 0, true);
  assert.equal((await journal.read()).length, 0);

  const decision = await built.decide({ subject: "later", secret: "hidden" }, { key: "ticket-1" });
  assert.equal(decision.outcome, "wait");
  assert.equal(decision.previous, undefined);
  assert.equal((await journal.read()).length, 1);
});

test("builder methods return new values and leave the previous policy untouched", async () => {
  const { model } = scriptedModel([{ answers: answers(0.1) }, { answers: answers(0.1) }]);
  const asked = huncho("support.route", { model }).ask(questions);
  const paged = asked.when((a) => a.urgent.p, { enter: 0.8 }, "page");
  const complete = paged.else("wait");

  assert.notEqual(asked, paged);
  assert.notEqual(paged, complete);
  await assert.rejects(
    () => paged.decide("plain"),
    (err: unknown) => {
      assert.equal(PolicyError.isInstance(err), true);
      assert.match((err as Error).message, /^policy "support.route": no clause matched and there is no else/);
      return true;
    },
  );
  assert.equal((await complete.decide("plain")).outcome, "wait");
});

test("ask after when starts a new policy for the new questions", async () => {
  const { model } = scriptedModel([{ answers: { mood: { type: "noul", noul: 0.91 } } }]);
  const built = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "page")
    .ask({ mood: noul("Is the customer upset?") })
    .else("wait");

  const decision = await built.decide("plain");
  assert.equal(decision.outcome, "wait");
});

test("forked builders do not share hysteresis memory", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }, { answers: answers(0.7) }]);
  const root = huncho("support.route", { model }).ask(questions);
  const left = root.when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page").else("wait");
  const right = root.when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page").else("wait");

  assert.equal((await left.decide("one", { key: "ticket-1" })).outcome, "page");
  const other = await right.decide("two", { key: "ticket-1" });
  assert.equal(other.outcome, "wait");
  assert.equal(other.previous, undefined);
});

test("overlapping decide calls on one key run in order", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }, { answers: answers(0.7) }]);
  const built = route(model);
  const [first, second] = await Promise.all([
    built.decide("one", { key: "ticket-1" }),
    built.decide("two", { key: "ticket-1" }),
  ]);
  assert.equal(first.outcome, "page");
  assert.equal(first.previous, undefined);
  assert.equal(second.outcome, "page");
  assert.equal(second.previous, "page");
});

test("a previous supplied by the caller holds on a key this huncho has never seen", async () => {
  const { model } = scriptedModel([{ answers: answers(0.7) }, { answers: answers(0.7) }]);
  const journal = memoryJournal();
  const built = route(model, journal);

  const resumed = await built.decide("one", { key: "ticket-1", previous: "page" });
  assert.equal(resumed.outcome, "page");
  assert.equal(resumed.via, "hold");
  assert.equal(resumed.previous, "page");
  const records = await journal.read();
  assert.equal(records[0]?.previous, "page");
  assert.equal(records[0]?.via, "hold");

  const remembered = await built.decide("two", { key: "ticket-1" });
  assert.equal(remembered.outcome, "page");
  assert.equal(remembered.previous, "page");
});

test("previous null forces a fresh decision on a key that was held", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }, { answers: answers(0.7) }, { answers: answers(0.7) }]);
  const built = route(model);

  assert.equal((await built.decide("one", { key: "ticket-1" })).outcome, "page");
  const fresh = await built.decide("two", { key: "ticket-1", previous: null });
  assert.equal(fresh.outcome, "wait");
  assert.equal(fresh.via, "else");
  assert.equal(fresh.previous, undefined);

  const after = await built.decide("three", { key: "ticket-1" });
  assert.equal(after.outcome, "wait");
  assert.equal(after.previous, "wait");
});

test("a supplied previous applies to the call it was given to, in queue order", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }, { answers: answers(0.7) }, { answers: answers(0.7) }]);
  const built = route(model);
  const [first, second, third] = await Promise.all([
    built.decide("one", { key: "ticket-1" }),
    built.decide("two", { key: "ticket-1", previous: null }),
    built.decide("three", { key: "ticket-1" }),
  ]);
  assert.equal(first.outcome, "page");
  assert.equal(second.outcome, "wait");
  assert.equal(second.previous, undefined);
  assert.equal(third.outcome, "wait");
  assert.equal(third.previous, "wait");
});

test("memory bounds the keys held, the least recently used going first", async () => {
  const { model } = scriptedModel([
    { answers: answers(0.91) },
    { answers: answers(0.91) },
    { answers: answers(0.91) },
    { answers: answers(0.7) },
    { answers: answers(0.7) },
    { answers: answers(0.7) },
  ]);
  const built = huncho("support.route", { model, memory: 2 })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
    .else("wait");

  for (const key of ["ticket-1", "ticket-2", "ticket-3"]) {
    assert.equal((await built.decide("enter", { key })).outcome, "page");
  }

  const evicted = await built.decide("again", { key: "ticket-1" });
  assert.equal(evicted.outcome, "wait");
  assert.equal(evicted.previous, undefined);

  const kept = await built.decide("again", { key: "ticket-3" });
  assert.equal(kept.outcome, "page");
  assert.equal(kept.previous, "page");

  const displaced = await built.decide("again", { key: "ticket-2" });
  assert.equal(displaced.outcome, "wait");
  assert.equal(displaced.previous, undefined);
});

test("memory zero never holds unless the caller supplies previous", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }, { answers: answers(0.7) }, { answers: answers(0.7) }]);
  const built = huncho("support.route", { model, memory: 0 })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
    .else("wait");

  assert.equal((await built.decide("one", { key: "ticket-1" })).outcome, "page");
  const forgotten = await built.decide("two", { key: "ticket-1" });
  assert.equal(forgotten.outcome, "wait");
  assert.equal(forgotten.via, "else");
  assert.equal(forgotten.previous, undefined);

  const supplied = await built.decide("three", { key: "ticket-1", previous: "page" });
  assert.equal(supplied.outcome, "page");
  assert.equal(supplied.via, "hold");
  assert.equal(supplied.previous, "page");
});

test("memory must be a non-negative integer", () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }]);
  for (const memory of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => huncho("support.route", { model, memory }),
      (err: unknown) => {
        assert.equal(ConfigError.isInstance(err), true);
        assert.match((err as Error).message, /huncho "support.route" memory must be a non-negative integer/);
        return true;
      },
    );
  }
});

test("a supplied previous is the parent's; a child keeps its own memory", async () => {
  const { model } = scriptedModel([
    { answers: answers(0.91) },
    { answers: childAnswers(0.91) },
    { answers: answers(0.7) },
    { answers: childAnswers(0.7) },
  ]);
  const child = huncho("support.escalate", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8, exit: 0.6 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model, memory: 0 })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "escalate")
    .else("wait")
    .branch({ escalate: child });

  const first = await parent.decide("one", { key: "ticket-1" });
  assert.deepEqual(first.path, ["escalate", "page"]);

  const resumed = await parent.decide("two", { key: "ticket-1", previous: first.path[0] ?? null });
  assert.equal(resumed.via, "hold");
  assert.equal(resumed.previous, "escalate");
  assert.equal(resumed.child?.via, "hold");
  assert.equal(resumed.child?.previous, "page");
  assert.deepEqual(resumed.path, ["escalate", "page"]);
});

test("a parent outcome selects the child and records the path", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }, { answers: childAnswers(0.88) }]);
  const journal = memoryJournal();
  const ticket = { id: "ticket-1", note: "card declined" };
  const child = huncho("support.escalate", { model, journal })
    .shape((input: typeof ticket) => ({ note: input.note }))
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8, exit: 0.6 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model, journal })
    .shape((input: typeof ticket) => ({ id: input.id }))
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "escalate")
    .else("wait")
    .branch({ escalate: child, wait: null });

  const decision = await parent.decide(ticket, { key: "ticket-1" });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0]?.state, { id: "ticket-1" });
  assert.deepEqual(requests[1]?.state, { note: "card declined" });
  assert.equal(decision.outcome, "page");
  assert.deepEqual(decision.path, ["escalate", "page"]);
  assert.equal(decision.huncho, "support.route");
  assert.equal(decision.answers.urgent.p, 0.91);
  assert.equal(decision.child?.huncho, "support.escalate");
  assert.equal(decision.child?.outcome, "page");
  assert.deepEqual(decision.child?.path, ["page"]);
  assert.deepEqual(decision.child?.state, { note: "card declined" });
  assert.equal(decision.child?.key, "ticket-1");

  const records = await journal.read();
  assert.equal(records.length, 2);
  const childRecord = records.find((rec) => rec.huncho === "support.escalate");
  const parentRecord = records.find((rec) => rec.huncho === "support.route");
  assert.equal(childRecord?.outcome, "page");
  assert.deepEqual(childRecord?.path, ["page"]);
  assert.equal(childRecord?.key, "ticket-1");
  assert.equal(parentRecord?.outcome, "escalate");
  assert.deepEqual(parentRecord?.path, ["escalate", "page"]);
  assert.equal(parentRecord?.key, "ticket-1");
});

test("a child decided in its own call has its own id and carries the parent's as parentId", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }, { answers: childAnswers(0.88) }]);
  const journal = memoryJournal();
  const child = huncho("support.escalate", { model, journal })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model, journal })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: child });

  const decision = await parent.decide("plain", { key: "ticket-1" });
  const records = await journal.read();
  const childRecord = records.find((rec) => rec.huncho === "support.escalate");
  const parentRecord = records.find((rec) => rec.huncho === "support.route");

  assert.equal(decision.parentId, undefined);
  assert.equal(decision.child?.parentId, decision.id);
  assert.notEqual(decision.child?.id, decision.id);
  assert.equal(parentRecord?.id, decision.id);
  assert.equal(parentRecord?.parentId, undefined);
  assert.equal(childRecord?.id, decision.child?.id);
  assert.equal(childRecord?.parentId, decision.id);
  assert.equal(decision.via, "enter");
  assert.equal(decision.child?.via, "enter");
  assert.equal(parentRecord?.via, "enter");
  assert.equal(childRecord?.via, "enter");
});

test("a branch child keeps the parent's id as parentId when the parent was given one by the caller", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }, { answers: childAnswers(0.88) }]);
  const journal = memoryJournal();
  const child = huncho("support.escalate", { model, journal })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model, journal })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: child });

  const decision = await parent.decide("plain", { key: "ticket-1", parentId: "chooser" });
  const records = await journal.read();
  const parentRecord = records.find((rec) => rec.huncho === "support.route");
  const childRecord = records.find((rec) => rec.huncho === "support.escalate");

  assert.equal(decision.parentId, "chooser");
  assert.equal(parentRecord?.parentId, "chooser");
  assert.equal(decision.child?.parentId, decision.id);
  assert.equal(childRecord?.parentId, decision.id);
  assert.notEqual(decision.child?.parentId, "chooser");
});

test("a branch child that is not a huncho is handed the parent's id through its decide options", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }, { answers: childAnswers(0.2) }]);
  const escalate = huncho("support.escalate", { model }).ask(childQuestions).else("queue");
  const given: { key?: string; parentId?: string }[] = [];
  const runner = {
    decide(input: State, options?: { key?: string; parentId?: string }) {
      given.push({ ...options });
      return escalate.decide(input, options);
    },
  };
  const parent = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: runner });

  const decision = await parent.decide("plain", { key: "ticket-1", parentId: "chooser" });

  assert.deepEqual(given, [{ key: "ticket-1", parentId: decision.id }]);
  assert.equal(decision.child?.parentId, decision.id);
  assert.equal(decision.child?.outcome, "queue");
});

test("a child without a shape inherits the parent's state", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }, { answers: childAnswers(0.2) }]);
  const ticket = { id: "ticket-1", note: "card declined" };
  const child = huncho("support.escalate", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model })
    .shape((input: typeof ticket) => ({ id: input.id }))
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: child });

  const decision = await parent.decide(ticket);

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0]?.state, { id: "ticket-1" });
  assert.equal(requests[1]?.state, requests[0]?.state);
  assert.equal(decision.outcome, "queue");
  assert.deepEqual(decision.path, ["escalate", "queue"]);
  assert.deepEqual(decision.child?.state, { id: "ticket-1" });
});

test("outcomes without a branch behave exactly as before", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.1) }]);
  const journal = memoryJournal();
  const child = huncho("support.escalate", { model, journal })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model, journal })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: child, wait: null });

  const decision = await parent.decide("plain", { key: "ticket-1" });

  assert.equal(requests.length, 1);
  assert.equal(decision.outcome, "wait");
  assert.deepEqual(decision.path, ["wait"]);
  assert.equal(decision.child, undefined);
  const records = await journal.read();
  assert.equal(records.length, 1);
  assert.equal(records[0]?.huncho, "support.route");
  assert.equal(records[0]?.outcome, "wait");
  assert.deepEqual(records[0]?.path, ["wait"]);
});

test("hysteresis keys propagate to the child", async () => {
  const { model } = scriptedModel([
    { answers: answers(0.91) },
    { answers: childAnswers(0.91) },
    { answers: answers(0.7) },
    { answers: childAnswers(0.7) },
  ]);
  const child = huncho("support.escalate", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8, exit: 0.6 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "escalate")
    .else("wait")
    .branch({ escalate: child });

  const first = await parent.decide("one", { key: "ticket-1" });
  const held = await parent.decide("two", { key: "ticket-1" });

  assert.equal(first.outcome, "page");
  assert.equal(first.previous, undefined);
  assert.equal(first.child?.previous, undefined);
  assert.equal(first.child?.key, "ticket-1");
  assert.equal(held.outcome, "page");
  assert.equal(held.previous, "escalate");
  assert.equal(held.child?.outcome, "page");
  assert.equal(held.child?.previous, "page");
  assert.equal(held.child?.key, "ticket-1");
});

test("an abort signal reaches the child model call", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }, { answers: childAnswers(0.88) }]);
  const child = huncho("support.escalate", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: child });
  const signal = new AbortController().signal;

  await parent.decide("plain", { signal, key: "ticket-1" });
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.signal, signal);
  assert.equal(requests[1]?.signal, signal);
});

test("nested children extend the path and keep each journal record local", async () => {
  const leafQuestions = { act: noul("Act now?") };
  const { model } = scriptedModel([
    { answers: answers(0.91) },
    { answers: childAnswers(0.91) },
    { answers: { act: { type: "noul", noul: 0.91 } } },
  ]);
  const journal = memoryJournal();
  const leaf = huncho("support.page", { model, journal })
    .ask(leafQuestions)
    .when((a) => a.act.p, { enter: 0.8 }, "call")
    .else("note");
  const mid = huncho("support.escalate", { model, journal })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue")
    .branch({ page: leaf });
  const root = huncho("support.route", { model, journal })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: mid });

  const decision = await root.decide("plain", { key: "ticket-1" });
  assert.equal(decision.outcome, "call");
  assert.deepEqual(decision.path, ["escalate", "page", "call"]);
  assert.equal(decision.child?.outcome, "call");
  assert.deepEqual(decision.child?.path, ["page", "call"]);
  assert.equal(decision.child?.child?.outcome, "call");
  assert.deepEqual(decision.child?.child?.path, ["call"]);
  assert.equal(decision.parentId, undefined);
  assert.equal(decision.child?.parentId, decision.id);
  assert.equal(decision.child?.child?.parentId, decision.child?.id);

  const records = await journal.read();
  assert.equal(records.length, 3);
  assert.deepEqual(
    records.map((rec) => ({ huncho: rec.huncho, outcome: rec.outcome, path: rec.path })),
    [
      { huncho: "support.page", outcome: "call", path: ["call"] },
      { huncho: "support.escalate", outcome: "page", path: ["page", "call"] },
      { huncho: "support.route", outcome: "escalate", path: ["escalate", "page", "call"] },
    ],
  );
  assert.deepEqual(
    records.map((rec) => ({ id: rec.id, parentId: rec.parentId })),
    [
      { id: decision.child?.child?.id, parentId: decision.child?.id },
      { id: decision.child?.id, parentId: decision.id },
      { id: decision.id, parentId: undefined },
    ],
  );
});

test("shape after branch throws so the input type cannot change under children", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }]);
  const child = huncho("support.escalate", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: child });

  assert.throws(
    () =>
      (
        parent as unknown as {
          shape: (fn: (input: { id: string }) => string) => unknown;
        }
      ).shape((ticket) => ticket.id),
    (err: unknown) => {
      assert.equal(ConfigError.isInstance(err), true);
      assert.match((err as Error).message, /^huncho "support.route" cannot shape after branch/);
      return true;
    },
  );
});

test("branch copies the map so later mutation cannot redirect descent", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }, { answers: childAnswers(0.88) }]);
  const child = huncho("support.escalate", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const branches: {
    escalate: typeof child;
    wait: null;
  } = { escalate: child, wait: null };
  const parent = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch(branches);
  branches.escalate = parent as unknown as typeof child;

  const decision = await parent.decide("plain", { key: "ticket-1" });
  assert.equal(decision.outcome, "page");
  assert.deepEqual(decision.path, ["escalate", "page"]);
  assert.equal(decision.child?.huncho, "support.escalate");
  assert.equal(requests.length, 2);
});

test("a second branch replaces the child map and leaves the first value unchanged", async () => {
  const { model, requests } = scriptedModel([
    { answers: answers(0.91) },
    { answers: childAnswers(0.91) },
    { answers: answers(0.91) },
    { answers: childAnswers(0.91) },
  ]);
  const firstChild = huncho("support.escalate", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const nextChild = huncho("support.hold", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "hold")
    .else("defer");
  const first = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: firstChild, wait: null });
  const replaced = first.branch({ escalate: nextChild, wait: null });

  const fromFirst = await first.decide("plain", { key: "ticket-1" });
  const fromReplaced = await replaced.decide("plain", { key: "ticket-2" });

  assert.equal(fromFirst.outcome, "page");
  assert.deepEqual(fromFirst.path, ["escalate", "page"]);
  assert.equal(fromFirst.child?.huncho, "support.escalate");
  assert.equal(fromReplaced.outcome, "hold");
  assert.deepEqual(fromReplaced.path, ["escalate", "hold"]);
  assert.equal(fromReplaced.child?.huncho, "support.hold");
  assert.equal(requests.length, 4);
});

test("branch returns a new value and leaves the previous huncho unbranched", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }, { answers: answers(0.91) }]);
  const child = huncho("support.escalate", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait");
  const branched = parent.branch({ escalate: child });

  assert.notEqual(parent, branched);
  const plain = await parent.decide("plain");
  assert.equal(plain.outcome, "escalate");
  assert.deepEqual(plain.path, ["escalate"]);
  assert.equal(plain.child, undefined);
  assert.equal(requests.length, 1);
});

test("decide without ask names the huncho", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }]);
  await assert.rejects(
    () => huncho("support.route", { model }).decide("plain"),
    (err: unknown) => {
      assert.equal(ConfigError.isInstance(err), true);
      assert.match((err as Error).message, /^huncho "support.route" has no questions/);
      return true;
    },
  );
});

test("a speculative branch asks the child's questions in the parent's request and settles it from the answers", async () => {
  const { model, requests } = scriptedModel([
    { answers: { ...answers(0.91), "escalate.human": { type: "noul", noul: 0.88 } } },
  ]);
  const child = huncho("support.escalate", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: child, wait: null }, { speculative: true });

  const decision = await parent.decide("plain", { key: "ticket-1" });

  assert.equal(requests.length, 1);
  assert.deepEqual(Object.keys(requests[0]?.questions ?? {}), ["urgent", "escalate.human"]);
  assert.equal(requests[0]?.questions["escalate.human"], childQuestions.human);
  assert.equal(decision.outcome, "page");
  assert.deepEqual(decision.path, ["escalate", "page"]);
  assert.deepEqual(decision.raw, answers(0.91));
  assert.equal(decision.child?.huncho, "support.escalate");
  assert.equal(decision.child?.outcome, "page");
  assert.deepEqual(decision.child?.raw, childAnswers(0.88));
  assert.equal(decision.child?.state, "plain");
  assert.equal(decision.child?.key, "ticket-1");
  assert.equal(decision.child?.ms, 0);
  assert.deepEqual(decision.child?.usage, { inputTokens: 0, outputTokens: 0 });
});

test("unchosen speculated children's answers are discarded", async () => {
  const { model, requests } = scriptedModel([
    {
      answers: {
        ...answers(0.1),
        "escalate.human": { type: "noul", noul: 0.9 },
        "wait.human": { type: "noul", noul: 0.2 },
      },
    },
  ]);
  const journal = memoryJournal();
  const escalate = huncho("support.escalate", { model, journal })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const wait = huncho("support.wait", { model, journal })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "hold")
    .else("defer");
  const parent = huncho("support.route", { model, journal })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate, wait }, { speculative: true });

  const decision = await parent.decide("plain");

  assert.equal(requests.length, 1);
  assert.deepEqual(Object.keys(requests[0]?.questions ?? {}), ["urgent", "escalate.human", "wait.human"]);
  assert.equal(decision.outcome, "defer");
  assert.deepEqual(decision.path, ["wait", "defer"]);
  assert.deepEqual(decision.raw, answers(0.1));
  assert.equal(decision.child?.huncho, "support.wait");
  assert.deepEqual(decision.child?.raw, childAnswers(0.2));
  const records = await journal.read();
  assert.deepEqual(
    records.map((rec) => ({ huncho: rec.huncho, answers: rec.answers })),
    [
      { huncho: "support.wait", answers: childAnswers(0.2) },
      { huncho: "support.route", answers: answers(0.1) },
    ],
  );
});

test("a child with a shape under a speculative parent still gets its own call", async () => {
  const { model, requests } = scriptedModel([
    { answers: { ...answers(0.91), "wait.human": { type: "noul", noul: 0.2 } } },
    { answers: childAnswers(0.88) },
  ]);
  const ticket = { id: "ticket-1", note: "card declined" };
  const shaped = huncho("support.escalate", { model })
    .shape((input: typeof ticket) => ({ note: input.note }))
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const unshaped = huncho("support.wait", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "hold")
    .else("defer");
  const parent = huncho("support.route", { model })
    .shape((input: typeof ticket) => ({ id: input.id }))
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: shaped, wait: unshaped }, { speculative: true });
  const signal = new AbortController().signal;

  const decision = await parent.decide(ticket, { signal });

  assert.equal(requests.length, 2);
  assert.deepEqual(Object.keys(requests[0]?.questions ?? {}), ["urgent", "wait.human"]);
  assert.deepEqual(requests[1]?.state, { note: "card declined" });
  assert.deepEqual(Object.keys(requests[1]?.questions ?? {}), ["human"]);
  assert.equal(requests[0]?.signal, signal);
  assert.equal(requests[1]?.signal, signal);
  assert.equal(decision.outcome, "page");
  assert.deepEqual(decision.path, ["escalate", "page"]);
  assert.deepEqual(decision.child?.state, { note: "card declined" });
});

test("a speculated child's journal record has ms 0 and zero usage; the parent carries the cost", async () => {
  const provider = createProvider({
    name: "metered",
    defaultModel: "meter-1",
    evaluate: async () => ({
      answers: { ...answers(0.91), "escalate.human": { type: "noul", noul: 0.88 } },
      usage: { inputTokens: 120, outputTokens: 8 },
    }),
  });
  const model = provider();
  const journal = memoryJournal();
  const child = huncho("support.escalate", { model, journal })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model, journal })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: child }, { speculative: true });

  const decision = await parent.decide("plain", { key: "ticket-1" });
  const records = await journal.read();
  const childRecord = records.find((rec) => rec.huncho === "support.escalate");
  const parentRecord = records.find((rec) => rec.huncho === "support.route");

  assert.equal(records.length, 2);
  assert.equal(childRecord?.ms, 0);
  assert.deepEqual(childRecord?.usage, { inputTokens: 0, outputTokens: 0 });
  assert.equal(childRecord?.provider, "metered");
  assert.equal(childRecord?.model, "meter-1");
  assert.equal(childRecord?.key, "ticket-1");
  assert.deepEqual(childRecord?.path, ["page"]);
  assert.deepEqual(childRecord?.answers, childAnswers(0.88));
  assert.equal(childRecord?.questionsHash, await sha256(stableStringify(childQuestions)));
  assert.deepEqual(parentRecord?.usage, { inputTokens: 120, outputTokens: 8 });
  assert.equal(Number.isFinite(parentRecord?.ms) && (parentRecord?.ms ?? -1) >= 0, true);
  assert.deepEqual(parentRecord?.path, ["escalate", "page"]);
  assert.equal(parentRecord?.questionsHash, await sha256(stableStringify(questions)));
  assert.deepEqual(decision.usage, { inputTokens: 120, outputTokens: 8 });
  assert.equal(decision.child?.provider, "metered");
  assert.equal(decision.child?.model, "meter-1");
});

test("a speculated child has its own id and carries the parent's as parentId", async () => {
  const { model } = scriptedModel([
    { answers: { ...answers(0.91), "escalate.human": { type: "noul", noul: 0.2 } } },
  ]);
  const journal = memoryJournal();
  const child = huncho("support.escalate", { model, journal })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model, journal })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: child }, { speculative: true });

  const decision = await parent.decide("plain", { key: "ticket-1" });
  const records = await journal.read();
  const childRecord = records.find((rec) => rec.huncho === "support.escalate");
  const parentRecord = records.find((rec) => rec.huncho === "support.route");

  assert.equal(decision.parentId, undefined);
  assert.equal(decision.child?.parentId, decision.id);
  assert.notEqual(decision.child?.id, decision.id);
  assert.equal(parentRecord?.id, decision.id);
  assert.equal(parentRecord?.parentId, undefined);
  assert.equal(childRecord?.id, decision.child?.id);
  assert.equal(childRecord?.parentId, decision.id);
  assert.equal(decision.child?.via, "else");
  assert.equal(childRecord?.via, "else");
});

test("hysteresis keys propagate to a speculated child", async () => {
  const { model } = scriptedModel([
    { answers: { ...answers(0.91), "escalate.human": { type: "noul", noul: 0.91 } } },
    { answers: { ...answers(0.7), "escalate.human": { type: "noul", noul: 0.7 } } },
    { answers: { ...answers(0.7), "escalate.human": { type: "noul", noul: 0.7 } } },
  ]);
  const child = huncho("support.escalate", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8, exit: 0.6 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "escalate")
    .else("wait")
    .branch({ escalate: child }, { speculative: true });

  const first = await parent.decide("one", { key: "ticket-1" });
  const held = await parent.decide("two", { key: "ticket-1" });
  const other = await parent.decide("three", { key: "ticket-2" });

  assert.equal(first.outcome, "page");
  assert.equal(first.child?.previous, undefined);
  assert.equal(held.outcome, "page");
  assert.equal(held.previous, "escalate");
  assert.equal(held.child?.previous, "page");
  assert.equal(held.child?.key, "ticket-1");
  assert.equal(other.outcome, "wait");
  assert.equal(other.child, undefined);
});

test("a speculative tree of unshaped hunchos costs one call", async () => {
  const leafQuestions = { act: noul("Act now?") };
  const { model, requests } = scriptedModel([
    {
      answers: {
        ...answers(0.91),
        "escalate.human": { type: "noul", noul: 0.91 },
        "escalate.page.act": { type: "noul", noul: 0.91 },
      },
    },
  ]);
  const journal = memoryJournal();
  const leaf = huncho("support.page", { model, journal })
    .ask(leafQuestions)
    .when((a) => a.act.p, { enter: 0.8 }, "call")
    .else("note");
  const mid = huncho("support.escalate", { model, journal })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue")
    .branch({ page: leaf }, { speculative: true });
  const root = huncho("support.route", { model, journal })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: mid }, { speculative: true });

  const decision = await root.decide("plain", { key: "ticket-1" });

  assert.equal(requests.length, 1);
  assert.deepEqual(Object.keys(requests[0]?.questions ?? {}), ["urgent", "escalate.human", "escalate.page.act"]);
  assert.equal(decision.outcome, "call");
  assert.deepEqual(decision.path, ["escalate", "page", "call"]);
  assert.deepEqual(decision.child?.raw, childAnswers(0.91));
  assert.deepEqual(decision.child?.child?.raw, { act: { type: "noul", noul: 0.91 } });
  assert.equal(decision.child?.ms, 0);
  assert.equal(decision.child?.child?.ms, 0);
  const records = await journal.read();
  assert.deepEqual(
    records.map((rec) => ({ huncho: rec.huncho, path: rec.path, ms: rec.ms })),
    [
      { huncho: "support.page", path: ["call"], ms: 0 },
      { huncho: "support.escalate", path: ["page", "call"], ms: 0 },
      { huncho: "support.route", path: ["escalate", "page", "call"], ms: records[2]?.ms },
    ],
  );
});

test("a speculative child under a non-speculative parent gets its own call", async () => {
  const leafQuestions = { act: noul("Act now?") };
  const { model, requests } = scriptedModel([
    { answers: answers(0.91) },
    { answers: { ...childAnswers(0.91), "page.act": { type: "noul", noul: 0.91 } } },
  ]);
  const leaf = huncho("support.page", { model })
    .ask(leafQuestions)
    .when((a) => a.act.p, { enter: 0.8 }, "call")
    .else("note");
  const mid = huncho("support.escalate", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue")
    .branch({ page: leaf }, { speculative: true });
  const root = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: mid });

  const decision = await root.decide("plain");

  assert.equal(requests.length, 2);
  assert.deepEqual(Object.keys(requests[0]?.questions ?? {}), ["urgent"]);
  assert.deepEqual(Object.keys(requests[1]?.questions ?? {}), ["human", "page.act"]);
  assert.deepEqual(decision.path, ["escalate", "page", "call"]);
  assert.equal(decision.child?.child?.ms, 0);
});

test("a prefixed child question that collides with another id rejects the decide", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }]);
  const child = huncho("support.escalate", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model })
    .ask({ ...questions, "escalate.human": noul("Was a human already asked?") })
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: child }, { speculative: true });

  await assert.rejects(
    () => parent.decide("plain"),
    (err: unknown) => {
      assert.equal(ConfigError.isInstance(err), true);
      assert.match((err as Error).message, /^huncho "support.route" asks "escalate.human" twice/);
      return true;
    },
  );
  assert.equal(requests.length, 0);
});

test("evaluate asks only the parent's questions under a speculative branch", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }]);
  const child = huncho("support.escalate", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: child }, { speculative: true });

  const evaluated = await parent.evaluate("plain");

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.questions, questions);
  assert.equal(evaluated.answers.urgent.p, 0.91);
});

test("speculative false asks each child in its own call", async () => {
  const { model, requests } = scriptedModel([{ answers: answers(0.91) }, { answers: childAnswers(0.88) }]);
  const child = huncho("support.escalate", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: child }, { speculative: false });

  const decision = await parent.decide("plain");

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.questions, questions);
  assert.equal(decision.outcome, "page");
  assert.deepEqual(decision.path, ["escalate", "page"]);
});

test("a chosen child decides under the key the branch derives for it, in every mode", async () => {
  const { model, requests } = scriptedModel([
    { answers: { ...answers(0.91), "escalate.human": { type: "noul", noul: 0.88 } } },
    { answers: answers(0.91) },
    { answers: childAnswers(0.88) },
  ]);
  const seen: [string, string, unknown][] = [];
  const child = huncho("support.escalate", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const key = (outcome: "escalate" | "wait", parent: string, input: unknown) => {
    seen.push([outcome, parent, input]);
    return `${parent}/${outcome}`;
  };
  const build = (speculative: "chosen" | false) =>
    huncho("support.route", { model })
      .ask(questions)
      .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
      .else("wait")
      .branch({ escalate: child, wait: null }, { speculative, key });

  const speculated = await build("chosen").decide("plain", { key: "ticket-1" });
  const routed = await build(false).decide("plain", { key: "ticket-1" });

  assert.equal(requests.length, 3);
  assert.equal(speculated.key, "ticket-1");
  assert.equal(speculated.child?.key, "ticket-1/escalate");
  assert.deepEqual(Object.keys(speculated.children ?? {}), ["escalate"]);
  assert.equal(speculated.children?.escalate, speculated.child);
  assert.equal(routed.key, "ticket-1");
  assert.equal(routed.child?.key, "ticket-1/escalate");
  assert.deepEqual(seen, [
    ["escalate", "ticket-1", "plain"],
    ["escalate", "ticket-1", "plain"],
  ]);
});

test("speculative chosen is speculative true", async () => {
  const { model, requests } = scriptedModel([
    { answers: { ...answers(0.91), "escalate.human": { type: "noul", noul: 0.88 } } },
    { answers: { ...answers(0.91), "escalate.human": { type: "noul", noul: 0.88 } } },
  ]);
  const journal = memoryJournal();
  const child = huncho("support.escalate", { model, journal })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const build = (speculative: true | "chosen") =>
    huncho("support.route", { model, journal })
      .ask(questions)
      .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
      .else("wait")
      .branch({ escalate: child, wait: null }, { speculative });

  const named = await build("chosen").decide("plain", { key: "ticket-1" });
  const flagged = await build(true).decide("plain", { key: "ticket-1" });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0]?.questions, requests[1]?.questions);
  const same = (decision: Decision) => ({
    outcome: decision.outcome,
    path: decision.path,
    key: decision.key,
    child: { key: decision.child?.key, raw: decision.child?.raw, ms: decision.child?.ms, usage: decision.child?.usage },
    children: Object.keys(decision.children ?? {}),
  });
  assert.deepEqual(same(named), same(flagged));
  const records = await journal.read();
  assert.deepEqual(
    records.map((rec) => [rec.huncho, rec.key, rec.ms]),
    [
      ["support.escalate", "ticket-1", 0],
      ["support.route", "ticket-1", records[1]?.ms],
      ["support.escalate", "ticket-1", 0],
      ["support.route", "ticket-1", records[3]?.ms],
    ],
  );
});

test("a chosen child is absent from children when its outcome is a leaf", async () => {
  const { model } = scriptedModel([{ answers: { ...answers(0.1), "escalate.human": { type: "noul", noul: 0.9 } } }]);
  const child = huncho("support.escalate", { model })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: child, wait: null }, { speculative: "chosen" });

  const decision = await parent.decide("plain");

  assert.equal(decision.outcome, "wait");
  assert.equal(decision.child, undefined);
  assert.equal(decision.children, undefined);
});

const blockQuestions = {
  use: noul("Would applying this block change what to do right now?"),
};

/** One Noul per block, answered in the page's call; the outcome names the block. */
function pageAnswers(best: number, use: Record<string, number>): Record<string, RawAnswer> {
  const raw: Record<string, RawAnswer> = { best: { type: "noul", noul: best } };
  for (const [block, noul] of Object.entries(use)) raw[`${block}.use`] = { type: "noul", noul };
  return raw;
}

function blocks(model: ReturnType<typeof scriptedModel>["model"], journal?: ReturnType<typeof memoryJournal>) {
  const options = journal === undefined ? { model } : { model, journal };
  const apply = huncho("page.apply", options)
    .ask(blockQuestions)
    .when((a) => a.use.p, { enter: 0.7, exit: 0.5 }, "use")
    .else("skip");
  const page = huncho("page.pick", options)
    .ask({ best: noul("Is the intro the block that bears on the task?") })
    .when((a) => a.best.p, { enter: 0.6 }, "intro")
    .when((a) => a.best.p, { enter: 0.3 }, "body")
    .else("summary")
    .branch(
      { intro: apply, body: apply, summary: apply },
      { speculative: "all", key: (outcome, key) => `${key}:${outcome}` },
    );
  return { apply, page };
}

test("speculative all settles every unshaped child from the parent's call, each under its own key", async () => {
  const provider = createProvider({
    name: "metered",
    defaultModel: "meter-1",
    evaluate: async () => ({
      answers: pageAnswers(0.9, { intro: 0.9, body: 0.2, summary: 0.8 }),
      usage: { inputTokens: 300, outputTokens: 12 },
    }),
  });
  const model = provider();
  const journal = memoryJournal();
  const { page } = blocks(model, journal);

  const decision = await page.decide("Refund the order.", { key: "session-7" });

  assert.equal(decision.outcome, "use");
  assert.deepEqual(decision.path, ["intro", "use"]);
  assert.equal(decision.key, "session-7");
  assert.deepEqual(decision.usage, { inputTokens: 300, outputTokens: 12 });
  assert.deepEqual(Object.keys(decision.children ?? {}), ["intro", "body", "summary"]);
  assert.equal(decision.child, decision.children?.intro);
  assert.deepEqual(
    Object.values(decision.children ?? {}).map((c) => [c.huncho, c.key, c.outcome, c.raw.use, c.ms, c.usage, c.parentId]),
    [
      ["page.apply", "session-7:intro", "use", { type: "noul", noul: 0.9 }, 0, { inputTokens: 0, outputTokens: 0 }, decision.id],
      ["page.apply", "session-7:body", "skip", { type: "noul", noul: 0.2 }, 0, { inputTokens: 0, outputTokens: 0 }, decision.id],
      ["page.apply", "session-7:summary", "use", { type: "noul", noul: 0.8 }, 0, { inputTokens: 0, outputTokens: 0 }, decision.id],
    ],
  );
  const ids = new Set(Object.values(decision.children ?? {}).map((c) => c.id));
  assert.equal(ids.size, 3);
  assert.equal(ids.has(decision.id), false);

  const records = await journal.read();
  assert.deepEqual(
    records.map((rec) => [rec.huncho, rec.key, rec.outcome, rec.ms, rec.usage, rec.parentId, rec.id]),
    [
      ["page.apply", "session-7:intro", "use", 0, { inputTokens: 0, outputTokens: 0 }, decision.id, decision.children?.intro?.id],
      ["page.apply", "session-7:body", "skip", 0, { inputTokens: 0, outputTokens: 0 }, decision.id, decision.children?.body?.id],
      ["page.apply", "session-7:summary", "use", 0, { inputTokens: 0, outputTokens: 0 }, decision.id, decision.children?.summary?.id],
      ["page.pick", "session-7", "intro", records[3]?.ms, { inputTokens: 300, outputTokens: 12 }, undefined, decision.id],
    ],
  );
  assert.equal(records[3]?.provider, "metered");
  assert.equal(records[0]?.provider, "metered");
  assert.equal(records[0]?.model, "meter-1");
});

test("speculative all settles the other children when the chosen outcome is a leaf", async () => {
  const { model, requests } = scriptedModel([{ answers: pageAnswers(0.1, { intro: 0.9, body: 0.2 }) }]);
  const { apply } = blocks(model);
  const page = huncho("page.pick", { model })
    .ask({ best: noul("Is the intro the block that bears on the task?") })
    .when((a) => a.best.p, { enter: 0.6 }, "intro")
    .when((a) => a.best.p, { enter: 0.3 }, "body")
    .else("summary")
    .branch({ intro: apply, body: apply, summary: null }, { speculative: "all", key: (outcome, key) => `${key}:${outcome}` });

  const decision = await page.decide("Refund the order.", { key: "session-7" });

  assert.equal(requests.length, 1);
  assert.deepEqual(Object.keys(requests[0]?.questions ?? {}), ["best", "intro.use", "body.use"]);
  assert.equal(decision.outcome, "summary");
  assert.deepEqual(decision.path, ["summary"]);
  assert.equal(decision.child, undefined);
  assert.deepEqual(
    Object.entries(decision.children ?? {}).map(([outcome, c]) => [outcome, c.key, c.outcome]),
    [
      ["intro", "session-7:intro", "use"],
      ["body", "session-7:body", "skip"],
    ],
  );
});

test("speculative all holds each child's outcome under the child's own key", async () => {
  const { model } = scriptedModel([
    { answers: pageAnswers(0.9, { intro: 0.9, body: 0.2, summary: 0.8 }) },
    { answers: pageAnswers(0.9, { intro: 0.6, body: 0.6, summary: 0.4 }) },
    { answers: pageAnswers(0.9, { intro: 0.6, body: 0.6, summary: 0.6 }) },
  ]);
  const { page } = blocks(model);

  const first = await page.decide("Refund the order.", { key: "session-7" });
  const second = await page.decide("Refund the order.", { key: "session-7" });
  const elsewhere = await page.decide("Refund the order.", { key: "session-8" });

  const held = (decision: Decision) =>
    Object.values(decision.children ?? {}).map((c) => [c.key, c.outcome, c.via, c.previous]);
  assert.deepEqual(held(first), [
    ["session-7:intro", "use", "enter", undefined],
    ["session-7:body", "skip", "else", undefined],
    ["session-7:summary", "use", "enter", undefined],
  ]);
  assert.deepEqual(held(second), [
    ["session-7:intro", "use", "hold", "use"],
    ["session-7:body", "skip", "else", "skip"],
    ["session-7:summary", "skip", "else", "use"],
  ]);
  assert.deepEqual(held(elsewhere), [
    ["session-8:intro", "skip", "else", undefined],
    ["session-8:body", "skip", "else", undefined],
    ["session-8:summary", "skip", "else", undefined],
  ]);
});

test("speculative all defaults every child to the parent's key", async () => {
  const { model } = scriptedModel([{ answers: pageAnswers(0.9, { intro: 0.9, body: 0.2 }) }]);
  const { apply } = blocks(model);
  const page = huncho("page.pick", { model })
    .ask({ best: noul("Is the intro the block that bears on the task?") })
    .when((a) => a.best.p, { enter: 0.6 }, "intro")
    .else("body")
    .branch({ intro: apply, body: apply }, { speculative: "all" });

  const decision = await page.decide("Refund the order.", { key: "session-7" });

  assert.deepEqual(
    Object.values(decision.children ?? {}).map((c) => c.key),
    ["session-7", "session-7"],
  );
});

test("a child with a shape under speculative all makes its own call, and only when chosen", async () => {
  const { model, requests } = scriptedModel([
    { answers: pageAnswers(0.9, { body: 0.2 }) },
    { answers: { use: { type: "noul", noul: 0.9 } } },
    { answers: pageAnswers(0.1, { body: 0.8 }) },
  ]);
  const task = { text: "Refund the order.", intro: "Refunds take five days." };
  const { apply } = blocks(model);
  const shaped = huncho("page.apply", { model })
    .shape((input: typeof task) => input.intro)
    .ask(blockQuestions)
    .when((a) => a.use.p, { enter: 0.7 }, "use")
    .else("skip");
  const page = huncho("page.pick", { model })
    .shape((input: typeof task) => input.text)
    .ask({ best: noul("Is the intro the block that bears on the task?") })
    .when((a) => a.best.p, { enter: 0.6 }, "intro")
    .else("body")
    .branch({ intro: shaped, body: apply }, { speculative: "all", key: (outcome, key) => `${key}:${outcome}` });

  const chosen = await page.decide(task, { key: "session-7" });
  const unchosen = await page.decide(task, { key: "session-7" });

  assert.equal(requests.length, 3);
  assert.deepEqual(Object.keys(requests[0]?.questions ?? {}), ["best", "body.use"]);
  assert.equal(requests[1]?.state, "Refunds take five days.");
  assert.deepEqual(Object.keys(requests[1]?.questions ?? {}), ["use"]);
  assert.deepEqual(Object.keys(requests[2]?.questions ?? {}), ["best", "body.use"]);
  assert.deepEqual(
    Object.values(chosen.children ?? {}).map((c) => [c.key, c.outcome, c.state]),
    [
      ["session-7:intro", "use", "Refunds take five days."],
      ["session-7:body", "skip", "Refund the order."],
    ],
  );
  assert.equal(chosen.child, chosen.children?.intro);
  assert.deepEqual(
    Object.values(unchosen.children ?? {}).map((c) => [c.key, c.outcome]),
    [["session-7:body", "use"]],
  );
  assert.equal(unchosen.child, unchosen.children?.body);
});

test("the children of a speculative all branch replay from their own records", async () => {
  const { model } = scriptedModel([
    { answers: pageAnswers(0.9, { intro: 0.9, body: 0.2, summary: 0.8 }) },
    { answers: pageAnswers(0.9, { intro: 0.6, body: 0.6, summary: 0.4 }) },
  ]);
  const journal = memoryJournal();
  const { apply, page } = blocks(model, journal);

  const first = await page.decide("Refund the order.", { key: "session-7" });
  const second = await page.decide("Refund the order.", { key: "session-7" });
  const records = await journal.read();
  const replayed = replay(records, apply);

  assert.equal(replayed.n, 6);
  assert.equal(replayed.changed, 0);
  assert.deepEqual(
    replayed.results.map((r) => [r.record.key, r.outcome, r.via]),
    [...Object.values(first.children ?? {}), ...Object.values(second.children ?? {})].map((c) => [c.key, c.outcome, c.via]),
  );
  assert.deepEqual(replay(records, page).results.map((r) => r.outcome), ["intro", "intro"]);
  const lenient = replay(records, apply.with({ use: { enter: 0.6, exit: 0.5 } }));
  assert.deepEqual(
    lenient.results.filter((r) => r.changed).map((r) => [r.record.key, r.record.outcome, r.outcome]),
    [["session-7:body", "skip", "use"]],
  );
});

test("a branch child that is not a huncho is handed the derived key through its decide options", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }, { answers: childAnswers(0.2) }]);
  const escalate = huncho("support.escalate", { model }).ask(childQuestions).else("queue");
  const given: { key?: string; parentId?: string }[] = [];
  const runner = {
    decide(input: State, options?: { key?: string; parentId?: string }) {
      given.push({ ...options });
      return escalate.decide(input, options);
    },
  };
  const parent = huncho("support.route", { model })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: runner }, { speculative: "all", key: (outcome, key) => `${key}:${outcome}` });

  const decision = await parent.decide("plain", { key: "ticket-1" });

  assert.deepEqual(given, [{ key: "ticket-1:escalate", parentId: decision.id }]);
  assert.equal(decision.child?.key, "ticket-1:escalate");
  assert.equal(decision.children?.escalate, decision.child);
});

test("onDecision receives the object decide returns, after the journal write, and not from evaluate", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }]);
  const events: string[] = [];
  const seen: Decision[] = [];
  const journal: Journal = {
    write() {
      events.push("write");
    },
    async read() {
      return [];
    },
  };
  const built = huncho("support.route", {
    model,
    journal,
    onDecision: (decision) => {
      events.push("hook");
      seen.push(decision);
    },
  })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "page")
    .else("wait");

  await built.evaluate("plain");
  assert.deepEqual(events, []);

  const decision = await built.decide("plain", { key: "ticket-1" });
  assert.deepEqual(events, ["write", "hook"]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], decision);
});

test("onDecision fires once per huncho in a tree, child first, each with its own decision", async () => {
  const { model } = scriptedModel([{ answers: answers(0.91) }, { answers: childAnswers(0.88) }]);
  const seen: Decision[] = [];
  const onDecision = (decision: Decision) => {
    seen.push(decision);
  };
  const child = huncho("support.escalate", { model, onDecision })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model, onDecision })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: child });

  const decision = await parent.decide("plain", { key: "ticket-1" });

  assert.equal(seen.length, 2);
  assert.equal(seen[0], decision.child);
  assert.equal(seen[1], decision);
  assert.equal(seen[0]?.huncho, "support.escalate");
  assert.equal(seen[1]?.huncho, "support.route");
});

test("onDecision fires for a speculated child with the child's decision", async () => {
  const { model } = scriptedModel([
    { answers: { ...answers(0.91), "escalate.human": { type: "noul", noul: 0.88 } } },
  ]);
  const seen: string[] = [];
  const onDecision = (decision: Decision) => {
    seen.push(`${decision.huncho}:${decision.outcome}`);
  };
  const child = huncho("support.escalate", { model, onDecision })
    .ask(childQuestions)
    .when((a) => a.human.p, { enter: 0.8 }, "page")
    .else("queue");
  const parent = huncho("support.route", { model, onDecision })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "escalate")
    .else("wait")
    .branch({ escalate: child }, { speculative: true });

  await parent.decide("plain");
  assert.deepEqual(seen, ["support.escalate:page", "support.route:page"]);
});

test("a throwing onDecision is reported and does not reject decide", async (t) => {
  const { model } = scriptedModel([{ answers: answers(0.91) }]);
  const error = t.mock.method(console, "error", () => {});
  const journal = memoryJournal();
  const boom = new Error("hook failed");
  const built = huncho("support.route", {
    model,
    journal,
    onDecision: () => {
      throw boom;
    },
  })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "page")
    .else("wait");

  const decision = await built.decide("plain", { key: "ticket-1" });

  assert.equal(decision.outcome, "page");
  assert.equal(journal.records.length, 1);
  assert.equal(error.mock.callCount(), 1);
  assert.match(String(error.mock.calls[0]?.arguments[0]), /^huncho "support.route": onDecision threw; the decision stands, see /);
  assert.equal(error.mock.calls[0]?.arguments[1], boom);
});

test("an onDecision that returns a rejecting thenable is reported and does not reject decide", async (t) => {
  const { model } = scriptedModel([{ answers: answers(0.91) }]);
  const error = t.mock.method(console, "error", () => {});
  const boom = new Error("hook failed later");
  const rejecting = { then: (_ok: unknown, fail: (reason: unknown) => void) => fail(boom) };
  const built = huncho("support.route", {
    model,
    onDecision: () => rejecting as unknown as void,
  })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "page")
    .else("wait");

  const decision = await built.decide("plain");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(decision.outcome, "page");
  assert.equal(error.mock.callCount(), 1);
  assert.equal(error.mock.calls[0]?.arguments[1], boom);
});

test("onDecision does not fire when decide rejects", async () => {
  const { model } = scriptedModel([{ answers: answers(0.1) }]);
  let fired = 0;
  const built = huncho("support.route", {
    model,
    onDecision: () => {
      fired += 1;
    },
  })
    .ask(questions)
    .when((a) => a.urgent.p, { enter: 0.8 }, "page");

  await assert.rejects(() => built.decide("plain"), (err: unknown) => PolicyError.isInstance(err));
  assert.equal(fired, 0);
});
