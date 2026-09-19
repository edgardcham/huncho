---
title: Providers
description: "The Model seam and the providers behind it: entries, defaults, options, keys, retries, errors, custom providers and the scripted model for tests."
---

A provider is a callable factory: `provider()` returns a `Model` for the default model id, `provider("some-id")` for another. A `Model` has one method, `evaluate({ state, questions, signal? })`, and behind it live HTTP, auth, retries and the vendor's dialect. Nothing above the Model seam knows which provider answered; swap one for another and the rest of the program is unchanged.

```ts
import { huncho } from "huncho";
import { jev } from "huncho/jev";
import { openrouter } from "huncho/openrouter";
import { gateway } from "huncho/gateway";

huncho("support.route", { model: jev() });
huncho("support.route", { model: openrouter() });
huncho("support.route", { model: gateway("typesafe-ai/jev") });
```

Each provider is its own entry, so the import line names the vendor a file depends on. The root entry re-exports all of them; `import { jev } from "huncho"` is the same object.

## Built in

| Provider | Entry | Factory | Ready-made instance | Key from | Default URL | Default model id |
| --- | --- | --- | --- | --- | --- | --- |
| [TypeSafe Jev](providers/jev.md) | `huncho/jev` | `createJev(options)` | `jev` | `TYPESAFE_API_KEY` | `https://api.typesafe.ai/v1/systemone` | `jev-latest` |
| [OpenRouter](providers/openrouter.md) | `huncho/openrouter` | `createOpenRouter(options)` | `openrouter` | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/alpha/decisions` | `~typesafe/jev-latest` |
| [Vercel AI Gateway](providers/gateway.md) | `huncho/gateway` | `createGateway(options)` | `gateway` | `AI_GATEWAY_API_KEY` | `https://ai-gateway.vercel.sh/v4/ai/evaluation-model` | `typesafe-ai/jev` |

`jev` and `openrouter` speak the `systemone` wire. `gateway` speaks the Vercel AI Gateway evaluation wire, where the model id travels in the `Ai-Model-Id` header rather than the body. The dialects are specified by fixtures; see [wires.md](wires.md).

### Options

Every factory takes the same core options:

| Option | Meaning |
| --- | --- |
| `apiKey` | Bearer token. When absent, `undefined` or empty, the environment variable in the table above is read instead. The variable name is a default, not a requirement: read the key from any variable, file or secrets manager you like and pass it here. |
| `url` | Endpoint override. OpenRouter's Decisions path is in alpha and may move. |
| `defaultModel` | Model id used when the provider is called with no argument. |
| `fetch` | A `fetch`-compatible function. Tests inject one; unit tests never open a socket. |
| `retries` | Retry attempts after the first request. Default `4`. |

`createJev` and `createGateway` also take `headers`, extra request headers merged under the auth header. `createOpenRouter` takes `referer` and `title`, sent as `HTTP-Referer` and `X-Title` for attribution. Each provider's page has its own options in full.

### Keys

Importing an entry reads nothing from the environment. The key is resolved the first time the provider is called (`jev()`), from `apiKey` if present, otherwise from the environment variable. A missing key throws at that point, a `ConfigError` whose message names the variable and the factory: `jev: set TYPESAFE_API_KEY or pass apiKey to createJev`. An empty string counts as missing.

A key the vendor rejects is a `ProviderError` with `status` `401` or `403` and `retryable: false`; the message points back here.

During development, keep keys in a `.env.local` and start Node with `--env-file=.env.local`. In this repo the file is gitignored and `npm test` loads it.

### Retries

Transport is shared by every HTTP provider. It retries on `408`, `429`, `500`, `502`, `503` and `529` with exponential backoff from 400 ms, doubling, capped at 8 s. Any other status fails on first sight. A thrown `fetch` (network failure) is retried like a retryable status. The default is `4` retries, five attempts in all; `retries` on every factory changes it.

Once retries are spent, the last failure is thrown as a `ProviderError` with `retryable: true` and a message that counts the attempts: `jev: HTTP 429 after 5 attempts: …`. Nothing inside huncho retries beyond that; a queue or a scheduler above it may, and `retryable` is the field to read.

## Errors

Everything huncho throws is a `HunchoError`. The class says which layer failed, the message names the fix, and every message ends with a pointer into these docs.

| Class | Thrown when | What to do |
| --- | --- | --- |
| `ConfigError` | huncho was set up wrong and nothing was sent to a model: a missing or empty key, thresholds that are not finite or have `exit` above `enter`, `.decide()` before `.ask()`, `.shape()` after `.branch()`, a question id asked twice in one request, a `score()` with one level, a bad `calibrate()` or `weighted()` argument, an empty `scriptedModel` script. | Change the code; the message says how. |
| `ProviderError` | A model failed to answer: a non-2xx status, a network failure once retries are spent, or a 2xx body that is not JSON or does not decode into answers for the questions asked. | Read `retryable`. `true`: the same request may succeed later. `false`: it will not until something changes, usually the key, the request or the endpoint. |
| `PolicyError` | No clause matched and the policy has no `else`. The message names the huncho. | Add `.else(outcome)` or a clause that covers the case; see [policy.md](policy.md#clauses). |
| `AnswerError` | A question the huncho asks has no answer, or an answer of the wrong shape. The message names the question. | From `decide`, `evaluate` or `ask`: the model did not answer every question in the canonical shape, which only a custom provider or a scripted model can do. From `replay`: the journal predates the question; replay only the records that carry it. |

Narrow with the static guard, not `instanceof`:

```ts
import { ConfigError, ProviderError } from "huncho";

try {
  await route.decide(ticket);
} catch (e) {
  if (ConfigError.isInstance(e)) throw e;
  if (ProviderError.isInstance(e) && e.retryable) return later(ticket);
  throw e;
}
```

`isInstance` narrows the type with no cast. It reads a registered symbol brand rather than comparing class identity, so it also holds across bundles and duplicated copies of the package, where `instanceof` fails. `HunchoError.isInstance` is true for every class in the table.

`ProviderError` carries:

| Field | Meaning |
| --- | --- |
| `provider` | Which provider failed. |
| `retryable` | `true` for a retryable status or a network failure once retries are spent. `false` for any other status and for a body that does not decode. |
| `status` | HTTP status, when the vendor answered. |
| `requestId` | From `x-request-id` (`systemone`) or `x-vercel-id` (`gateway`), when present. |
| `body` | First 300 characters of the response body. |
| `cause` | The underlying error, when there was one. |

Abort is the exception. Pass `signal` to `evaluate` or `decide` and, when it fires, the promise rejects with `signal.reason` (an `AbortError` by default), not a `HunchoError`. Abort cancels both an in-flight request and a backoff sleep.

## Custom provider

`createProvider` wraps any in-process or remote evaluator as a provider, with no wire and no transport:

```ts
import { createProvider, type RawAnswer } from "huncho";

const local = createProvider({
  name: "local",
  defaultModel: "rules-v1",
  evaluate: async ({ model, state, questions, signal }) => {
    const answers: Record<string, RawAnswer> = {};
    for (const [id, question] of Object.entries(questions)) {
      if (question.type === "noul") answers[id] = { type: "noul", noul: 0.5 };
    }
    return { answers };
  },
});

const model = local();
```

`evaluate` receives `{ model, state, questions, signal? }` and returns `{ answers, usage?, requestId? }`. `answers` must be canonical raw answers keyed exactly by question id: `{ type: "noul", noul }`, `{ type: "choice", choice, probabilities, confidence }` or `{ type: "score", score, probabilities, confidence, legend? }`. The wrapper adds `provider`, `model` and `ms`, defaults `usage` to zero tokens, and turns anything thrown into a `ProviderError` with `retryable: false` carrying the original as `cause`. Any `HunchoError` thrown inside `evaluate` passes through untouched; the check is `HunchoError.isInstance`, so one thrown by another copy of the package counts. When `signal` has fired, the rejection is `signal.reason`, whatever `evaluate` threw.

## Scripted model for tests

`huncho/testing` exports `scriptedModel`, so code that uses huncho can be tested without a network:

```ts
import { scriptedModel } from "huncho/testing";

const { model, requests } = scriptedModel([
  { answers: { urgent: { type: "noul", noul: 0.9 } } },
  { answers: { urgent: { type: "noul", noul: 0.3 } } },
]);
```

Each call consumes the next entry; after the last one, it repeats. `requests` records every `EvaluateRequest` in order, so a test can assert what the model was asked. The script must have at least one entry.

## Adding a vendor

A vendor is one wire file plus a directory of fixtures; nothing above the Model seam changes. [Adding a vendor](providers/adding-a-vendor.md) is the recipe, step by step.
