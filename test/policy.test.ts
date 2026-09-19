import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { policy, type Policy } from "../src/index.js";

type FixtureAnswers = Record<string, number | boolean>;

type RawClause = {
  readonly type: string;
  readonly select?: unknown;
  readonly test?: unknown;
  readonly enter?: unknown;
  readonly exit?: unknown;
  readonly outcome?: unknown;
};

type FixtureStep = {
  readonly answers: FixtureAnswers;
  readonly previous?: string;
  readonly expect: string;
};

type Fixture = {
  readonly clauses: readonly RawClause[];
  readonly sequence: readonly FixtureStep[];
};

const dir = "fixtures/policy";

for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
  test(`policy fixture ${file} matches every expected outcome`, () => {
    const fixture = JSON.parse(readFileSync(join(dir, file), "utf8")) as Fixture;
    const built = policyFromFixture(basename(file, ".json"), fixture);
    for (const [index, step] of fixture.sequence.entries()) {
      const previous = step.previous;
      const outcome =
        previous === undefined ? built.decide(step.answers) : built.decide(step.answers, previous);
      assert.equal(outcome, step.expect, `${file} step ${index}`);
    }
  });
}

test("a miss with no else throws naming the policy", () => {
  const built = policy<{ value: number }>("support.route").when((a) => a.value, { enter: 0.8 }, "page");
  assert.throws(
    () => built.decide({ value: 0.1 }),
    (err: unknown) => {
      assert.equal(err instanceof Error, true);
      assert.equal((err as Error).message, 'no outcome for policy "support.route"');
      return true;
    },
  );
});

test("with() copies a numeric clause and leaves the original unchanged", () => {
  const original = policy<{ value: number }>("route")
    .when((a) => a.value, { enter: 0.8, exit: 0.6 }, "page")
    .else("wait");
  const raised = original.with({ page: { enter: 0.85 } });

  assert.equal(original.decide({ value: 0.82 }), "page");
  assert.equal(raised.decide({ value: 0.82 }), "wait");
  assert.equal(raised.decide({ value: 0.85 }), "page");
  assert.equal(raised.decide({ value: 0.7 }, "page"), "page");
});

test("with() keeps exit equal to a new enter when they were equal before", () => {
  const tied = policy<{ value: number }>("route")
    .when((a) => a.value, { enter: 0.8 }, "page")
    .else("wait")
    .with({ page: { enter: 0.85 } });

  assert.equal(tied.decide({ value: 0.85 }), "page");
  assert.equal(tied.decide({ value: 0.84 }, "page"), "wait");
});

test("with() can lower exit without moving enter", () => {
  const loosened = policy<{ value: number }>("route")
    .when((a) => a.value, { enter: 0.8, exit: 0.6 }, "page")
    .else("wait")
    .with({ page: { exit: 0.5 } });

  assert.equal(loosened.decide({ value: 0.79 }), "wait");
  assert.equal(loosened.decide({ value: 0.55 }, "page"), "page");
  assert.equal(loosened.decide({ value: 0.49 }, "page"), "wait");
});

test("with() is a no-op on a boolean outcome", () => {
  const built = policy<{ enter: boolean }>("route")
    .when((a) => a.enter, "page")
    .else("wait")
    .with({ page: { enter: 0.99, exit: 0.1 } });

  assert.equal(built.decide({ enter: true }), "page");
  assert.equal(built.decide({ enter: false }, "page"), "wait");
});

test("the runner rejects an unknown clause type", () => {
  assert.throws(
    () =>
      policyFromFixture("bad", {
        clauses: [{ type: "numerical", select: "value", enter: 0.8, outcome: "page" }],
        sequence: [],
      }),
    (err: unknown) => {
      assert.equal((err as Error).message, 'policy "bad": unknown clause type "numerical"');
      return true;
    },
  );
});

function policyFromFixture(name: string, fixture: Fixture): Policy<FixtureAnswers, string> {
  let built: Policy<FixtureAnswers, string> = policy<FixtureAnswers>(name);
  for (const clause of fixture.clauses) {
    built = applyClause(built, name, clause);
  }
  return built;
}

function applyClause(
  built: Policy<FixtureAnswers, string>,
  name: string,
  clause: RawClause,
): Policy<FixtureAnswers, string> {
  const outcome = stringField(clause.outcome, name, "outcome");
  if (clause.type === "else") return built.else(outcome);
  if (clause.type === "boolean") {
    const testKey = stringField(clause.test, name, "test");
    const exitKey = clause.exit === undefined ? undefined : stringField(clause.exit, name, "exit");
    return exitKey === undefined
      ? built.when((answers) => booleanAt(answers, testKey, name), outcome)
      : built.when((answers) => booleanAt(answers, testKey, name), outcome, {
          exit: (answers) => booleanAt(answers, exitKey, name),
        });
  }
  if (clause.type === "numeric") {
    const selectKey = stringField(clause.select, name, "select");
    const enter = numberField(clause.enter, name, "enter");
    const thresholds =
      clause.exit === undefined
        ? { enter }
        : { enter, exit: numberField(clause.exit, name, "exit") };
    return built.when((answers) => numberAt(answers, selectKey, name), thresholds, outcome);
  }
  throw new Error(`policy "${name}": unknown clause type "${clause.type}"`);
}

function stringField(value: unknown, name: string, field: string): string {
  if (typeof value !== "string") throw new Error(`policy "${name}": clause.${field} is not a string`);
  return value;
}

function numberField(value: unknown, name: string, field: string): number {
  if (typeof value !== "number") throw new Error(`policy "${name}": clause.${field} is not a number`);
  return value;
}

function numberAt(answers: FixtureAnswers, key: string, name: string): number {
  const value = answers[key];
  if (typeof value !== "number") throw new Error(`policy "${name}": answers.${key} is not a number`);
  return value;
}

function booleanAt(answers: FixtureAnswers, key: string, name: string): boolean {
  const value = answers[key];
  if (typeof value !== "boolean") throw new Error(`policy "${name}": answers.${key} is not a boolean`);
  return value;
}
