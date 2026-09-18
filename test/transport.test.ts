import { test } from "node:test";
import assert from "node:assert/strict";
import { HunchoError } from "../src/index.js";
import { postJson } from "../src/transport.js";

const url = "https://example.test/v1";
const headers = { Authorization: "Bearer test" };
const payload = { ping: true };

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(status: number, json: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function textResponse(status: number, body: string, extraHeaders?: Record<string, string>): Response {
  const init: ResponseInit = { status };
  if (extraHeaders !== undefined) init.headers = extraHeaders;
  return new Response(body, init);
}

test("429 then 200 makes two calls and succeeds", async () => {
  let calls = 0;
  const fetchImpl: FetchLike = async () => {
    calls += 1;
    if (calls === 1) return textResponse(429, "slow down");
    return jsonResponse(200, { ok: true });
  };

  const result = await postJson("scripted", url, headers, payload, { fetch: fetchImpl, retries: 2 });

  assert.equal(calls, 2);
  assert.deepEqual(result.json, { ok: true });
  assert.equal(result.headers.get("content-type"), "application/json");
});

test("401 makes one call and rejects with HunchoError status 401", async () => {
  const body = "denied".repeat(80);
  let calls = 0;
  const fetchImpl: FetchLike = async () => {
    calls += 1;
    return textResponse(401, body, { "x-request-id": "req-401" });
  };

  await assert.rejects(
    () => postJson("scripted", url, headers, payload, { fetch: fetchImpl, retries: 4 }),
    (err: unknown) => {
      assert.equal(err instanceof HunchoError, true);
      const huncho = err as HunchoError;
      assert.equal(huncho.provider, "scripted");
      assert.equal(huncho.status, 401);
      assert.equal(huncho.requestId, "req-401");
      assert.equal(huncho.body, body.slice(0, 300));
      assert.equal(huncho.body?.length, 300);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("a network error then 200 succeeds", async () => {
  let calls = 0;
  const fetchImpl: FetchLike = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed");
    return jsonResponse(200, { ok: true });
  };

  const result = await postJson("scripted", url, headers, payload, { fetch: fetchImpl, retries: 2 });

  assert.equal(calls, 2);
  assert.deepEqual(result.json, { ok: true });
});

function hangingResponse(status: number): Response {
  return new Response(
    new ReadableStream({
      start() {
        /* never enqueues; cancelled by abort */
      },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

test("abort while reading a 2xx body rejects with the abort reason", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    const fetchImpl: FetchLike = async () => {
      queueMicrotask(() => controller.abort("stopped"));
      return hangingResponse(200);
    };

    await assert.rejects(
      () =>
        postJson("scripted", url, headers, payload, {
          fetch: fetchImpl,
          signal: controller.signal,
        }),
      (err: unknown) => {
        assert.equal(err, "stopped");
        return true;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("abort while reading an error body rejects with the abort reason, not HunchoError", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const fetchImpl: FetchLike = async () => {
    queueMicrotask(() => controller.abort("stopped"));
    return hangingResponse(401);
  };

  await assert.rejects(
    () =>
      postJson("scripted", url, headers, payload, {
        fetch: fetchImpl,
        retries: 0,
        signal: controller.signal,
      }),
    (err: unknown) => {
      assert.equal(err, "stopped");
      return true;
    },
  );
});

test("abort during backoff rejects with the abort reason and makes no further calls", async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetchImpl: FetchLike = async () => {
    calls += 1;
    return textResponse(429, "slow down");
  };

  const pending = postJson("scripted", url, headers, payload, {
    fetch: fetchImpl,
    retries: 3,
    signal: controller.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.abort("stopped");

  await assert.rejects(
    pending,
    (err: unknown) => {
      assert.equal(err, "stopped");
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("ms includes time spent retrying", async () => {
  const immediateFetch: FetchLike = async () => jsonResponse(200, { ok: true });
  const immediate = await postJson("scripted", url, headers, payload, { fetch: immediateFetch });

  let calls = 0;
  const retriedFetch: FetchLike = async () => {
    calls += 1;
    if (calls === 1) return textResponse(429, "slow down");
    return jsonResponse(200, { ok: true });
  };
  const retried = await postJson("scripted", url, headers, payload, { fetch: retriedFetch, retries: 2 });

  assert.equal(calls, 2);
  assert.ok(retried.ms > immediate.ms);
  assert.ok(retried.ms >= 100);
});
