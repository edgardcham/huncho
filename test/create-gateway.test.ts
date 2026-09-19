import { test } from "node:test";
import assert from "node:assert/strict";
import { createGateway, gateway, ConfigError, noul, type Provider } from "../src/index.js";

const questions = {
  urgent: noul("Does this need a human within the hour?"),
};
const response = {
  answers: { urgent: { type: "boolean", probability: 0.91 } },
  usage: { inputTokens: 12, outputTokens: 4 },
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type RecordedCall = {
  url: string;
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
};

function jsonResponse(json: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function recordingFetch(json: unknown = response): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    calls.push({
      url: String(input),
      ...(init?.method !== undefined ? { method: init.method } : {}),
      ...(init?.headers !== undefined ? { headers: init.headers } : {}),
      ...(init?.body !== undefined ? { body: init.body } : {}),
    });
    return jsonResponse(json, { "x-vercel-id": "req-1" });
  };
  return { fetch: fetchImpl, calls };
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

test("gateway has a name and default model without reading the environment", async () => {
  await withEnv("AI_GATEWAY_API_KEY", undefined, () => {
    assert.equal(gateway.name, "gateway");
    assert.equal(gateway.defaultModel, "typesafe-ai/jev");
    const provider = createGateway();
    assert.equal(provider.name, "gateway");
    assert.equal(provider.defaultModel, "typesafe-ai/jev");
    assert.throws(
      () => provider(),
      (err: unknown) => {
        assert.equal(ConfigError.isInstance(err), true);
        assert.match((err as Error).message, /set AI_GATEWAY_API_KEY or pass apiKey to createGateway/);
        return true;
      },
    );
    assert.throws(
      () => createGateway({ apiKey: "" })(),
      (err: unknown) => {
        assert.equal(ConfigError.isInstance(err), true);
        assert.match((err as Error).message, /set AI_GATEWAY_API_KEY or pass apiKey to createGateway/);
        return true;
      },
    );
  });
});

test("createGateway reads the env key on first use and an explicit apiKey wins", async () => {
  const fromEnv = recordingFetch();
  let late: Provider | undefined;
  await withEnv("AI_GATEWAY_API_KEY", undefined, () => {
    late = createGateway({ fetch: fromEnv.fetch });
    assert.equal(late.name, "gateway");
  });
  await withEnv("AI_GATEWAY_API_KEY", "env-key", async () => {
    assert.ok(late);
    await late().evaluate({ state: "x", questions });
    assert.equal(header(first(fromEnv.calls).headers, "authorization"), "Bearer env-key");

    const explicit = recordingFetch();
    await createGateway({ apiKey: "explicit", fetch: explicit.fetch })().evaluate({ state: "x", questions });
    assert.equal(header(first(explicit.calls).headers, "authorization"), "Bearer explicit");
  });
});

test("createGateway evaluates through the gateway dialect", async () => {
  const { fetch, calls } = recordingFetch();
  const model = createGateway({ apiKey: "k", fetch, headers: { "X-Title": "huncho" } })();
  const result = await model.evaluate({ state: { subject: "invoice" }, questions });

  const posted = first(calls);
  assert.equal(model.provider, "gateway");
  assert.equal(model.id, "typesafe-ai/jev");
  assert.equal(posted.url, "https://ai-gateway.vercel.sh/v4/ai/evaluation-model");
  assert.equal(posted.method, "POST");
  assert.equal(header(posted.headers, "authorization"), "Bearer k");
  assert.equal(header(posted.headers, "x-title"), "huncho");
  assert.equal(header(posted.headers, "ai-gateway-protocol-version"), "0.0.1");
  assert.equal(header(posted.headers, "ai-gateway-auth-method"), "api-key");
  assert.equal(header(posted.headers, "ai-evaluation-model-specification-version"), "4");
  assert.equal(header(posted.headers, "ai-model-id"), "typesafe-ai/jev");
  assert.deepEqual(posted.body === undefined ? undefined : JSON.parse(String(posted.body)), {
    state: { subject: "invoice" },
    questions: {
      urgent: { type: "boolean", instructions: "Does this need a human within the hour?" },
    },
  });
  assert.equal(result.provider, "gateway");
  assert.equal(result.model, "typesafe-ai/jev");
  assert.equal(result.requestId, "req-1");
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4 });
  assert.deepEqual(result.answers, { urgent: { type: "noul", noul: 0.91 } });
});

test("createGateway honours url, defaultModel and the callable id", async () => {
  const { fetch, calls } = recordingFetch();
  const provider = createGateway({
    apiKey: "k",
    fetch,
    url: "https://example.test/evaluation-model",
    defaultModel: "typesafe-ai/jev-latest",
  });
  assert.equal(provider.defaultModel, "typesafe-ai/jev-latest");
  const selected = provider("typesafe-ai/jev-preview");
  assert.equal(selected.id, "typesafe-ai/jev-preview");
  await selected.evaluate({ state: "x", questions });
  const posted = first(calls);
  assert.equal(posted.url, "https://example.test/evaluation-model");
  assert.equal(header(posted.headers, "ai-model-id"), "typesafe-ai/jev-preview");
  const body = posted.body === undefined ? undefined : JSON.parse(String(posted.body));
  assert.equal(body === undefined || Object.hasOwn(body, "model"), false);
});

test(
  "live gateway evaluate returns answer keys and usage",
  { skip: !process.env.AI_GATEWAY_API_KEY },
  async () => {
    const asked = { yes: noul("Is two plus two four?") };
    const result = await gateway().evaluate({ state: "Two plus two is four.", questions: asked });
    assert.deepEqual(Object.keys(result.answers).sort(), Object.keys(asked).sort());
    assert.ok(result.usage.inputTokens > 0);
    assert.ok(result.usage.outputTokens > 0);
  },
);

function first<T>(items: readonly T[]): T {
  const item = items[0];
  assert.ok(item);
  return item;
}

function header(headers: HeadersInit | undefined, name: string): string | null {
  return new Headers(headers).get(name);
}
