import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ConfigError,
  createProvider,
  huncho,
  memoryJournal,
  noul,
  PolicyError,
  sha256,
  stableStringify,
  type RawAnswer,
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
