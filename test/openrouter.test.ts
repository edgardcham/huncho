import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenRouter, HunchoError, noul, openrouter, type Provider } from "../src/index.js";

const questions = {
  urgent: noul("Does this need a human within the hour?"),
};
const response = {
  model: "~typesafe/jev-latest",
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

test("openrouter has a name and default model without reading the environment", async () => {
  await withEnv("OPENROUTER_API_KEY", undefined, () => {
    assert.equal(openrouter.name, "openrouter");
    assert.equal(openrouter.defaultModel, "~typesafe/jev-latest");
    const provider = createOpenRouter();
    assert.equal(provider.name, "openrouter");
    assert.equal(provider.defaultModel, "~typesafe/jev-latest");
    assert.throws(
      () => provider(),
      (err: unknown) => {
        assert.equal(err instanceof HunchoError, true);
        assert.equal((err as HunchoError).provider, "openrouter");
        return true;
      },
    );
    assert.throws(
      () => createOpenRouter({ apiKey: "" })(),
      (err: unknown) => {
        assert.equal(err instanceof HunchoError, true);
        assert.equal((err as HunchoError).provider, "openrouter");
        return true;
      },
    );
  });
});

test("createOpenRouter reads the env key on first use and an explicit apiKey wins", async () => {
  const fromEnv = recordingFetch();
  let late: Provider | undefined;
  await withEnv("OPENROUTER_API_KEY", undefined, () => {
    late = createOpenRouter({ fetch: fromEnv.fetch });
    assert.equal(late.name, "openrouter");
  });
  await withEnv("OPENROUTER_API_KEY", "env-key", async () => {
    assert.ok(late);
    await late().evaluate({ state: "x", questions });
    assert.equal(header(first(fromEnv.calls).headers, "authorization"), "Bearer env-key");

    const explicit = recordingFetch();
    await createOpenRouter({ apiKey: "explicit", fetch: explicit.fetch })().evaluate({
      state: "x",
      questions,
    });
    assert.equal(header(first(explicit.calls).headers, "authorization"), "Bearer explicit");
  });
});

test("createOpenRouter posts the tilde model to the alpha URL with a bearer key", async () => {
  const { fetch, calls } = recordingFetch();
  const model = createOpenRouter({ apiKey: "k", fetch })();
  const result = await model.evaluate({ state: { subject: "invoice" }, questions });

  const posted = first(calls);
  assert.equal(model.provider, "openrouter");
  assert.equal(model.id, "~typesafe/jev-latest");
  assert.equal(posted.url, "https://openrouter.ai/api/alpha/decisions");
  assert.equal(posted.method, "POST");
  assert.equal(header(posted.headers, "authorization"), "Bearer k");
  assert.equal(header(posted.headers, "http-referer"), null);
  assert.equal(header(posted.headers, "x-title"), null);
  assert.deepEqual(posted.body === undefined ? undefined : JSON.parse(String(posted.body)), {
    model: "~typesafe/jev-latest",
    state: { subject: "invoice" },
    questions,
  });
  assert.equal(result.provider, "openrouter");
  assert.equal(result.model, "~typesafe/jev-latest");
  assert.equal(result.requestId, "req-1");
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4 });
  assert.deepEqual(result.answers, { urgent: { type: "noul", noul: 0.91 } });
});

test("createOpenRouter sends attribution headers only when configured", async () => {
  const both = recordingFetch();
  await createOpenRouter({
    apiKey: "k",
    fetch: both.fetch,
    referer: "https://example.test",
    title: "huncho",
  })().evaluate({ state: "x", questions });
  assert.equal(header(first(both.calls).headers, "http-referer"), "https://example.test");
  assert.equal(header(first(both.calls).headers, "x-title"), "huncho");

  const refererOnly = recordingFetch();
  await createOpenRouter({ apiKey: "k", fetch: refererOnly.fetch, referer: "https://example.test" })().evaluate({
    state: "x",
    questions,
  });
  assert.equal(header(first(refererOnly.calls).headers, "http-referer"), "https://example.test");
  assert.equal(header(first(refererOnly.calls).headers, "x-title"), null);

  const titleOnly = recordingFetch();
  await createOpenRouter({ apiKey: "k", fetch: titleOnly.fetch, title: "huncho" })().evaluate({
    state: "x",
    questions,
  });
  assert.equal(header(first(titleOnly.calls).headers, "http-referer"), null);
  assert.equal(header(first(titleOnly.calls).headers, "x-title"), "huncho");
});

test("createOpenRouter honours url, defaultModel and the callable id", async () => {
  const { fetch, calls } = recordingFetch();
  const provider = createOpenRouter({
    apiKey: "k",
    fetch,
    url: "https://example.test/decisions",
    defaultModel: "~typesafe/jev-1.13",
  });
  assert.equal(provider.defaultModel, "~typesafe/jev-1.13");
  const selected = provider("~typesafe/jev-preview");
  assert.equal(selected.id, "~typesafe/jev-preview");
  await selected.evaluate({ state: "x", questions });
  const posted = first(calls);
  assert.equal(posted.url, "https://example.test/decisions");
  assert.deepEqual(posted.body === undefined ? undefined : JSON.parse(String(posted.body)), {
    model: "~typesafe/jev-preview",
    state: "x",
    questions,
  });
});

test(
  "live openrouter evaluate returns answer keys and usage",
  { skip: !process.env.OPENROUTER_API_KEY },
  async () => {
    const asked = { yes: noul("Is two plus two four?") };
    const result = await openrouter().evaluate({ state: "Two plus two is four.", questions: asked });
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
