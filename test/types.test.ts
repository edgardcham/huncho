import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HunchoError,
  ProviderError,
  type Model,
  type Question,
  type Questions,
  type RawAnswer,
} from "../src/index.js";
import { scriptedModel } from "huncho/testing";

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

test("evaluate rejects with ProviderError, never a bare error", async () => {
  const cause = new Error("upstream");
  const model: Model = {
    provider: "scripted",
    id: "scripted-1",
    async evaluate() {
      throw new ProviderError("scripted: refused", {
        provider: "scripted",
        status: 401,
        requestId: "req-err",
        body: "denied",
        retryable: false,
        cause,
      });
    },
  };

  await assert.rejects(
    () => model.evaluate({ state: "plain", questions: { urgent: questions.urgent } }),
    (err: unknown) => {
      assert.equal(err instanceof Error, true);
      assert.equal(err instanceof HunchoError, true);
      assert.equal(ProviderError.isInstance(err), true);
      const failure = err as ProviderError;
      assert.equal(failure.name, "ProviderError");
      assert.equal(failure.provider, "scripted");
      assert.equal(failure.status, 401);
      assert.equal(failure.requestId, "req-err");
      assert.equal(failure.body, "denied");
      assert.equal(failure.retryable, false);
      assert.equal(failure.cause, cause);
      return true;
    },
  );
});
