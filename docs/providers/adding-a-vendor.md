---
title: Adding a vendor
description: One wire file plus a directory of fixtures. Nothing above the Model seam changes.
---

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

`decode` is called only on a `2xx` body; transport has already turned every other status into a `ProviderError`. It must verify the answer keys match the question keys and each answer's shape matches its question's type, and throw `new ProviderError(\`${provider}: ...\`, { provider, body, retryable: false })` when they do not. `src/systemone.ts` and `src/gateway.ts` are the two existing wires; both are short.

**2. Write the fixtures.** Create `fixtures/wires/<vendor>/` with one JSON file per case, in the format described in [wires.md](../wires.md): the request, the exact URL, headers and body you expect the wire to send, the raw response, and the exact canonical decode. Cover each question type and any quirk of the dialect (usage naming, where the request id lives, a fallback when a field is missing).

**3. Register the wire in the runner.** `test/wires.test.ts` builds each wire with fixed test credentials and checks every fixture against it. Add your constructor to its `wires` map; the runner fails CI for any wire without fixtures and for any fixture directory without a wire. Add the constructor row to the table in [wires.md](../wires.md) so a port in another language builds the same wire.

**4. Write the provider factory.** In the same file, or in `src/<vendor>-provider.ts` when the wire is shared or the wire file already owns the name, as `gateway-provider.ts` does:

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
      throw new ConfigError(
        "acme: set ACME_API_KEY or pass apiKey to createAcme, see https://github.com/edgardcham/huncho/blob/main/docs/providers.md#keys",
      );
    }
    wire = acme({ provider: "acme", url: options.url ?? "https://api.acme.example/v1/decide", apiKey });
    return wire;
  }
}

export const acme: Provider = createAcme();
```

`makeProvider` (`src/provider.ts`) makes the callable with `name` and `defaultModel`; `httpModel` (`src/wire.ts`) joins a wire to transport. Read the key inside `resolveWire`, never at module load, so importing `huncho` stays side-effect free. `env` and `present` are the two small helpers every existing provider file carries: `present` turns an empty string into `undefined`, and `env` reads `globalThis.process?.env` so the core still loads where `process` is absent.

**5. Export and test.** Give the provider its own entry: add `./acme` to the `exports` map in `package.json` (`types` first), to `typedoc.json`, and to the documented names in `test/entries.test.ts`, which checks that every entry exports exactly what it documents and loads where `node:` modules are unavailable. Re-export `createAcme`, `acme` and `AcmeOptions` from `src/index.ts`, and add both names to the root list in that test. Add `test/acme.test.ts` with an injected `fetch` for the request shape, the key error, and one live test gated on `ACME_API_KEY` that skips when the variable is absent. Add the variable to the live-test list in [CONTRIBUTING.md](../../CONTRIBUTING.md) and a row to the table at the top of [providers.md](../providers.md), and give it a page of its own beside this one.

A vendor that only needs a different URL or headers on an existing dialect is not a new wire. `createOpenRouter` reuses `systemone` with a different URL and attribution headers; do the same.
