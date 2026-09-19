// Gateway: Vercel AI Gateway's evaluation endpoint behind a Provider. The env key is read on first use.

import { gateway as gatewayWire } from "./gateway.js";
import { makeProvider, type Provider } from "./provider.js";
import { HunchoError } from "./types.js";
import { httpModel, type FetchLike, type Wire } from "./wire.js";

const DEFAULT_URL = "https://ai-gateway.vercel.sh/v4/ai/evaluation-model";
const DEFAULT_MODEL = "typesafe-ai/jev";

export interface GatewayOptions {
  readonly apiKey?: string;
  readonly url?: string;
  readonly defaultModel?: string;
  readonly fetch?: FetchLike;
  readonly retries?: number;
  readonly headers?: Record<string, string>;
}

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
      throw new HunchoError("gateway: set AI_GATEWAY_API_KEY or pass apiKey", { provider: "gateway" });
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

/** Lazily configured from `AI_GATEWAY_API_KEY` on first use. */
export const gateway: Provider = createGateway();

function env(name: string): string | undefined {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.[name];
  return present(value);
}

function present(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}
