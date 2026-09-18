// Internal JSON POST used by every wire.
// Retry, abort and HunchoError construction live here; wires do not reimplement them.

import { HunchoError } from "./types.js";

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 529]);
const DEFAULT_RETRIES = 4;
const BACKOFF_START_MS = 400;
const BACKOFF_CAP_MS = 8_000;
const BODY_SNIPPET = 300;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function postJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: {
    fetch?: FetchLike;
    retries?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{ json: unknown; headers: Headers; ms: number }> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const signal = options.signal;
  const payload = JSON.stringify(body);
  const t0 = Date.now();
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw abortReason(signal);
    if (attempt > 0) await sleep(backoffMs(attempt - 1), signal);

    let res: Response;
    try {
      const init: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: payload,
      };
      if (signal !== undefined) init.signal = signal;
      res = await doFetch(url, init);
    } catch (cause) {
      if (signal?.aborted) throw abortReason(signal, cause);
      lastErr = cause;
      continue;
    }

    if (res.ok) {
      const json: unknown = await res.json();
      return { json, headers: res.headers, ms: Date.now() - t0 };
    }

    const err = await hunchoErrorFromResponse(provider, res);
    if (!RETRY_STATUSES.has(res.status) || attempt === retries) throw err;
    lastErr = err;
  }

  if (lastErr instanceof HunchoError) throw lastErr;
  throw new HunchoError(`${provider}: request failed after retries`, {
    provider,
    ...(lastErr !== undefined ? { cause: lastErr } : {}),
  });
}

function backoffMs(retryIndex: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_START_MS * 2 ** retryIndex);
}

function abortReason(signal: AbortSignal, cause?: unknown): unknown {
  return signal.reason !== undefined ? signal.reason : cause;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

async function hunchoErrorFromResponse(provider: string, res: Response): Promise<HunchoError> {
  const text = await res.text().catch(() => "");
  const snippet = text.slice(0, BODY_SNIPPET);
  const requestId = res.headers.get("x-request-id") ?? res.headers.get("x-vercel-id");
  const options: {
    provider: string;
    status: number;
    requestId?: string;
    body?: string;
  } = { provider, status: res.status };
  if (requestId) options.requestId = requestId;
  if (snippet !== "") options.body = snippet;
  return new HunchoError(
    `${provider}: HTTP ${res.status}${snippet !== "" ? ` ${snippet}` : ""}`,
    options,
  );
}
