# Wire fixtures

Vendor dialects are specified by data, not by code. A port in another language must pass the same files: same request, same expected request, same response, same decoded answers.

This file is the language-neutral contract. The TypeScript runner lives in `test/wires.test.ts` and only crosses the Wire seam: `url`, `headers`, `encode`, `decode`. It never opens a network connection.

## Layout

`fixtures/wires/<wire>/<case>.json`:

```json
{
  "model": "...",
  "request": { "state": "...", "questions": {} },
  "expect": { "url": "...", "headers": {}, "body": {} },
  "response": { "status": 200, "headers": {}, "json": {} },
  "decoded": { "answers": {}, "usage": { "inputTokens": 0, "outputTokens": 0 } }
}
```

| Field | Meaning |
| --- | --- |
| `model` | Model id passed to `url`, `headers` and `encode`. |
| `request` | Canonical evaluate request: `state` and `questions` keyed by question id. Question types are `noul`, `choice` and `score`. |
| `expect.url` | Exact `url(model)`. |
| `expect.headers` | Exact `headers(model)`. Header names are as the dialect sends them. |
| `expect.body` | Exact `encode(request, model)` body. |
| `response.status` | HTTP status the vendor returned. The runner does not feed this to `decode`; Transport rejects non-success before a wire sees the body. |
| `response.headers` | Response headers passed to `decode`. Names are lowercase where the dialect reads them (`x-request-id`, `x-vercel-id`). |
| `response.json` | Parsed JSON body passed to `decode`. |
| `decoded` | Exact `decode(json, headers, request)`: canonical `answers`, `usage` as `{ inputTokens, outputTokens }`, and `requestId` when the dialect exposes one. |

Unknown fields must be ignored by a runner. Missing required fields fail the case.

## Runner

For every directory under `fixtures/wires/` and every `*.json` in it:

1. Build the named wire with the constructor below.
2. Assert `url(model)`, `headers(model)` and `encode(request, model)` deep-equal `expect`.
3. Assert `decode(response.json, response.headers, request)` deep-equals `decoded`.

A wire with no fixture directory, or a fixture directory with no cases, fails CI. Adding a vendor is one adapter file plus a directory of these files.

## Constructors this repo uses

The fixtures lock URL, auth and extra headers. A port must build the same wire so `expect` matches.

| Directory | Wire | Constructor |
| --- | --- | --- |
| `systemone` | systemone | URL `https://api.typesafe.ai/v1/systemone`, bearer key `test-key`. |
| `gateway` | gateway | URL `https://ai-gateway.vercel.sh/v4/ai/evaluation-model`, bearer key `test-key`. The model travels in `Ai-Model-Id`, not the body. |
| `openrouter` | systemone | URL `https://openrouter.ai/api/alpha/decisions`, bearer key `test-key`, `HTTP-Referer: https://example.test`, `X-Title: huncho`. Same body dialect as `systemone`. |

## Cases

**systemone.** Three question types, snake_case usage mapped to `inputTokens` / `outputTokens`, request id from `x-request-id`.

**gateway.** `noul` questions sent as `boolean` and decoded back to `noul`; confidence from `providerMetadata.typesafe.confidence`; fallback confidence (top minus second probability) when metadata is missing; model in `Ai-Model-Id`.

**openrouter.** Tilde model id on the Decisions URL; attribution headers present; same encode and decode as systemone.
