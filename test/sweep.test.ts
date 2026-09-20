import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AnswerError,
  ConfigError,
  choice,
  huncho,
  memoryLabels,
  noul,
  sweep,
  type Candidates,
  type JournalRecord,
  type Label,
  type Sweep,
} from "../src/index.js";
import { scriptedModel } from "huncho/testing";

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
    answers: { urgent: { type: "noul", noul: 0.5 } },
    outcome: "page",
    via: "enter",
    path: ["page"],
    usage: { inputTokens: 0, outputTokens: 0 },
    ms: 1,
    ...overrides,
  };
}

function urgent(id: string, p: number, key = id): JournalRecord {
  return record({ id, key, answers: { urgent: { type: "noul", noul: p } } });
}

function label(id: string, truth: Label["truth"], t = "2026-09-19T15:00:00.000Z"): Label {
  return { id, t, truth };
}

/** The route every test sweeps, with a scripted model that is never asked. */
function route(thresholds: { readonly enter: number; readonly exit?: number } = { enter: 0.7 }) {
  const { model, requests } = scriptedModel([{ answers: { urgent: { type: "noul", noul: 0.9 } } }]);
  const built = huncho("support.route", { model })
    .ask({ urgent: noul("Does this need a human within the hour?") })
    .when((a) => a.urgent.p, thresholds, "page")
    .else("wait");
  return { built, requests };
}

function columns(row: Sweep["rows"][number]) {
  return { enter: row.enter, exit: row.exit, current: row.current, n: row.n, chosen: row.chosen, flaps: row.flaps };
}

test("against the hysteresis fixture, exit equal to enter flaps more than exit below it", () => {
  const fixture = JSON.parse(readFileSync("fixtures/policy/hysteresis.json", "utf8")) as {
    clauses: readonly { type: string; select?: string; enter?: number; exit?: number; outcome: string }[];
    sequence: readonly { answers: Record<string, number>; previous?: string }[];
  };
  const [numeric, fallback] = fixture.clauses;
  assert.equal(numeric?.type, "numeric");
  assert.equal(fallback?.type, "else");
  const { enter, exit, outcome } = numeric as { enter: number; exit: number; outcome: string };
  const { model, requests } = scriptedModel([{ answers: { value: { type: "noul", noul: 0.9 } } }]);
  const built = huncho("support.route", { model })
    .ask({ value: noul("Is the value high?") })
    .when((a) => a.value.p, { enter, exit }, outcome)
    .else(fallback?.outcome ?? "");
  const records = fixture.sequence.map((step, i) =>
    record({
      id: `step-${i}`,
      key: "one-key",
      answers: { value: { type: "noul", noul: step.answers.value ?? 0 } },
      ...(step.previous === undefined ? {} : { previous: step.previous }),
    }),
  );

  const result = sweep(records, built, { outcome: "page", enter: [0.7, 0.8], exit: [0.5, 0.7, 0.8] });

  assert.equal(requests.length, 0);
  assert.deepEqual(result.rows.map(columns), [
    { enter: 0.7, exit: 0.5, current: false, n: 5, chosen: 5, flaps: 0 },
    { enter: 0.7, exit: 0.7, current: false, n: 5, chosen: 3, flaps: 2 },
    { enter: 0.8, exit: 0.5, current: false, n: 5, chosen: 5, flaps: 0 },
    { enter: 0.8, exit: 0.6, current: true, n: 5, chosen: 3, flaps: 1 },
    { enter: 0.8, exit: 0.7, current: false, n: 5, chosen: 2, flaps: 1 },
    { enter: 0.8, exit: 0.8, current: false, n: 5, chosen: 1, flaps: 1 },
  ]);
  for (const candidate of [0.7, 0.8]) {
    const at = (exit: number) => result.rows.find((row) => row.enter === candidate && row.exit === exit)?.flaps;
    assert.ok((at(candidate) ?? 0) > (at(0.5) ?? 0), `enter ${candidate}`);
  }
});

/** Six tickets, one key each, with what should have happened; scored by hand below. */
const judged = {
  records: [urgent("a", 0.95), urgent("b", 0.85), urgent("c", 0.75), urgent("d", 0.65), urgent("e", 0.55), urgent("f", 0.3)],
  truths: new Map<string, boolean>([
    ["a", true],
    ["b", true],
    ["c", false],
    ["d", true],
    ["e", false],
    ["f", false],
  ]),
};

/**
 * enter 0.6 chooses a, b, c, d: tp 3, fp 1, fn 0.
 * enter 0.7 chooses a, b, c:    tp 2, fp 1, fn 1.
 * enter 0.8 chooses a, b:       tp 2, fp 0, fn 1.
 */
const scoredByHand = [
  { enter: 0.6, exit: 0.6, current: false, n: 6, chosen: 4, flaps: 0, precision: 3 / 4, recall: 1, f1: 6 / 7 },
  { enter: 0.7, exit: 0.7, current: true, n: 6, chosen: 3, flaps: 0, precision: 2 / 3, recall: 2 / 3, f1: 2 / 3 },
  { enter: 0.8, exit: 0.8, current: false, n: 6, chosen: 2, flaps: 0, precision: 1, recall: 2 / 3, f1: 4 / 5 },
];

test("with a Label[], precision and recall match the hand-computed table and best is the max-f1 row", () => {
  const labels = [...judged.truths].map(([id, truth]) => label(id, truth));
  const result = sweep(judged.records, route().built, { outcome: "page", enter: [0.6, 0.7, 0.8], labels });
  assert.deepEqual(result.rows, scoredByHand);
  assert.deepEqual(result.best, scoredByHand[0]);
});

test("a callback and a Labels store give the same table, the store as a promise", async () => {
  const byCallback = sweep(judged.records, route().built, {
    outcome: "page",
    enter: [0.6, 0.7, 0.8],
    labels: (rec) => judged.truths.get(rec.id),
  });
  assert.deepEqual(byCallback.rows, scoredByHand);

  const store = memoryLabels();
  for (const [id, truth] of judged.truths) store.write(label(id, truth));
  const pending = sweep(judged.records, route().built, { outcome: "page", enter: [0.6, 0.7, 0.8], labels: store });
  assert.ok(pending instanceof Promise);
  assert.deepEqual((await pending).rows, scoredByHand);
});

test("without labels, rows have no precision, recall or f1 and best is undefined", () => {
  const result = sweep(judged.records, route().built, { outcome: "page", enter: [0.6, 0.7, 0.8] });
  assert.equal(result.best, undefined);
  assert.equal("best" in result, false);
  for (const row of result.rows) {
    assert.deepEqual(Object.keys(row), ["enter", "exit", "current", "n", "chosen", "flaps"]);
  }
});

test("exactly one row is current, added to the grid when the candidates leave it out", () => {
  const result = sweep(judged.records, route({ enter: 0.75, exit: 0.45 }).built, {
    outcome: "page",
    enter: { from: 0.6, to: 0.9, step: 0.1 },
    exit: [0.5, 0.7],
  });
  const current = result.rows.filter((row) => row.current);
  assert.deepEqual(current.map(columns), [{ enter: 0.75, exit: 0.45, current: true, n: 6, chosen: 3, flaps: 0 }]);
  assert.deepEqual(
    result.rows.map((row) => [row.enter, row.exit]),
    [
      [0.6, 0.5],
      [0.7, 0.5],
      [0.7, 0.7],
      [0.75, 0.45],
      [0.8, 0.5],
      [0.8, 0.7],
      [0.9, 0.5],
      [0.9, 0.7],
    ],
  );
});

test("a candidate pair with exit above enter is left out, not thrown", () => {
  const result = sweep(judged.records, route().built, { outcome: "page", enter: [0.6], exit: [0.5, 0.6, 0.7] });
  assert.deepEqual(
    result.rows.map((row) => [row.enter, row.exit]),
    [
      [0.6, 0.5],
      [0.6, 0.6],
      [0.7, 0.7],
    ],
  );
});

test("a range walks from from to to inclusive on clean numbers and a duplicate candidate is one row", () => {
  const walked = sweep([], route().built, { outcome: "page", enter: { from: 0.1, to: 0.7, step: 0.1 } });
  assert.deepEqual(
    walked.rows.map((row) => row.enter),
    [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
  );
  const listed = sweep([], route().built, { outcome: "page", enter: [0.8, 0.7, 0.8] });
  assert.deepEqual(
    listed.rows.map((row) => row.enter),
    [0.7, 0.8],
  );
  // Below twelve significant digits the steps round together, one row, rather than walking forever.
  const tiny = sweep([], route().built, { outcome: "page", enter: { from: 0.5, to: 0.5 + 2e-13, step: 1e-13 } });
  assert.deepEqual(
    tiny.rows.map((row) => row.enter),
    [0.5, 0.7],
  );
});

test("best breaks an f1 tie by fewer flaps, and an unlabelled record still counts for flaps", () => {
  const records = [urgent("k1", 0.9, "k"), urgent("k2", 0.7, "k"), urgent("k3", 0.9, "k")];
  const labels = [label("k1", true), label("k3", true)];
  const result = sweep(records, route({ enter: 0.8 }).built, { outcome: "page", enter: [0.8], exit: [0.6, 0.8], labels });
  assert.deepEqual(result.rows, [
    { enter: 0.8, exit: 0.6, current: false, n: 3, chosen: 3, flaps: 0, precision: 1, recall: 1, f1: 1 },
    { enter: 0.8, exit: 0.8, current: true, n: 3, chosen: 2, flaps: 2, precision: 1, recall: 1, f1: 1 },
  ]);
  assert.deepEqual(result.best, result.rows[0]);
});

test("precision is NaN when nothing labelled was chosen and best is undefined when no row has an f1", () => {
  const nothingChosen = sweep([urgent("a", 0.3)], route().built, { outcome: "page", enter: [0.9], labels: [label("a", true)] });
  const top = nothingChosen.rows.find((row) => row.enter === 0.9);
  assert.equal(top?.precision, Number.NaN);
  assert.equal(top?.recall, 0);
  assert.equal(top?.f1, 0);

  const unlabelled = sweep(judged.records, route().built, { outcome: "page", enter: [0.6], labels: [] });
  assert.equal(unlabelled.best, undefined);
  assert.equal(unlabelled.rows[0]?.f1, Number.NaN);
});

test("a string truth counts when it names the outcome, the later t wins, and a number truth is an AnswerError naming the id", () => {
  const records = [urgent("a", 0.9), urgent("b", 0.9)];
  const byName = sweep(records, route().built, { outcome: "page", enter: [0.7], labels: [label("a", "page"), label("b", "wait")] });
  assert.equal(byName.rows[0]?.precision, 0.5);

  const corrected = sweep(records, route().built, {
    outcome: "page",
    enter: [0.7],
    labels: [label("a", true, "2026-09-19T16:00:00.000Z"), label("a", false, "2026-09-19T15:00:00.000Z"), label("b", true)],
  });
  assert.equal(corrected.rows[0]?.precision, 1);

  assert.throws(
    () => sweep(records, route().built, { outcome: "page", enter: [0.7], labels: [label("a", 2)] }),
    (err: unknown) => {
      assert.equal(AnswerError.isInstance(err), true);
      assert.match((err as Error).message, /^label for decision "a" has truth 2: a number names a score level/);
      return true;
    },
  );
});

test("an outcome from a boolean clause or from no clause is a ConfigError naming the huncho", () => {
  const { model } = scriptedModel([{ answers: { urgent: { type: "noul", noul: 0.9 } } }]);
  const built = huncho("support.route", { model })
    .ask({
      urgent: noul("Does this need a human within the hour?"),
      topic: choice("What is it about?", ["billing", "bug", "other"]),
    })
    .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
    .when((a) => a.topic.is("billing", 0.7), "billing")
    .else("wait");

  assert.throws(
    () => sweep([], built, { outcome: "billing", enter: [0.5] }),
    (err: unknown) => {
      assert.equal(ConfigError.isInstance(err), true);
      assert.match((err as Error).message, /^huncho "support.route" produces "billing" from a boolean clause/);
      return true;
    },
  );
  assert.throws(
    () => sweep([], built, { outcome: "wait", enter: [0.5] }),
    (err: unknown) => {
      assert.equal(ConfigError.isInstance(err), true);
      assert.match((err as Error).message, /^huncho "support.route" has no when\(\) clause producing "wait"/);
      return true;
    },
  );
});

test("an outcome that two clauses produce is a ConfigError, since with() would move both", () => {
  const { model } = scriptedModel([{ answers: { urgent: { type: "noul", noul: 0.9 } } }]);
  const built = huncho("support.route", { model })
    .ask({ urgent: noul("Does this need a human within the hour?"), down: noul("Is the product down?") })
    .when((a) => a.down.p, { enter: 0.9 }, "page")
    .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
    .else("wait");
  assert.throws(
    () => sweep([], built, { outcome: "page", enter: [0.5] }),
    (err: unknown) => {
      assert.equal(ConfigError.isInstance(err), true);
      assert.match((err as Error).message, /^huncho "support.route" produces "page" from 2 clauses and sweep\(\) varies one/);
      return true;
    },
  );
});

test("a candidate that is not finite or a range that cannot be walked is a ConfigError", () => {
  const cases: { readonly enter: Candidates; readonly message: RegExp }[] = [
    { enter: [0.5, Number.NaN], message: /^sweep\(\) enter candidates must be finite numbers, got NaN/ },
    { enter: { from: 0.9, to: 0.5, step: 0.1 }, message: /^sweep\(\) enter range needs finite from at most to and a positive step/ },
    { enter: { from: 0.5, to: 0.9, step: 0 }, message: /^sweep\(\) enter range needs finite from at most to and a positive step/ },
    { enter: { from: 0.5, to: Number.POSITIVE_INFINITY, step: 0.1 }, message: /^sweep\(\) enter range needs finite from/ },
    { enter: { from: 0, to: 1, step: Number.MIN_VALUE }, message: /^sweep\(\) enter range from 0 to 1 by 5e-324 walks more than 1000 candidates/ },
    { enter: { from: 0, to: 1, step: 0.0001 }, message: /walks more than 1000 candidates/ },
  ];
  for (const { enter, message } of cases) {
    assert.throws(
      () => sweep([], route().built, { outcome: "page", enter }),
      (err: unknown) => {
        assert.equal(ConfigError.isInstance(err), true);
        assert.match((err as Error).message, message);
        return true;
      },
      JSON.stringify(enter),
    );
  }
});

test("records of other hunchos are skipped by name and hysteresis chains per key", () => {
  const records = [
    urgent("t1", 0.9, "T-1"),
    record({ id: "x", huncho: "other", key: "T-1", answers: { urgent: { type: "noul", noul: 0.1 } } }),
    urgent("t2", 0.65, "T-1"),
    urgent("u1", 0.65, "T-2"),
  ];
  const result = sweep(records, route({ enter: 0.8, exit: 0.6 }).built, { outcome: "page", enter: [0.8], exit: [0.6, 0.8] });
  assert.deepEqual(result.rows.map(columns), [
    { enter: 0.8, exit: 0.6, current: true, n: 3, chosen: 2, flaps: 0 },
    { enter: 0.8, exit: 0.8, current: false, n: 3, chosen: 1, flaps: 1 },
  ]);
});
