import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AnswerError,
  ConfigError,
  createJev,
  huncho,
  HunchoError,
  noul,
  policy,
  PolicyError,
  ProviderError,
  wrapAnswers,
} from "../src/index.js";
import { scriptedModel } from "huncho/testing";

const DOCS = "https://github.com/edgardcham/huncho/blob/main/";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function respond(status: number, body: string): FetchLike {
  return async () => new Response(body, { status });
}

function withEnv(name: string, value: string | undefined, run: () => void | Promise<void>): Promise<void> {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
}

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (err) {
    return err;
  }
  assert.fail("expected a throw");
}

async function rejected(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  assert.fail("expected a rejection");
}

test("each layer throws its own class, and every one is a HunchoError", async () => {
  const config = thrown(() => createJev({ apiKey: "" })());
  assert.equal(ConfigError.isInstance(config), true);
  assert.equal(HunchoError.isInstance(config), true);
  assert.equal(config instanceof ConfigError, true);
  assert.equal(config instanceof HunchoError, true);
  assert.equal(config instanceof Error, true);
  assert.equal((config as Error).name, "ConfigError");

  const provider = await rejected(() =>
    createJev({ apiKey: "k", fetch: respond(401, "denied"), retries: 0 })().evaluate({ state: "x", questions: {} }),
  );
  assert.equal(ProviderError.isInstance(provider), true);
  assert.equal(HunchoError.isInstance(provider), true);
  assert.equal((provider as Error).name, "ProviderError");

  const noMatch = thrown(() => policy<{ p: number }>("support.route").when((a) => a.p, { enter: 0.8 }, "page").decide({ p: 0.1 }));
  assert.equal(PolicyError.isInstance(noMatch), true);
  assert.equal(HunchoError.isInstance(noMatch), true);
  assert.equal((noMatch as Error).name, "PolicyError");

  const answer = thrown(() => wrapAnswers({}, { urgent: noul("Need a human?") }));
  assert.equal(AnswerError.isInstance(answer), true);
  assert.equal(HunchoError.isInstance(answer), true);
  assert.equal((answer as Error).name, "AnswerError");
});

test("isInstance tells the classes apart and rejects anything else", () => {
  const config = new ConfigError("x");
  assert.equal(ProviderError.isInstance(config), false);
  assert.equal(PolicyError.isInstance(config), false);
  assert.equal(AnswerError.isInstance(config), false);

  const base = new HunchoError("x");
  assert.equal(HunchoError.isInstance(base), true);
  assert.equal(ConfigError.isInstance(base), false);

  for (const other of [new Error("HunchoError"), { name: "ConfigError", message: "x" }, "ConfigError", null, undefined, 42]) {
    assert.equal(HunchoError.isInstance(other), false);
    assert.equal(ConfigError.isInstance(other), false);
  }
});

test("a second copy of the module fails instanceof but passes isInstance", async () => {
  const copy = (await import(`../src/errors.js?copy=${Date.now()}`)) as typeof import("../src/errors.js");
  assert.notEqual(copy.ConfigError, ConfigError);

  const theirs: unknown = new copy.ConfigError("x");
  assert.equal(theirs instanceof ConfigError, false);
  assert.equal(theirs instanceof HunchoError, false);
  assert.equal(ConfigError.isInstance(theirs), true);
  assert.equal(HunchoError.isInstance(theirs), true);
  assert.equal(ProviderError.isInstance(theirs), false);

  const ours: unknown = new ProviderError("x", { provider: "jev", retryable: true });
  assert.equal(ours instanceof copy.ProviderError, false);
  assert.equal(copy.ProviderError.isInstance(ours), true);
  assert.equal(copy.HunchoError.isInstance(ours), true);
});

test("ProviderError carries the fields the ticket names and nothing is lost on the way up", async () => {
  const cause = new Error("upstream");
  const err = new ProviderError("jev: refused", {
    provider: "jev",
    status: 422,
    requestId: "req-1",
    body: "bad",
    retryable: false,
    cause,
  });
  assert.equal(err.provider, "jev");
  assert.equal(err.status, 422);
  assert.equal(err.requestId, "req-1");
  assert.equal(err.body, "bad");
  assert.equal(err.retryable, false);
  assert.equal(err.cause, cause);

  const bare = new ProviderError("jev: down", { provider: "jev", retryable: true });
  assert.equal("status" in bare, false);
  assert.equal("requestId" in bare, false);
  assert.equal("body" in bare, false);
  assert.equal("cause" in bare, false);
  assert.equal(bare.retryable, true);
});

test("messages: a missing key", async () => {
  await withEnv("TYPESAFE_API_KEY", undefined, () => {
    const err = thrown(() => createJev()()) as Error;
    assert.equal(
      err.message,
      `jev: set TYPESAFE_API_KEY or pass apiKey to createJev, see ${DOCS}docs/providers.md#keys`,
    );
  });
});

test("messages: a rejected key", async () => {
  const err = (await rejected(() =>
    createJev({ apiKey: "k", fetch: respond(401, '{"error":"invalid api key"}'), retries: 0 })().evaluate({
      state: "x",
      questions: {},
    }),
  )) as Error;
  assert.equal(err.message, `jev: HTTP 401: {"error":"invalid api key"}, see ${DOCS}docs/providers.md#keys`);
});

test("messages: retries exhausted", async () => {
  const err = (await rejected(() =>
    createJev({ apiKey: "k", fetch: respond(429, "slow down"), retries: 1 })().evaluate({ state: "x", questions: {} }),
  )) as Error;
  assert.equal(err.message, `jev: HTTP 429 after 2 attempts: slow down, see ${DOCS}docs/providers.md#retries`);
});

test("messages: no clause matched and no else", async () => {
  const { model } = scriptedModel([{ answers: { urgent: { type: "noul", noul: 0.1 } } }]);
  const route = huncho("support.route", { model })
    .ask({ urgent: noul("Need a human?") })
    .when((a) => a.urgent.p, { enter: 0.8 }, "page");
  const err = (await rejected(() => route.decide("plain"))) as Error;
  assert.equal(
    err.message,
    `policy "support.route": no clause matched and there is no else, see ${DOCS}docs/policy.md#clauses`,
  );
});

test("messages: a question without an answer", async () => {
  const { model } = scriptedModel([{ answers: { urgent: { type: "noul", noul: 0.1 } } }]);
  const route = huncho("support.route", { model })
    .ask({ urgent: noul("Need a human?"), refund: noul("Is this a refund?") })
    .else("wait");
  const err = (await rejected(() => route.decide("plain"))) as Error;
  assert.equal(err.message, `no answer for question "refund", see ${DOCS}docs/providers.md#errors`);
});

test("every huncho message ends with a docs pointer", async () => {
  const messages = [
    thrown(() => createJev({ apiKey: "" })()),
    thrown(() => policy<{ p: number }>("x").when((a) => a.p, { enter: 0.5, exit: 0.9 }, "page")),
    thrown(() => policy<{ p: number }>("x").decide({ p: 1 })),
    thrown(() => wrapAnswers({}, { urgent: noul("Need a human?") })),
    await rejected(() => huncho("x", { model: scriptedModel([{ answers: {} }]).model }).evaluate("plain")),
    await rejected(() =>
      createJev({ apiKey: "k", fetch: respond(500, ""), retries: 0 })().evaluate({ state: "x", questions: {} }),
    ),
  ].map((err) => (err as Error).message);
  for (const message of messages) {
    assert.match(message, /, see https:\/\/github\.com\/edgardcham\/huncho\/blob\/main\/[A-Za-z/.-]+\.md#[a-z-]+$/, message);
  }
});
