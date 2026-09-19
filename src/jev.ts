// Jev: TypeSafe's endpoint behind a Provider. The env key is read on first use.

import { makeProvider, type Provider } from "./provider.js";
import { systemone } from "./systemone.js";
import { ConfigError, see } from "./errors.js";
import { httpModel, type FetchLike, type Wire } from "./wire.js";

const DEFAULT_URL = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-latest";

/**
 * Options for {@link createJev}. All optional; the defaults are documented in docs/providers.md.
 *
 * @example
 * ```ts
 * import { readFileSync } from "node:fs";
 * import { createJev } from "huncho/jev";
 *
 * const jev = createJev({ apiKey: readFileSync("/run/secrets/jev", "utf8").trim(), retries: 2 });
 * ```
 */
export interface JevOptions {
  /** Bearer token. When absent or empty, `TYPESAFE_API_KEY` is read on first use. */
  readonly apiKey?: string;
  /** Endpoint override. */
  readonly url?: string;
  /** Model id used when the provider is called with no argument. */
  readonly defaultModel?: string;
  /** A `fetch`-compatible function. Tests inject one so no socket is opened. */
  readonly fetch?: FetchLike;
  /** Retry attempts after the first request. Default 4. */
  readonly retries?: number;
  /** Extra request headers, merged under the auth header. */
  readonly headers?: Record<string, string>;
}

/**
 * A provider for TypeSafe Jev, called directly. The key comes from `apiKey`, else from
 * `TYPESAFE_API_KEY` the first time the provider is called; nothing is read at import.
 * Use the ready-made {@link jev} when the defaults are right.
 *
 * @throws `ConfigError` from the returned provider's first call, when no key is found.
 * @example
 * ```ts
 * import { readFileSync } from "node:fs";
 * import { huncho, noul } from "huncho";
 * import { createJev } from "huncho/jev";
 *
 * const jev = createJev({ apiKey: readFileSync("/run/secrets/jev", "utf8").trim() });
 * const route = huncho("support.route", { model: jev() })
 *   .ask({ urgent: noul("Does this need a human within the hour?") })
 *   .else("wait");
 * ```
 */
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

/**
 * TypeSafe Jev, called directly, with the defaults: `TYPESAFE_API_KEY` read on first use, the
 * default URL and model id.
 * `jev()` is the default model, `jev("id")` another.
 *
 * @example
 * ```ts
 * import { ask, noul } from "huncho";
 * import { jev } from "huncho/jev";
 *
 * const { answers } = await ask(jev(), "Checkout is down.", { urgent: noul("Does this need a human within the hour?") });
 * answers.urgent.p; // 0.91
 * ```
 */
export const jev: Provider = createJev();

function env(name: string): string | undefined {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.[name];
  return present(value);
}

function present(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}
