import { test } from "node:test";
import assert from "node:assert/strict";
import { AnswerError, ask, choice, noul, score, type RawAnswer } from "../src/index.js";
import { scriptedModel } from "huncho/testing";

const questions = {
  urgent: noul("Need a human within the hour?"),
  topic: choice("What is it about?", ["billing", "bug", "other"]),
  quality: score("How severe is it?", ["low", "medium", "high"]),
};

const raw: Record<string, RawAnswer> = {
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
};

test("ask wraps scripted answers and returns the evaluate envelope", async () => {
  const { model, requests } = scriptedModel([{ answers: raw }]);
  const state = { subject: "invoice" };
  const result = await ask(model, state, questions);

  assert.equal(requests[0]?.state, state);
  assert.equal(requests[0]?.questions, questions);
  assert.equal(requests[0]?.signal, undefined);

  assert.equal(result.provider, "scripted");
  assert.equal(result.model, "scripted");
  assert.equal(Number.isFinite(result.ms) && result.ms >= 0, true);
  assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 });
  assert.equal(result.raw, raw);

  assert.equal(result.answers.urgent.p, 0.91);
  assert.equal(result.answers.urgent.yes, true);
  assert.equal(result.answers.topic.choice, "billing");
  assert.equal(result.answers.topic.p("billing"), 0.8);
  assert.equal(result.answers.topic.is("billing", 0.7), true);
  assert.equal(result.answers.topic.is("bug"), false);
  assert.equal(result.answers.quality.score, 1.4);
  assert.equal(result.answers.quality.ratio, 0.7);
  assert.equal(result.answers.quality.level, 1);
});

test("ask forwards an abort signal to the model", async () => {
  const { model, requests } = scriptedModel([{ answers: raw }]);
  const signal = new AbortController().signal;
  await ask(model, "plain", questions, { signal });
  assert.equal(requests[0]?.signal, signal);
});

test("ask rejects a noul outside [0, 1] with an AnswerError naming the question", async () => {
  const asked = { urgent: questions.urgent };
  for (const bad of [2, -0.1, Number.NaN]) {
    const { model } = scriptedModel([{ answers: { urgent: { type: "noul", noul: bad } } }]);
    await assert.rejects(
      () => ask(model, "plain", asked),
      (err: unknown) => {
        assert.equal(AnswerError.isInstance(err), true);
        assert.match((err as Error).message, /^answer for question "urgent" is not a well-formed noul answer/);
        return true;
      },
      `noul: ${String(bad)}`,
    );
  }

  for (const edge of [0, 1]) {
    const { model } = scriptedModel([{ answers: { urgent: { type: "noul", noul: edge } } }]);
    const result = await ask(model, "plain", asked);
    assert.equal(result.answers.urgent.p, edge);
    assert.equal(result.answers.urgent.yes, edge === 1);
  }
});
