import { test } from "node:test";
import assert from "node:assert/strict";
import { ask, choice, noul, score, type EvaluateRequest, type Model, type RawAnswer } from "../src/index.js";

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

function scripted(capture: { req?: EvaluateRequest } = {}): Model {
  return {
    provider: "scripted",
    id: "scripted-1",
    async evaluate(req) {
      capture.req = req;
      return {
        provider: "scripted",
        model: "scripted-1",
        answers: raw,
        usage: { inputTokens: 12, outputTokens: 4 },
        ms: 7,
      };
    },
  };
}

test("ask wraps scripted answers and returns the evaluate envelope", async () => {
  const capture: { req?: EvaluateRequest } = {};
  const state = { subject: "invoice" };
  const result = await ask(scripted(capture), state, questions);

  assert.equal(capture.req?.state, state);
  assert.equal(capture.req?.questions, questions);
  assert.equal(capture.req?.signal, undefined);

  assert.equal(result.provider, "scripted");
  assert.equal(result.model, "scripted-1");
  assert.equal(result.ms, 7);
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4 });
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
  const capture: { req?: EvaluateRequest } = {};
  const signal = new AbortController().signal;
  await ask(scripted(capture), "plain", questions, { signal });
  assert.equal(capture.req?.signal, signal);
});
