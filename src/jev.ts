// Jev: TypeSafe's endpoint behind a Provider. The env key is read on first use.

import { makeProvider, type Provider } from "./provider.js";
import { systemone } from "./systemone.js";
import { ConfigError, see } from "./errors.js";
import { httpModel, type FetchLike, type Wire } from "./wire.js";

const DEFAULT_URL = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-latest";

export interface JevOptions {
  readonly apiKey?: string;
  readonly url?: string;
  readonly defaultModel?: string;
  readonly fetch?: FetchLike;
  readonly retries?: number;
  readonly headers?: Record<string, string>;
}

export function createJev(options: JevOptions = {}): Provider {
  const defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  let wire: Wire | undefined;
  return makeProvider("jev", defaultModel, (id) => {
    const transport: { fetch?: FetchLike; retries?: number } = {};
    if (options.fetch !== undefined) transport.fetch = options.fetch;
    if (options.retries !== undefined) transport.retries = options.retries;
    return httpModel("jev", id, resolveWire(), transport);
  });

  function resolveWire(): Wire {
    if (wire !== undefined) return wire;
    const apiKey = present(options.apiKey) ?? env("TYPESAFE_API_KEY");
    if (apiKey === undefined) {
      throw new ConfigError(`jev: set TYPESAFE_API_KEY or pass apiKey to createJev, ${see("docs/providers.md#keys")}`);
    }
    wire = systemone({
      provider: "jev",
      url: options.url ?? DEFAULT_URL,
      apiKey,
      ...(options.headers !== undefined ? { headers: options.headers } : {}),
    });
    return wire;
  }
}

/** Lazily configured from `TYPESAFE_API_KEY` on first use. */
export const jev: Provider = createJev();

function env(name: string): string | undefined {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.[name];
  return present(value);
}

function present(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}
