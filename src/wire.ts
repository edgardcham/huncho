// Internal seam: vendor dialect. Transport posts; a wire encodes and decodes.
// An HTTP Model is any Wire plus Transport.

import { postJson } from "./transport.js";
import type { EvaluateRequest, EvaluateResult, Model, RawAnswer, Usage } from "./types.js";

/** The subset of `fetch` transport needs. Pass one to a provider factory to intercept requests in tests. */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** A vendor dialect: where to post, what to send, how to read the reply. Internal seam; one adapter per wire. */
export interface Wire {
  /** Endpoint for this model id. */
  url(model: string): string;
  /** Request headers, auth included. */
  headers(model: string): Record<string, string>;
  /** The request body in the vendor's shape. */
  encode(req: EvaluateRequest, model: string): unknown;
  /**
   * Canonical answers from the vendor's reply.
   *
   * @throws `ProviderError` when the body does not decode.
   */
  decode(
    json: unknown,
    headers: Headers,
    req: EvaluateRequest,
  ): { answers: Record<string, RawAnswer>; usage: Usage; requestId?: string };
}

/** A `Model` from a wire and transport. Internal: the provider factories call this. */
export function httpModel(
  provider: string,
  id: string,
  wire: Wire,
  options: { fetch?: FetchLike; retries?: number } = {},
): Model {
  return {
    provider,
    id,
    async evaluate(req: EvaluateRequest): Promise<EvaluateResult> {
      const postOptions: { fetch?: FetchLike; retries?: number; signal?: AbortSignal } = {};
      if (options.fetch !== undefined) postOptions.fetch = options.fetch;
      if (options.retries !== undefined) postOptions.retries = options.retries;
      if (req.signal !== undefined) postOptions.signal = req.signal;

      const { json, headers, ms } = await postJson(
        provider,
        wire.url(id),
        wire.headers(id),
        wire.encode(req, id),
        postOptions,
      );
      const decoded = wire.decode(json, headers, req);
      return {
        provider,
        model: id,
        answers: decoded.answers,
        usage: decoded.usage,
        ms,
        ...(decoded.requestId !== undefined ? { requestId: decoded.requestId } : {}),
      };
    },
  };
}
