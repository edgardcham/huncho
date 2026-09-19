import { test } from "node:test";
import assert from "node:assert/strict";
import { createJev, HunchoError, jev, noul, type Provider } from "../src/index.js";

const questions = {
  urgent: noul("Does this need a human within the hour?"),
};
const response = {
  model: "jev-latest",
  answers: { urgent: { type: "noul", noul: 0.91 } },
  usage: { input_tokens: 12, output_tokens: 4 },
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
    return jsonResponse(json, { "x-request-id": "req-1" });
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

test("jev has a name and default model without reading the environment", async () => {
  await withEnv("TYPESAFE_API_KEY", undefined, () => {
    assert.equal(jev.name, "jev");
    assert.equal(jev.defaultModel, "jev-latest");
    const provider = createJev();
    assert.equal(provider.name, "jev");
    assert.equal(provider.defaultModel, "jev-latest");
    assert.throws(
      () => provider(),
      (err: unknown) => {
        assert.equal(err instanceof HunchoError, true);
        assert.equal((err as HunchoError).provider, "jev");
        return true;
      },
    );
  });
});

test("createJev reads the env key on first use and an explicit apiKey wins", async () => {
  const fromEnv = recordingFetch();
  let late: Provider | undefined;
  await withEnv("TYPESAFE_API_KEY", undefined, () => {
    late = createJev({ fetch: fromEnv.fetch });
    assert.equal(late.name, "jev");
  });
  await withEnv("TYPESAFE_API_KEY", "env-key", async () => {
    assert.ok(late);
    await late().evaluate({ state: "x", questions });
    assert.equal(header(first(fromEnv.calls).headers, "authorization"), "Bearer env-key");

    const explicit = recordingFetch();
    await createJev({ apiKey: "explicit", fetch: explicit.fetch })().evaluate({ state: "x", questions });
    assert.equal(header(first(explicit.calls).headers, "authorization"), "Bearer explicit");
  });
});

test("createJev evaluates through the systemone dialect", async () => {
  const { fetch, calls } = recordingFetch();
  const model = createJev({ apiKey: "k", fetch, headers: { "X-Title": "huncho" } })();
  const result = await model.evaluate({ state: { subject: "invoice" }, questions });

  const posted = first(calls);
  assert.equal(model.provider, "jev");
  assert.equal(model.id, "jev-latest");
  assert.equal(posted.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(posted.method, "POST");
  assert.equal(header(posted.headers, "authorization"), "Bearer k");
  assert.equal(header(posted.headers, "x-title"), "huncho");
  assert.deepEqual(posted.body === undefined ? undefined : JSON.parse(String(posted.body)), {
    model: "jev-latest",
    state: { subject: "invoice" },
    questions,
  });
  assert.equal(result.provider, "jev");
  assert.equal(result.model, "jev-latest");
  assert.equal(result.requestId, "req-1");
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4 });
  assert.deepEqual(result.answers, { urgent: { type: "noul", noul: 0.91 } });
});

test("createJev honours url, defaultModel and the callable id", async () => {
  const { fetch, calls } = recordingFetch();
  const provider = createJev({
    apiKey: "k",
    fetch,
    url: "https://example.test/systemone",
    defaultModel: "jev-1.13",
  });
  assert.equal(provider.defaultModel, "jev-1.13");
  const selected = provider("jev-preview");
  assert.equal(selected.id, "jev-preview");
  await selected.evaluate({ state: "x", questions });
  const posted = first(calls);
  assert.equal(posted.url, "https://example.test/systemone");
  assert.deepEqual(posted.body === undefined ? undefined : JSON.parse(String(posted.body)), {
    model: "jev-preview",
    state: "x",
    questions,
  });
});

test(
  "live jev evaluate returns answer keys and usage",
  { skip: !process.env.TYPESAFE_API_KEY },
  async () => {
    const asked = { yes: noul("Is two plus two four?") };
    const result = await jev().evaluate({ state: "Two plus two is four.", questions: asked });
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
