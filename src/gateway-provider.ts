// Gateway: Vercel AI Gateway's evaluation endpoint behind a Provider. The env key is read on first use.

import { gateway as gatewayWire } from "./gateway.js";
import { makeProvider, type Provider } from "./provider.js";
import { ConfigError, see } from "./errors.js";
import { httpModel, type FetchLike, type Wire } from "./wire.js";

const DEFAULT_URL = "https://ai-gateway.vercel.sh/v4/ai/evaluation-model";
const DEFAULT_MODEL = "typesafe-ai/jev";

/**
 * Options for {@link createGateway}. All optional; the defaults are documented in docs/providers.md.
 *
 * @example
 * ```ts
 * import { readFileSync } from "node:fs";
 * import { createGateway } from "huncho/gateway";
 *
 * const gateway = createGateway({ apiKey: readFileSync("/run/secrets/gateway", "utf8").trim(), retries: 2 });
 * ```
 */
export interface GatewayOptions {
  /** Bearer token. When absent, `undefined` or empty, `AI_GATEWAY_API_KEY` is read on first use, so `process.env.MY_KEY` is accepted as written. */
  readonly apiKey?: string | undefined;
  /** Endpoint override. */
  readonly url?: string;
  /** Model id used when the provider is called with no argument. */
  readonly defaultModel?: string;
  /** A `fetch`-compatible function. Tests inject one so no socket is opened. */
  readonly fetch?: FetchLike;
  /** Retry attempts after the first request. Default 4. */
  readonly retries?: number;
  /** Extra request headers, merged under the auth and protocol headers. */
  readonly headers?: Record<string, string>;
}

/**
 * A provider for Jev through Vercel AI Gateway's evaluation endpoint. The key comes from `apiKey`, else from
 * `AI_GATEWAY_API_KEY` the first time the provider is called; nothing is read at import.
 * Use the ready-made {@link gateway} when the defaults are right.
 *
 * @throws `ConfigError` from the returned provider's first call, when no key is found.
 * @example
 * ```ts
 * import { readFileSync } from "node:fs";
 * import { huncho, noul } from "huncho";
 * import { createGateway } from "huncho/gateway";
 *
 * const gateway = createGateway({ apiKey: readFileSync("/run/secrets/gateway", "utf8").trim() });
 * const route = huncho("support.route", { model: gateway() })
 *   .ask({ urgent: noul("Does this need a human within the hour?") })
 *   .else("wait");
 * ```
 */
export function createGateway(options: GatewayOptions = {}): Provider {
  const defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  let wire: Wire | undefined;
  return makeProvider("gateway", defaultModel, (id) => {
    const transport: { fetch?: FetchLike; retries?: number } = {};
    if (options.fetch !== undefined) transport.fetch = options.fetch;
    if (options.retries !== undefined) transport.retries = options.retries;
    return httpModel("gateway", id, resolveWire(), transport);
  });

  function resolveWire(): Wire {
    if (wire !== undefined) return wire;
    const apiKey = present(options.apiKey) ?? env("AI_GATEWAY_API_KEY");
    if (apiKey === undefined) {
      throw new ConfigError(
        `gateway: set AI_GATEWAY_API_KEY or pass apiKey to createGateway, ${see("docs/providers.md#keys")}`,
      );
    }
    wire = gatewayWire({
      provider: "gateway",
      url: options.url ?? DEFAULT_URL,
      apiKey,
      ...(options.headers !== undefined ? { headers: options.headers } : {}),
    });
    return wire;
  }
}

/**
 * Jev through Vercel AI Gateway's evaluation endpoint, with the defaults: `AI_GATEWAY_API_KEY`
 * read on first use, the default URL and model id.
 * `gateway()` is the default model, `gateway("id")` another.
 *
 * @example
 * ```ts
 * import { ask, noul } from "huncho";
 * import { gateway } from "huncho/gateway";
 *
 * const { answers } = await ask(gateway(), "Checkout is down.", { urgent: noul("Does this need a human within the hour?") });
 * answers.urgent.p; // 0.91
 * ```
 */
export const gateway: Provider = createGateway();

function env(name: string): string | undefined {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.[name];
  return present(value);
}

function present(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}
