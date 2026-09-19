// Internal seam: vendor dialect. Transport posts; a wire encodes and decodes.
// An HTTP Model is any Wire plus Transport.

import { postJson } from "./transport.js";
import type { EvaluateRequest, EvaluateResult, Model, RawAnswer, Usage } from "./types.js";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface Wire {
  url(model: string): string;
  headers(model: string): Record<string, string>;
  encode(req: EvaluateRequest, model: string): unknown;
  decode(
    json: unknown,
    headers: Headers,
    req: EvaluateRequest,
  ): { answers: Record<string, RawAnswer>; usage: Usage; requestId?: string };
}

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
