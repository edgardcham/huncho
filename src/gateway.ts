// gateway wire: { state, questions } in; the model travels in Ai-Model-Id.
// noul questions are sent as boolean; confidence lives in providerMetadata.

import { ProviderError, see } from "./errors.js";
import type {
  Content,
  EvaluateRequest,
  Question,
  Questions,
  RawAnswer,
  ScoreQuestion,
  Usage,
} from "./types.js";
import type { Wire } from "./wire.js";

/** The Vercel AI Gateway evaluation wire: model id in a header, `noul` as `boolean`, confidence in provider metadata. */
export function gateway(options: {
  provider: string;
  url: string;
  apiKey: string;
  headers?: Record<string, string>;
}): Wire {
  return {
    url: () => options.url,
    headers: (model) => ({
      ...(options.headers ?? {}),
      Authorization: `Bearer ${options.apiKey}`,
      "Ai-Gateway-Protocol-Version": "0.0.1",
      "Ai-Gateway-Auth-Method": "api-key",
      "Ai-Evaluation-Model-Specification-Version": "4",
      "Ai-Model-Id": model,
    }),
    encode: (req) => ({
      state: req.state,
      questions: encodeQuestions(req.questions),
    }),
    decode: (json, headers, req) => decode(options.provider, json, headers, req),
  };
}

function encodeQuestions(questions: Questions): Record<string, unknown> {
  const encoded: Record<string, unknown> = {};
  for (const [key, question] of Object.entries(questions)) {
    encoded[key] = question.type === "noul" ? { ...question, type: "boolean" } : question;
  }
  return encoded;
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
  const confidence = readConfidence(json);
  const answers = readAnswers(provider, json.answers, confidence, req);
  const usageRaw = isRecord(json.usage) ? json.usage : {};
  const decoded: { answers: Record<string, RawAnswer>; usage: Usage; requestId?: string } = {
    answers,
    usage: {
      inputTokens: finiteNumber(usageRaw.inputTokens),
      outputTokens: finiteNumber(usageRaw.outputTokens),
    },
  };
  const requestId = headers.get("x-vercel-id");
  if (requestId) decoded.requestId = requestId;
  return decoded;
}

function readConfidence(json: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(json.providerMetadata)) return {};
  if (!isRecord(json.providerMetadata.typesafe)) return {};
  const confidence = json.providerMetadata.typesafe.confidence;
  return isRecord(confidence) ? confidence : {};
}

function readAnswers(
  provider: string,
  raw: Record<string, unknown>,
  confidence: Record<string, unknown>,
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
    if (question === undefined || !isRecord(value)) {
      throw protocolError(provider, "response answers do not match questions", raw);
    }
    answers[key] = decodeAnswer(provider, question, value, confidence[key], raw);
  }
  return answers;
}

function decodeAnswer(
  provider: string,
  question: Question,
  value: Record<string, unknown>,
  confidence: unknown,
  raw: Record<string, unknown>,
): RawAnswer {
  if (question.type === "noul") {
    if (value.type !== "boolean" || !isFiniteNumber(value.probability)) {
      throw protocolError(provider, "response answers do not match questions", raw);
    }
    return { type: "noul", noul: value.probability };
  }
  if (question.type === "choice") {
    if (value.type !== "choice" || typeof value.choice !== "string" || !isRecord(value.probabilities)) {
      throw protocolError(provider, "response answers do not match questions", raw);
    }
    const labels = Object.keys(question.criteria);
    const probabilities = numberRecord(value.probabilities);
    if (
      probabilities === undefined ||
      !sameKeys(probabilities, labels) ||
      !Object.hasOwn(question.criteria, value.choice)
    ) {
      throw protocolError(provider, "response answers do not match questions", raw);
    }
    return {
      type: "choice",
      choice: value.choice,
      probabilities,
      confidence: resolveConfidence(confidence, probabilities),
    };
  }
  if (value.type !== "score" || !isFiniteNumber(value.score) || !isRecord(value.probabilities)) {
    throw protocolError(provider, "response answers do not match questions", raw);
  }
  const last = question.criteria.length - 1;
  const rungs = question.criteria.map((_, index) => String(index));
  const probabilities = numberRecord(value.probabilities);
  if (
    probabilities === undefined ||
    !sameKeys(probabilities, rungs) ||
    value.score < 0 ||
    value.score > last
  ) {
    throw protocolError(provider, "response answers do not match questions", raw);
  }
  return {
    type: "score",
    score: value.score,
    probabilities,
    confidence: resolveConfidence(confidence, probabilities),
    legend: legendFrom(question),
  };
}

function resolveConfidence(confidence: unknown, probabilities: Record<string, number>): number {
  if (typeof confidence === "number" && Number.isFinite(confidence)) return confidence;
  return fallbackConfidence(probabilities);
}

function fallbackConfidence(probabilities: Record<string, number>): number {
  const ranked = Object.values(probabilities).sort((a, b) => b - a);
  const top = ranked[0] ?? 0;
  const next = ranked[1] ?? 0;
  const gap = top - next;
  return gap < 0 ? 0 : gap > 1 ? 1 : gap;
}

function legendFrom(question: ScoreQuestion): Record<string, string> {
  const legend: Record<string, string> = {};
  question.criteria.forEach((level, index) => {
    legend[String(index)] = asLegend(level);
  });
  return legend;
}

function asLegend(level: Content): string {
  return typeof level === "string" ? level : JSON.stringify(level);
}

function sameKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const got = Object.keys(record);
  return got.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

function numberRecord(value: Record<string, unknown>): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isFiniteNumber(item)) return undefined;
    out[key] = item;
  }
  return out;
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteNumber(value: unknown): number {
  return isFiniteNumber(value) ? value : 0;
}

function snippet(json: unknown): string | undefined {
  try {
    const text = JSON.stringify(json);
    return text === undefined ? undefined : text.slice(0, 300);
  } catch {
    return undefined;
  }
}
