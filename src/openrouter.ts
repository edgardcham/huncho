// OpenRouter: Decisions endpoint behind a Provider. The env key is read on first use.

import { makeProvider, type Provider } from "./provider.js";
import { systemone } from "./systemone.js";
import { ConfigError, see } from "./errors.js";
import { httpModel, type FetchLike, type Wire } from "./wire.js";

const DEFAULT_URL = "https://openrouter.ai/api/alpha/decisions";
const DEFAULT_MODEL = "~typesafe/jev-latest";

export interface OpenRouterOptions {
  readonly apiKey?: string;
  readonly url?: string;
  readonly defaultModel?: string;
  readonly fetch?: FetchLike;
  readonly retries?: number;
  readonly referer?: string;
  readonly title?: string;
}

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

/** Lazily configured from `OPENROUTER_API_KEY` on first use. */
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
