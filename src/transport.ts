// Internal JSON POST used by every wire.
// Retry, abort and ProviderError construction live here; wires do not reimplement them.

import { ProviderError, see } from "./errors.js";

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

    if (signal?.aborted) throw abortReason(signal);

    if (res.ok) {
      const json: unknown = await readBody(res, signal, () => res.json());
      return { json, headers: res.headers, ms: Date.now() - t0 };
    }

    // Built on every failed attempt: reading the body releases the connection. Only the last is thrown.
    const retryable = RETRY_STATUSES.has(res.status);
    const err = await errorFromResponse(provider, res, retryable ? attempt + 1 : undefined, signal);
    if (!retryable || attempt === retries) throw err;
  }

  throw new ProviderError(
    `${provider}: request failed after ${spent(retries + 1)}, ${see("docs/providers.md#retries")}`,
    { provider, retryable: true, ...(lastErr !== undefined ? { cause: lastErr } : {}) },
  );
}

function backoffMs(retryIndex: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_START_MS * 2 ** retryIndex);
}

function abortReason(signal: AbortSignal, cause?: unknown): unknown {
  return signal.reason !== undefined ? signal.reason : cause;
}

function readBody<T>(res: Response, signal: AbortSignal | undefined, read: () => Promise<T>): Promise<T> {
  if (signal === undefined) return read();
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      const body = res.body;
      if (body !== null) void body.cancel().catch(() => undefined);
      finish(() => reject(abortReason(signal)));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    read().then(
      (value) => finish(() => resolve(value)),
      (cause) =>
        finish(() => {
          if (signal.aborted) reject(abortReason(signal, cause));
          else reject(cause);
        }),
    );
  });
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

/**
 * `attempts` is set when the status is retryable: the error is then `retryable`
 * and its message counts the attempts spent. Any other status fails on first sight.
 */
async function errorFromResponse(
  provider: string,
  res: Response,
  attempts: number | undefined,
  signal?: AbortSignal,
): Promise<ProviderError> {
  let text = "";
  try {
    text = await readBody(res, signal, () => res.text());
  } catch (cause) {
    if (signal?.aborted) throw abortReason(signal, cause);
  }
  const snippet = text.slice(0, BODY_SNIPPET);
  const requestId = res.headers.get("x-request-id") ?? res.headers.get("x-vercel-id");
  const options: {
    provider: string;
    status: number;
    requestId?: string;
    body?: string;
    retryable: boolean;
  } = { provider, status: res.status, retryable: attempts !== undefined };
  if (requestId) options.requestId = requestId;
  if (snippet !== "") options.body = snippet;
  const tried = attempts === undefined ? "" : ` after ${spent(attempts)}`;
  const body = snippet === "" ? "" : `: ${snippet}`;
  return new ProviderError(`${provider}: HTTP ${res.status}${tried}${body}, ${see(docsFor(res.status, attempts))}`, options);
}

function spent(attempts: number): string {
  return attempts === 1 ? "1 attempt" : `${attempts} attempts`;
}

function docsFor(status: number, attempts: number | undefined): string {
  if (attempts !== undefined) return "docs/providers.md#retries";
  if (status === 401 || status === 403) return "docs/providers.md#keys";
  return "docs/providers.md#errors";
}
