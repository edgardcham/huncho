// systemone wire: { model, state, questions } in, snake_case usage out.
// TypeSafe and OpenRouter Decisions share this dialect.

import { ProviderError, see } from "./errors.js";
import type { EvaluateRequest, Question, RawAnswer, Usage } from "./types.js";
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
    decode: (json, headers, req) => decode(options.provider, json, headers, req),
  };
}

function decode(
  provider: string,
  json: unknown,
  headers: Headers,
  req: EvaluateRequest,
): { answers: Record<string, RawAnswer>; usage: Usage; requestId?: string } {
  if (!isRecord(json) || !isRecord(json.answers)) {
    throw protocolError(provider, "response has no answers", json);
  }
  const answers = readAnswers(provider, json.answers, req);
  const usageRaw = isRecord(json.usage) ? json.usage : {};
  const decoded: { answers: Record<string, RawAnswer>; usage: Usage; requestId?: string } = {
    answers,
    usage: {
      inputTokens: finiteNumber(usageRaw.input_tokens),
      outputTokens: finiteNumber(usageRaw.output_tokens),
    },
  };
  const requestId = headers.get("x-request-id");
  if (requestId) decoded.requestId = requestId;
  return decoded;
}

function readAnswers(
  provider: string,
  raw: Record<string, unknown>,
  req: EvaluateRequest,
): Record<string, RawAnswer> {
  const keys = Object.keys(req.questions);
  const got = Object.keys(raw);
  if (keys.length !== got.length || keys.some((key) => !Object.hasOwn(raw, key))) {
    throw protocolError(provider, "response answers do not match questions", raw);
  }
  const answers: Record<string, RawAnswer> = {};
  for (const key of keys) {
    const question = req.questions[key];
    const value = raw[key];
    if (question === undefined || !isAnswer(question, value)) {
      throw protocolError(provider, "response answers do not match questions", raw);
    }
    answers[key] = value;
  }
  return answers;
}

function isAnswer(question: Question, value: unknown): value is RawAnswer {
  if (!isRecord(value) || value.type !== question.type) return false;
  if (question.type === "noul") return typeof value.noul === "number" && Number.isFinite(value.noul);
  if (question.type === "choice") {
    return (
      typeof value.choice === "string" &&
      isRecord(value.probabilities) &&
      typeof value.confidence === "number" &&
      Number.isFinite(value.confidence)
    );
  }
  return (
    typeof value.score === "number" &&
    Number.isFinite(value.score) &&
    isRecord(value.probabilities) &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence)
  );
}

function protocolError(provider: string, message: string, json: unknown): ProviderError {
  const body = snippet(json);
  return new ProviderError(`${provider}: ${message}, ${see("docs/providers.md#errors")}`, {
    provider,
    retryable: false,
    ...(body !== undefined ? { body } : {}),
  });
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
