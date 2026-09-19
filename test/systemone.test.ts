import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderError } from "../src/index.js";
import { systemone } from "../src/systemone.js";

const wire = systemone({
  provider: "jev",
  url: "https://api.typesafe.ai/v1/systemone",
  apiKey: "test-key",
});

test("systemone decode rejects a response with no answers", () => {
  assert.throws(
    () => wire.decode({ model: "jev-latest" }, new Headers(), { state: "x", questions: {} }),
    (err: unknown) => {
      assert.equal(ProviderError.isInstance(err), true);
      const failure = err as ProviderError;
      assert.equal(failure.provider, "jev");
      assert.equal(failure.retryable, false);
      assert.match(failure.message, /no answers/);
      return true;
    },
  );
});

test("systemone decode rejects answers that do not match the questions", () => {
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
          answers: { urgent: { type: "noul", noul: 0.9 } },
          usage: { input_tokens: 1, output_tokens: 1 },
        },
        headers,
        request,
      ),
    (err: unknown) => {
      assert.equal(ProviderError.isInstance(err), true);
      assert.match((err as ProviderError).message, /do not match questions/);
      return true;
    },
  );
  assert.throws(
    () =>
      wire.decode(
        {
          answers: {
            urgent: { type: "choice", choice: "billing", probabilities: { billing: 1 }, confidence: 1 },
            topic: { type: "choice", choice: "billing", probabilities: { billing: 1, bug: 0 }, confidence: 1 },
          },
          usage: { input_tokens: 1, output_tokens: 1 },
        },
        headers,
        request,
      ),
    (err: unknown) => {
      assert.equal(ProviderError.isInstance(err), true);
      assert.match((err as ProviderError).message, /do not match questions/);
      return true;
    },
  );
});
