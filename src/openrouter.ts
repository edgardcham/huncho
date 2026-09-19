/**
 * OpenRouter: Decisions endpoint behind a Provider. The env key is read on first use.
 *
 * @module huncho/openrouter
 */

import { makeProvider, type Provider } from "./provider.js";
import { systemone } from "./systemone.js";
import { ConfigError, see } from "./errors.js";
import { httpModel, type FetchLike, type Wire } from "./wire.js";

const DEFAULT_URL = "https://openrouter.ai/api/alpha/decisions";
const DEFAULT_MODEL = "~typesafe/jev-latest";

/**
 * Options for {@link createOpenRouter}. All optional; the defaults are documented in docs/providers.md.
 *
 * @example
 * ```ts
 * import { readFileSync } from "node:fs";
 * import { createOpenRouter } from "huncho/openrouter";
 *
 * const openrouter = createOpenRouter({ apiKey: readFileSync("/run/secrets/openrouter", "utf8").trim(), retries: 2 });
 * ```
 */
export interface OpenRouterOptions {
  /** Bearer token. When absent, `undefined` or empty, `OPENROUTER_API_KEY` is read on first use, so `process.env.MY_KEY` is accepted as written. */
  readonly apiKey?: string | undefined;
  /** Endpoint override. */
  readonly url?: string;
  /** Model id used when the provider is called with no argument. */
  readonly defaultModel?: string;
  /** A `fetch`-compatible function. Tests inject one so no socket is opened. */
  readonly fetch?: FetchLike;
  /** Retry attempts after the first request. Default 4. */
  readonly retries?: number;
  /** Sent as `HTTP-Referer`, for OpenRouter's attribution. */
  readonly referer?: string;
  /** Sent as `X-Title`, for OpenRouter's attribution. */
  readonly title?: string;
}

/**
 * A provider for Jev through OpenRouter's Decisions endpoint. The key comes from `apiKey`, else from
 * `OPENROUTER_API_KEY` the first time the provider is called; nothing is read at import.
 * Use the ready-made {@link openrouter} when the defaults are right.
 *
 * @throws `ConfigError` from the returned provider's first call, when no key is found.
 * @example
 * ```ts
 * import { readFileSync } from "node:fs";
 * import { huncho, noul } from "huncho";
 * import { createOpenRouter } from "huncho/openrouter";
 *
 * const openrouter = createOpenRouter({ apiKey: readFileSync("/run/secrets/openrouter", "utf8").trim() });
 * const route = huncho("support.route", { model: openrouter() })
 *   .ask({ urgent: noul("Does this need a human within the hour?") })
 *   .else("wait");
 * ```
 */
export function createOpenRouter(options: OpenRouterOptions = {}): Provider {
  const defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  let wire: Wire | undefined;
  return makeProvider("openrouter", defaultModel, (id) => {
    const transport: { fetch?: FetchLike; retries?: number } = {};
    if (options.fetch !== undefined) transport.fetch = options.fetch;
    if (options.retries !== undefined) transport.retries = options.retries;
    return httpModel("openrouter", id, resolveWire(), transport);
  });

  function resolveWire(): Wire {
    if (wire !== undefined) return wire;
    const apiKey = present(options.apiKey) ?? env("OPENROUTER_API_KEY");
    if (apiKey === undefined) {
      throw new ConfigError(
        `openrouter: set OPENROUTER_API_KEY or pass apiKey to createOpenRouter, ${see("docs/providers.md#keys")}`,
      );
    }
    const headers = attribution(options);
    wire = systemone({
      provider: "openrouter",
      url: options.url ?? DEFAULT_URL,
      apiKey,
      ...(headers !== undefined ? { headers } : {}),
    });
    return wire;
  }
}

/**
 * Jev through OpenRouter's Decisions endpoint, with the defaults: `OPENROUTER_API_KEY` read on
 * first use, the default URL and model id.
 * `openrouter()` is the default model, `openrouter("id")` another.
 *
 * @example
 * ```ts
 * import { ask, noul } from "huncho";
 * import { openrouter } from "huncho/openrouter";
 *
 * const { answers } = await ask(openrouter(), "Checkout is down.", { urgent: noul("Does this need a human within the hour?") });
 * answers.urgent.p; // 0.91
 * ```
 */
export const openrouter: Provider = createOpenRouter();

function attribution(options: OpenRouterOptions): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  const referer = present(options.referer);
  const title = present(options.title);
  if (referer !== undefined) headers["HTTP-Referer"] = referer;
  if (title !== undefined) headers["X-Title"] = title;
  return Object.keys(headers).length === 0 ? undefined : headers;
}

function env(name: string): string | undefined {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.[name];
  return present(value);
}

function present(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}
