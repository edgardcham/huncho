---
title: OpenRouter
description: Jev through OpenRouter's Decisions endpoint. The entry, the key, the defaults, the attribution options, and what it speaks on the wire.
---

`huncho/openrouter` calls Jev through [OpenRouter](https://openrouter.ai), for when your keys and billing already live there. Same decision, different import line, nothing else changes.

```ts
import { huncho, noul } from "huncho";
import { openrouter } from "huncho/openrouter";

const route = huncho("support.route", { model: openrouter() })
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
  .else("wait");
```

## Key

`openrouter()` reads `OPENROUTER_API_KEY` the first time it is called; importing the entry reads nothing. To take the key from somewhere else, build the provider yourself:

```ts
import { createOpenRouter } from "huncho/openrouter";

const openrouter = createOpenRouter({ apiKey: process.env.MY_OPENROUTER_KEY });
```

`apiKey` may be `undefined` or empty, in which case the variable is read instead. No key at all is a `ConfigError` on the first call: `openrouter: set OPENROUTER_API_KEY or pass apiKey to createOpenRouter`. A key OpenRouter rejects is a `ProviderError` with `status` `401` or `403` and `retryable: false`. [Keys](../providers.md#keys) and [Errors](../providers.md#errors) have the general rules.

## Defaults

| | |
| --- | --- |
| Entry | `huncho/openrouter` |
| Factory | `createOpenRouter(options)` |
| Ready-made instance | `openrouter` |
| Key from | `OPENROUTER_API_KEY` |
| URL | `https://openrouter.ai/api/alpha/decisions` |
| Model id | `~typesafe/jev-latest` |
| Wire | `systemone` |

OpenRouter's Decisions endpoint is in alpha and its path may move; `url` on the factory overrides it without waiting for a release. Model ids on this endpoint carry the vendor prefix with a tilde, as in `~typesafe/jev-latest`; `openrouter("~typesafe/some-id")` picks another.

## Options

`createOpenRouter(options)` takes the [core options](../providers.md#options) every provider shares, `apiKey`, `url`, `defaultModel`, `fetch` and `retries`, plus two for OpenRouter's app attribution:

| Option | Sent as | Meaning |
| --- | --- | --- |
| `referer` | `HTTP-Referer` | Your app's URL, shown on OpenRouter's rankings. |
| `title` | `X-Title` | Your app's name. |

```ts
const openrouter = createOpenRouter({
  apiKey: await vault.read("openrouter"),
  referer: "https://support.example.com",
  title: "Support routing",
});
```

## On the wire

`openrouter` speaks the same `systemone` dialect as [`jev`](jev.md), at a different URL and with the attribution headers added: the fixture under [`fixtures/wires/openrouter/`](../../fixtures/wires/openrouter) pins the URL, the headers and the tilde model id, and the body and the decode are those of `systemone`. Transport [retries](../providers.md#retries) `408`, `429`, `500`, `502`, `503` and `529` with backoff and fails any other status on first sight.
