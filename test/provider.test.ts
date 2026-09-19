import { test } from "node:test";
import assert from "node:assert/strict";
import { createProvider, HunchoError, noul, ProviderError } from "../src/index.js";

const questions = {
  urgent: noul("Does this need a human within the hour?"),
};

test("createProvider yields a Model whose results carry provider and requestId", async () => {
  const provider = createProvider({
    name: "rules",
    defaultModel: "v1",
    evaluate: async ({ model }) => ({
      answers: { urgent: { type: "noul", noul: 0.4 } },
      requestId: `req-${model}`,
    }),
  });

  assert.equal(provider.name, "rules");
  assert.equal(provider.defaultModel, "v1");

  const model = provider();
  assert.equal(model.provider, "rules");
  assert.equal(model.id, "v1");

  const result = await model.evaluate({ state: { subject: "invoice" }, questions });
  assert.equal(result.provider, "rules");
  assert.equal(result.model, "v1");
  assert.equal(result.requestId, "req-v1");
  assert.deepEqual(result.answers, { urgent: { type: "noul", noul: 0.4 } });
  assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 });
  assert.equal(Number.isFinite(result.ms) && result.ms >= 0, true);

  const selected = await provider("v2").evaluate({ state: "x", questions });
  assert.equal(selected.model, "v2");
  assert.equal(selected.requestId, "req-v2");
});

test("createProvider defaults the model id and forwards state, questions and signal", async () => {
  const signal = new AbortController().signal;
  const seen: Array<{
    model: string;
    state: unknown;
    keys: string[];
    signal: AbortSignal | undefined;
  }> = [];

  const provider = createProvider({
    name: "in-process",
    evaluate: async ({ model, state, questions, signal: received }) => {
      seen.push({
        model,
        state,
        keys: Object.keys(questions),
        signal: received,
      });
      return {
        answers: { urgent: { type: "noul", noul: 0.2 } },
        usage: { inputTokens: 3, outputTokens: 1 },
      };
    },
  });

  assert.equal(provider.defaultModel, "default");
  const result = await provider().evaluate({ state: "plain", questions, signal });
  assert.equal(result.model, "default");
  assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 1 });
  assert.equal("requestId" in result, false);
  assert.deepEqual(seen, [{ model: "default", state: "plain", keys: ["urgent"], signal }]);
});

test("createProvider wraps a bare evaluate throw as a ProviderError that is not retryable", async () => {
  const cause = new Error("boom");
  const provider = createProvider({
    name: "rules",
    evaluate: async () => {
      throw cause;
    },
  });

  await assert.rejects(
    () => provider().evaluate({ state: "x", questions }),
    (err: unknown) => {
      assert.equal(ProviderError.isInstance(err), true);
      assert.equal(HunchoError.isInstance(err), true);
      const failure = err as ProviderError;
      assert.equal(failure.provider, "rules");
      assert.equal(failure.retryable, false);
      assert.equal(failure.cause, cause);
      return true;
    },
  );
});

test("createProvider rejects with the abort reason once the signal has fired", async () => {
  const controller = new AbortController();
  const provider = createProvider({
    name: "rules",
    evaluate: ({ signal }) =>
      new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("interrupted")), { once: true });
      }),
  });

  const pending = provider().evaluate({ state: "x", questions, signal: controller.signal });
  controller.abort("stopped");

  await assert.rejects(pending, (err: unknown) => {
    assert.equal(err, "stopped");
    return true;
  });
});

test("createProvider rethrows any HunchoError from evaluate untouched", async () => {
  const failure = new ProviderError("rules: refused", {
    provider: "rules",
    status: 422,
    requestId: "req-err",
    retryable: false,
  });
  const provider = createProvider({
    name: "rules",
    evaluate: async () => {
      throw failure;
    },
  });

  await assert.rejects(
    () => provider().evaluate({ state: "x", questions }),
    (err: unknown) => {
      assert.equal(err, failure);
      return true;
    },
  );
});
