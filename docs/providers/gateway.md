---
title: Vercel AI Gateway
description: Jev through Vercel AI Gateway's evaluation endpoint. The entry, the key, the defaults, the options, and the dialect it speaks.
---

`huncho/gateway` calls Jev through [Vercel AI Gateway](https://vercel.com/ai-gateway), for when your models are routed and billed there. Same decision, different import line, nothing else changes.

```ts
import { huncho, noul } from "huncho";
import { gateway } from "huncho/gateway";

const route = huncho("support.route", { model: gateway() })
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
  .else("wait");
```

## Key

`gateway()` reads `AI_GATEWAY_API_KEY` the first time it is called; importing the entry reads nothing. To take the key from somewhere else, build the provider yourself:

```ts
import { createGateway } from "huncho/gateway";

const gateway = createGateway({ apiKey: process.env.MY_GATEWAY_KEY });
```

`apiKey` may be `undefined` or empty, in which case the variable is read instead. No key at all is a `ConfigError` on the first call: `gateway: set AI_GATEWAY_API_KEY or pass apiKey to createGateway`. A key the gateway rejects is a `ProviderError` with `status` `401` or `403` and `retryable: false`. [Keys](../providers.md#keys) and [Errors](../providers.md#errors) have the general rules.

## Defaults

| | |
| --- | --- |
| Entry | `huncho/gateway` |
| Factory | `createGateway(options)` |
| Ready-made instance | `gateway` |
| Key from | `AI_GATEWAY_API_KEY` |
| URL | `https://ai-gateway.vercel.sh/v4/ai/evaluation-model` |
| Model id | `typesafe-ai/jev` |
| Wire | `gateway` |

`gateway()` is the default model; `gateway("typesafe-ai/some-id")` is another. The gateway names models `vendor/model`.

## Options

`createGateway(options)` takes the [core options](../providers.md#options) every provider shares, `apiKey`, `url`, `defaultModel`, `fetch` and `retries`, plus:

| Option | Meaning |
| --- | --- |
| `headers` | Extra request headers, merged under the auth and protocol headers. |

```ts
const gateway = createGateway({
  apiKey: await vault.read("gateway"),
  retries: 2,
  headers: { "X-Team": "support" },
});
```

## On the wire

`gateway` has a wire of its own, the Vercel AI Gateway evaluation dialect. The model id travels in the `Ai-Model-Id` header rather than the body, alongside the protocol and specification version headers; a `noul` question is sent as `boolean` and decoded back to `noul`; a choice's confidence comes from `providerMetadata.typesafe.confidence`, and when that is missing it is the gap between the top two probabilities; the request id is the `x-vercel-id` response header. The fixtures under [`fixtures/wires/gateway/`](../../fixtures/wires/gateway) pin every one of those, described in [Wire fixtures](../wires.md). Transport [retries](../providers.md#retries) `408`, `429`, `500`, `502`, `503` and `529` with backoff and fails any other status on first sight.
