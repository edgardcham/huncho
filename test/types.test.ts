import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HunchoError,
  type Model,
  type Question,
  type Questions,
  type RawAnswer,
} from "../src/index.js";
import { scriptedModel } from "../src/testing.js";

const questions = {
  urgent: { type: "noul", instructions: "Need a human within the hour?" },
  topic: {
    type: "choice",
    instructions: "What is it about?",
    criteria: { billing: null, bug: null, other: null },
  },
  quality: {
    type: "score",
    instructions: "How severe is it?",
    criteria: ["low", "high"],
  },
} as const satisfies Questions;

function answerOf(question: Question): RawAnswer {
  if (question.type === "noul") return { type: "noul", noul: 0.91 };
  if (question.type === "choice") {
    const labels = Object.keys(question.criteria);
    const choice = labels[0];
    assert.ok(choice);
    const probabilities = Object.fromEntries(labels.map((label, i) => [label, i === 0 ? 1 : 0]));
    return { type: "choice", choice, probabilities, confidence: 1 };
  }
  const last = question.criteria.length - 1;
  const probabilities = Object.fromEntries(
    question.criteria.map((_, i) => [String(i), i === last ? 1 : 0]),
  );
  return { type: "score", score: last, probabilities, confidence: 1 };
}

function answersFor(asked: Questions): Record<string, RawAnswer> {
  const answers: Record<string, RawAnswer> = {};
  for (const [key, question] of Object.entries(asked)) {
    answers[key] = answerOf(question);
  }
  return answers;
}

test("a scripted Model evaluates end to end in the canonical shape", async () => {
  const { model, requests } = scriptedModel([{ answers: answersFor(questions) }]);
  const result = await model.evaluate({
    state: { subject: "invoice" },
    questions,
  });

  assert.equal(model.provider, "scripted");
  assert.equal(result.provider, "scripted");
  assert.equal(result.model, "scripted");
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0]?.state, { subject: "invoice" });
  assert.equal(Number.isFinite(result.ms) && result.ms >= 0, true);
  assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 });
  assert.deepEqual(Object.keys(result.answers).sort(), Object.keys(questions).sort());

  const urgent = result.answers.urgent;
  assert.equal(urgent?.type, "noul");
  if (urgent?.type === "noul") {
    assert.ok(urgent.noul >= 0 && urgent.noul <= 1);
  }

  const topic = result.answers.topic;
  assert.equal(topic?.type, "choice");
  if (topic?.type === "choice") {
    const mass = Object.values(topic.probabilities).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(mass - 1) < 1e-9);
    assert.equal(topic.choice, "billing");
  }

  const quality = result.answers.quality;
  assert.equal(quality?.type, "score");
  if (quality?.type === "score") {
    const mass = Object.values(quality.probabilities).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(mass - 1) < 1e-9);
  }
});

test("evaluate rejects with HunchoError, never a bare error", async () => {
  const cause = new Error("upstream");
  const model: Model = {
    provider: "scripted",
    id: "scripted-1",
    async evaluate() {
      throw new HunchoError("scripted: refused", {
        provider: "scripted",
        status: 401,
        requestId: "req-err",
        body: "denied",
        cause,
      });
    },
  };

  await assert.rejects(
    () => model.evaluate({ state: "plain", questions: { urgent: questions.urgent } }),
    (err: unknown) => {
      assert.equal(err instanceof Error, true);
      assert.equal(err instanceof HunchoError, true);
      const huncho = err as HunchoError;
      assert.equal(huncho.name, "HunchoError");
      assert.equal(huncho.provider, "scripted");
      assert.equal(huncho.status, 401);
      assert.equal(huncho.requestId, "req-err");
      assert.equal(huncho.body, "denied");
      assert.equal(huncho.cause, cause);
      return true;
    },
  );
});
