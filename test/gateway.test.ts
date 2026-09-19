import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HunchoError, type EvaluateRequest } from "../src/index.js";
import { gateway } from "../src/gateway.js";

const dir = "fixtures/wires/gateway";
const wire = gateway({
  provider: "gateway",
  url: "https://ai-gateway.vercel.sh/v4/ai/evaluation-model",
  apiKey: "test-key",
  headers: { "X-Title": "huncho" },
});

type Fixture = {
  model: string;
  request: EvaluateRequest;
  encoded: unknown;
  response: unknown;
  headers: Record<string, string>;
  decoded: unknown;
};

for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
  test(`gateway fixture ${file} encodes and decodes exactly`, () => {
    const fixture = JSON.parse(readFileSync(join(dir, file), "utf8")) as Fixture;
    assert.deepEqual(wire.encode(fixture.request, fixture.model), fixture.encoded);
    assert.deepEqual(
      wire.decode(fixture.response, new Headers(fixture.headers), fixture.request),
      fixture.decoded,
    );
  });
}

test("gateway url and headers put the model in Ai-Model-Id, not the body", () => {
  assert.equal(wire.url("typesafe-ai/jev"), "https://ai-gateway.vercel.sh/v4/ai/evaluation-model");
  assert.deepEqual(wire.headers("typesafe-ai/jev"), {
    "X-Title": "huncho",
    Authorization: "Bearer test-key",
    "Ai-Gateway-Protocol-Version": "0.0.1",
    "Ai-Gateway-Auth-Method": "api-key",
    "Ai-Evaluation-Model-Specification-Version": "4",
    "Ai-Model-Id": "typesafe-ai/jev",
  });
  assert.equal(
    Object.hasOwn(
      wire.encode({ state: "x", questions: { urgent: { type: "noul", instructions: "Need a human?" } } }, "typesafe-ai/jev") as object,
      "model",
    ),
    false,
  );
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
});
