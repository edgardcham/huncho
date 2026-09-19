import { test } from "node:test";
import assert from "node:assert/strict";
import { HunchoError } from "../src/index.js";
import { gateway } from "../src/gateway.js";

const wire = gateway({
  provider: "gateway",
  url: "https://ai-gateway.vercel.sh/v4/ai/evaluation-model",
  apiKey: "test-key",
});

test("gateway decode rejects a response with no answers", () => {
  assert.throws(
    () => wire.decode({ usage: { inputTokens: 1, outputTokens: 1 } }, new Headers(), { state: "x", questions: {} }),
    (err: unknown) => {
      assert.equal(err instanceof HunchoError, true);
      const huncho = err as HunchoError;
      assert.equal(huncho.provider, "gateway");
      assert.match(huncho.message, /no answers/);
      return true;
    },
  );
});

test("gateway decode rejects answers that do not match the questions", () => {
  const request = {
    state: "x",
    questions: {
      urgent: { type: "noul" as const, instructions: "Need a human?" },
      topic: {
        type: "choice" as const,
        instructions: "What is it about?",
        criteria: { billing: null, bug: null },
      },
    },
  };
  const headers = new Headers();

  assert.throws(
    () =>
      wire.decode(
        {
          answers: { urgent: { type: "boolean", probability: 0.9 } },
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        headers,
        request,
      ),
    (err: unknown) => {
      assert.equal(err instanceof HunchoError, true);
      assert.match((err as HunchoError).message, /do not match questions/);
      return true;
    },
  );
  assert.throws(
    () =>
      wire.decode(
        {
          answers: {
            urgent: { type: "noul", noul: 0.9 },
            topic: { type: "choice", choice: "billing", probabilities: { billing: 1, bug: 0 } },
          },
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        headers,
        request,
      ),
    (err: unknown) => {
      assert.equal(err instanceof HunchoError, true);
      assert.match((err as HunchoError).message, /do not match questions/);
      return true;
    },
  );
  assert.throws(
    () =>
      wire.decode(
        {
          answers: {
            urgent: { type: "boolean", probability: 0.9 },
            topic: { type: "choice", choice: "other", probabilities: { billing: 0.2, bug: 0.8 } },
          },
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        headers,
        request,
      ),
    (err: unknown) => {
      assert.equal(err instanceof HunchoError, true);
      assert.match((err as HunchoError).message, /do not match questions/);
      return true;
    },
  );
  assert.throws(
    () =>
      wire.decode(
        {
          answers: {
            urgent: { type: "boolean", probability: 0.9 },
            topic: { type: "choice", choice: "billing", probabilities: { billing: 1 } },
          },
          usage: { inputTokens: 1, outputTokens: 1 },
        },
        headers,
        request,
      ),
    (err: unknown) => {
      assert.equal(err instanceof HunchoError, true);
      assert.match((err as HunchoError).message, /do not match questions/);
      return true;
    },
  );
});
