# Providers

A provider is a callable factory: `provider()` returns a `Model` for the default model id, `provider("some-id")` for another. A `Model` has one method, `evaluate({ state, questions, signal? })`, and behind it live HTTP, auth, retries and the vendor's dialect. Nothing above the Model seam knows which provider answered; swap one for another and the rest of the program is unchanged.

```ts
import { huncho, jev, openrouter, gateway } from "huncho";

huncho("support.route", { model: jev() });
huncho("support.route", { model: openrouter() });
huncho("support.route", { model: gateway("typesafe-ai/jev") });
```

## Built in

| Provider | Factory | Ready-made instance | Key from | Default URL | Default model id |
| --- | --- | --- | --- | --- | --- |
| `jev` | `createJev(options)` | `jev` | `TYPESAFE_API_KEY` | `https://api.typesafe.ai/v1/systemone` | `jev-latest` |
| `openrouter` | `createOpenRouter(options)` | `openrouter` | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/alpha/decisions` | `~typesafe/jev-latest` |
| `gateway` | `createGateway(options)` | `gateway` | `AI_GATEWAY_API_KEY` | `https://ai-gateway.vercel.sh/v4/ai/evaluation-model` | `typesafe-ai/jev` |

`jev` and `openrouter` speak the `systemone` wire. `gateway` speaks the Vercel AI Gateway evaluation wire, where the model id travels in the `Ai-Model-Id` header rather than the body. The dialects are specified by fixtures; see [wires.md](wires.md).

### Options

Every factory takes the same core options:

| Option | Meaning |
| --- | --- |
| `apiKey` | Bearer token. When absent or empty, the environment variable in the table above is read instead. The variable name is a default, not a requirement: read the key from any variable, file or secrets manager you like and pass it here. |
| `url` | Endpoint override. OpenRouter's Decisions path is in alpha and may move. |
| `defaultModel` | Model id used when the provider is called with no argument. |
| `fetch` | A `fetch`-compatible function. Tests inject one; unit tests never open a socket. |
| `retries` | Retry attempts after the first request. Default `4`. |

`createJev` and `createGateway` also take `headers`, extra request headers merged under the auth header. `createOpenRouter` takes `referer` and `title`, sent as `HTTP-Referer` and `X-Title` for attribution.

### When the key is read

Importing `huncho` reads nothing from the environment. The key is resolved the first time the provider is called (`jev()`), from `apiKey` if present, otherwise from the environment variable. A missing key throws at that point, a `HunchoError` whose message names the variable: `jev: set TYPESAFE_API_KEY or pass apiKey`. An empty string counts as missing.

Put keys in `.env.local` at the repo root during development; it is gitignored and `npm test` loads it.

### Retries and errors

Transport is shared by every HTTP provider. It retries on `408`, `429`, `500`, `502`, `503` and `529` with exponential backoff from 400 ms, doubling, capped at 8 s. Any other `4xx` fails immediately. A thrown `fetch` (network failure) is retried like a retryable status.

Every failure rejects with `HunchoError`:

| Field | Meaning |
| --- | --- |
| `provider` | Which provider failed. |
| `status` | HTTP status, when the vendor answered. |
| `requestId` | From `x-request-id` (`systemone`) or `x-vercel-id` (`gateway`), when present. |
| `body` | First 300 characters of the response body. |
| `cause` | The underlying error, when there was one. |

A malformed success body (missing answers, answers that do not match the questions) is also a `HunchoError` with `provider` and `body`.

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

`evaluate` receives `{ model, state, questions, signal? }` and returns `{ answers, usage?, requestId? }`. `answers` must be canonical raw answers keyed exactly by question id: `{ type: "noul", noul }`, `{ type: "choice", choice, probabilities, confidence }` or `{ type: "score", score, probabilities, confidence, legend? }`. The wrapper adds `provider`, `model` and `ms`, defaults `usage` to zero tokens, and turns anything thrown into a `HunchoError` carrying the original as `cause`. A `HunchoError` thrown inside `evaluate` passes through untouched.

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

A vendor is one wire file plus a directory of fixtures. Nothing above the Model seam changes. The steps, in order:

**1. Write the wire.** Create `src/<vendor>.ts` exporting a function that returns a `Wire`:

```ts
export function acme(options: { provider: string; url: string; apiKey: string }): Wire
```

A `Wire` has four methods:

| Method | Contract |
| --- | --- |
| `url(model)` | The endpoint for this model id. |
| `headers(model)` | Request headers. Transport adds `Content-Type: application/json`. |
| `encode(req, model)` | The JSON body for `{ state, questions }`. Send questions in the vendor's shape if it differs from the canonical one. |
| `decode(json, headers, req)` | `{ answers, usage, requestId? }`. `answers` is canonical, keyed exactly by `req.questions` keys. `usage` is `{ inputTokens, outputTokens }`, zero when the vendor does not report it. `requestId` comes from a response header. |

`decode` is called only on a `2xx` body; transport has already turned every other status into a `HunchoError`. It must verify the answer keys match the question keys and each answer's shape matches its question's type, and throw `new HunchoError(\`${provider}: ...\`, { provider, body })` when they do not. `src/systemone.ts` and `src/gateway.ts` are the two existing wires; both are short.

**2. Write the fixtures.** Create `fixtures/wires/<vendor>/` with one JSON file per case, in the format described in [wires.md](wires.md): the request, the exact URL, headers and body you expect the wire to send, the raw response, and the exact canonical decode. Cover each question type and any quirk of the dialect (usage naming, where the request id lives, a fallback when a field is missing).

**3. Register the wire in the runner.** `test/wires.test.ts` builds each wire with fixed test credentials and checks every fixture against it. Add your constructor to its `wires` map; the runner fails CI for any wire without fixtures and for any fixture directory without a wire. Add the constructor row to the table in `wires.md` so a port in another language builds the same wire.

**4. Write the provider factory.** In the same file, or in `src/<vendor>-provider.ts` if the wire is shared:

```ts
export function createAcme(options: AcmeOptions = {}): Provider {
  const defaultModel = options.defaultModel ?? "acme-latest";
  let wire: Wire | undefined;
  return makeProvider("acme", defaultModel, (id) => {
    const transport: { fetch?: FetchLike; retries?: number } = {};
    if (options.fetch !== undefined) transport.fetch = options.fetch;
    if (options.retries !== undefined) transport.retries = options.retries;
    return httpModel("acme", id, resolveWire(), transport);
  });

  function resolveWire(): Wire {
    if (wire !== undefined) return wire;
    const apiKey = present(options.apiKey) ?? env("ACME_API_KEY");
    if (apiKey === undefined) {
      throw new HunchoError("acme: set ACME_API_KEY or pass apiKey", { provider: "acme" });
    }
    wire = acme({ provider: "acme", url: options.url ?? "https://api.acme.example/v1/decide", apiKey });
    return wire;
  }
}

export const acme: Provider = createAcme();
```

`makeProvider` (`src/provider.ts`) makes the callable with `name` and `defaultModel`; `httpModel` (`src/wire.ts`) joins a wire to transport. Read the key inside `resolveWire`, never at module load, so importing `huncho` stays side-effect free. `env` and `present` are the two small helpers every existing provider file carries: `present` turns an empty string into `undefined`, and `env` reads `globalThis.process?.env` so the core still loads where `process` is absent.

**5. Export and test.** Add `createAcme`, `acme` and `AcmeOptions` to `src/index.ts`. Add `test/acme.test.ts` with an injected `fetch` for the request shape, the key error, and one live test gated on `ACME_API_KEY` that skips when the variable is absent. Add the variable to the live-test list in `CONTRIBUTING.md` and a row to the table at the top of this file.

A vendor that only needs a different URL or headers on an existing dialect is not a new wire. `createOpenRouter` reuses `systemone` with a different URL and attribution headers; do the same.
