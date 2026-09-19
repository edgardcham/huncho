// systemone wire: { model, state, questions } in, snake_case usage out.
// TypeSafe and OpenRouter Decisions share this dialect.

import { HunchoError } from "./types.js";
import type { RawAnswer, Usage } from "./types.js";
import type { Wire } from "./wire.js";

export function systemone(options: {
  provider: string;
  url: string;
  apiKey: string;
  headers?: Record<string, string>;
}): Wire {
  return {
    url: () => options.url,
    headers: () => ({
      ...(options.headers ?? {}),
      Authorization: `Bearer ${options.apiKey}`,
    }),
    encode: (req, model) => ({
      model,
      state: req.state,
      questions: req.questions,
    }),
    decode: (json, headers) => decode(options.provider, json, headers),
  };
}

function decode(
  provider: string,
  json: unknown,
  headers: Headers,
): { answers: Record<string, RawAnswer>; usage: Usage; requestId?: string } {
  if (!isRecord(json) || !isRecord(json.answers)) {
    const body = snippet(json);
    throw new HunchoError(`${provider}: response has no answers`, {
      provider,
      ...(body !== undefined ? { body } : {}),
    });
  }
  const usageRaw = isRecord(json.usage) ? json.usage : {};
  const decoded: { answers: Record<string, RawAnswer>; usage: Usage; requestId?: string } = {
    answers: json.answers as Record<string, RawAnswer>,
    usage: {
      inputTokens: finiteNumber(usageRaw.input_tokens),
      outputTokens: finiteNumber(usageRaw.output_tokens),
    },
  };
  const requestId = headers.get("x-request-id");
  if (requestId) decoded.requestId = requestId;
  return decoded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function snippet(json: unknown): string | undefined {
  try {
    const text = JSON.stringify(json);
    return text === undefined ? undefined : text.slice(0, 300);
  } catch {
    return undefined;
  }
}
