import { test } from "node:test";
import assert from "node:assert/strict";
import { choice, noul, score, wrapAnswers } from "../src/index.js";

test("noul, choice and score build the canonical question shapes", () => {
  assert.deepEqual(noul("Need a human?"), { type: "noul", instructions: "Need a human?" });
  assert.deepEqual(noul("Need a human?", { true: "page", false: "wait" }), {
    type: "noul",
    instructions: "Need a human?",
    criteria: { true: "page", false: "wait" },
  });

  assert.deepEqual(choice("What is it about?", { billing: null, bug: "a defect" }), {
    type: "choice",
    instructions: "What is it about?",
    criteria: { billing: null, bug: "a defect" },
  });
  assert.deepEqual(choice("What is it about?", ["billing", "bug"]), {
    type: "choice",
    instructions: "What is it about?",
    criteria: { billing: null, bug: null },
  });

  assert.deepEqual(score("How severe?", ["low", "high"]), {
    type: "score",
    instructions: "How severe?",
    criteria: ["low", "high"],
  });
});

test("score() rejects a rubric with fewer than two levels", () => {
  assert.throws(() => score("How severe?", ["only"]), (err: unknown) => {
    assert.equal(err instanceof Error, true);
    assert.equal((err as Error).message, "score() needs at least two levels");
    return true;
  });
});

test("wrapAnswers maps canonical raw answers onto typed helpers", () => {
  const questions = {
    urgent: noul("Need a human within the hour?"),
    topic: choice("What is it about?", ["billing", "bug", "other"]),
    quality: score("How severe is it?", ["low", "medium", "high"]),
  };

  const answers = wrapAnswers(
    {
      urgent: { type: "noul", noul: 0.91 },
      topic: {
        type: "choice",
        choice: "billing",
        probabilities: { billing: 0.8, bug: 0.15, other: 0.05 },
        confidence: 0.72,
      },
      quality: {
        type: "score",
        score: 1.4,
        probabilities: { "0": 0.1, "1": 0.6, "2": 0.3 },
        confidence: 0.64,
      },
    },
    questions,
  );

  assert.equal(answers.urgent.p, 0.91);
  assert.equal(answers.urgent.yes, true);
  assert.equal(answers.topic.choice, "billing");
  assert.equal(answers.topic.confidence, 0.72);
  assert.equal(answers.topic.p("billing"), 0.8);
  assert.equal(answers.topic.p("bug"), 0.15);
  assert.equal(answers.topic.is("billing"), true);
  assert.equal(answers.topic.is("billing", 0.7), true);
  assert.equal(answers.topic.is("billing", 0.9), false);
  assert.equal(answers.topic.is("bug"), false);
  assert.equal(answers.quality.score, 1.4);
  assert.equal(answers.quality.ratio, 0.7);
  assert.equal(answers.quality.level, 1);
  assert.equal(answers.quality.levels, 3);
  assert.equal(answers.quality.confidence, 0.64);
});

test("a noul is yes at 0.5 and not yes below", () => {
  const question = { urgent: noul("Need a human?") };
  assert.equal(wrapAnswers({ urgent: { type: "noul", noul: 0.5 } }, question).urgent.yes, true);
  assert.equal(wrapAnswers({ urgent: { type: "noul", noul: 0.49 } }, question).urgent.yes, false);
});

test("wrapAnswers throws naming a missing or mismatched question", () => {
  const questions = {
    urgent: noul("Need a human?"),
    topic: choice("What is it about?", ["billing", "bug"]),
  };

  assert.throws(
    () => wrapAnswers({ urgent: { type: "noul", noul: 0.9 } }, questions),
    (err: unknown) => {
      assert.equal(err instanceof Error, true);
      assert.equal((err as Error).message, 'no answer for question "topic"');
      return true;
    },
  );
  assert.throws(
    () =>
      wrapAnswers(
        {
          urgent: {
            type: "choice",
            choice: "billing",
            probabilities: { billing: 1 },
            confidence: 1,
          },
          topic: {
            type: "choice",
            choice: "billing",
            probabilities: { billing: 1, bug: 0 },
            confidence: 1,
          },
        },
        questions,
      ),
    (err: unknown) => {
      assert.equal(err instanceof Error, true);
      assert.equal((err as Error).message, 'no answer for question "urgent"');
      return true;
    },
  );
});

test("wrapAnswers throws naming a score outside the rubric", () => {
  const questions = { quality: score("How severe?", ["low", "medium", "high"]) };
  const raw = {
    type: "score" as const,
    probabilities: { "0": 0, "1": 0, "2": 1 },
    confidence: 1,
  };

  assert.throws(
    () => wrapAnswers({ quality: { ...raw, score: 5 } }, questions),
    (err: unknown) => {
      assert.equal((err as Error).message, 'no answer for question "quality"');
      return true;
    },
  );
  assert.throws(
    () => wrapAnswers({ quality: { ...raw, score: -0.1 } }, questions),
    (err: unknown) => {
      assert.equal((err as Error).message, 'no answer for question "quality"');
      return true;
    },
  );

  const top = wrapAnswers({ quality: { ...raw, score: 2 } }, questions);
  assert.equal(top.quality.score, 2);
  assert.equal(top.quality.ratio, 1);
  assert.equal(top.quality.level, 2);
});
