import { test } from "node:test";
import assert from "node:assert/strict";
import { all, any, ConfigError, policy, uncertain, violation, weighted } from "../src/index.js";

test("all is min and any is max", () => {
  assert.equal(all(0.9, 0.4, 0.7), 0.4);
  assert.equal(any(0.9, 0.4, 0.7), 0.9);
  assert.equal(all(0.55), 0.55);
  assert.equal(any(0.55), 0.55);
});

test("empty all, any and weighted are 0", () => {
  assert.equal(all(), 0);
  assert.equal(any(), 0);
  assert.equal(weighted([]), 0);
  assert.equal(weighted([[0.9, 0], [0.1, 0]]), 0);
});

test("weighted is the mean of probabilities by weight", () => {
  assert.equal(weighted([[1, 3], [0, 1]]), 0.75);
  assert.equal(weighted([[0.2, 1], [0.8, 1]]), 0.5);
  assert.equal(weighted([[0.4, 2]]), 0.4);
});

test("weighted rejects non-finite probabilities and negative weights", () => {
  const message = /^weighted\(\) needs finite probabilities and non-negative weights/;
  for (const parts of [[[0.8, 2], [0.2, -1]], [[Number.NaN, 1]], [[0.5, Number.POSITIVE_INFINITY]]] as const) {
    assert.throws(() => weighted(parts), (err: unknown) => {
      assert.equal(ConfigError.isInstance(err), true);
      assert.match((err as Error).message, message);
      return true;
    });
  }
});

test("uncertain is the open band around 0.5", () => {
  assert.equal(uncertain(0.5), true);
  assert.equal(uncertain(0.55), true);
  assert.equal(uncertain(0.7), false);
  assert.equal(uncertain(0.3), false);
  assert.equal(uncertain(0.9), false);
  assert.equal(uncertain(0.65, 0.2), true);
  assert.equal(uncertain(0.8, 0.2), false);
});

test("violation is any check at or above the threshold", () => {
  assert.equal(violation([0.1, 0.75]), true);
  assert.equal(violation([0.1, 0.65]), false);
  assert.equal(violation([0.7]), true);
  assert.equal(violation([0.69]), false);
  assert.equal(violation([0.5], 0.5), true);
  assert.equal(violation([]), false);
});

test("helpers can be used inside a policy clause", () => {
  const route = policy<{ urgent: number; harm: number; topic: number }>("route")
    .when((a) => violation([a.harm]), "block")
    .when((a) => all(a.urgent, a.topic), { enter: 0.8 }, "page")
    .when((a) => uncertain(a.urgent), "hold")
    .else("wait");

  assert.equal(route.decide({ urgent: 0.9, harm: 0.2, topic: 0.85 }), "page");
  assert.equal(route.decide({ urgent: 0.9, harm: 0.8, topic: 0.85 }), "block");
  assert.equal(route.decide({ urgent: 0.52, harm: 0.2, topic: 0.9 }), "hold");
  assert.equal(route.decide({ urgent: 0.9, harm: 0.2, topic: 0.4 }), "wait");
});
