---
title: TypeSafe Jev
description: Jev called directly at api.typesafe.ai. The entry, the key, the defaults, the options, and what it speaks on the wire.
---

[Jev](https://typesafe.ai) is TypeSafe's decision model, and `huncho/jev` calls it directly. It is the default path: every example in these docs and in the repo runs with only `TYPESAFE_API_KEY` set.

```ts
import { huncho, noul } from "huncho";
import { jev } from "huncho/jev";

const route = huncho("support.route", { model: jev() })
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
  .else("wait");
```

## Key

`jev()` reads `TYPESAFE_API_KEY` the first time it is called; importing the entry reads nothing. To take the key from somewhere else, build the provider yourself:

```ts
import { createJev } from "huncho/jev";

const jev = createJev({ apiKey: process.env.MY_JEV_KEY });
```

`apiKey` may be `undefined` or empty, in which case the variable is read instead. No key at all is a `ConfigError` on the first call: `jev: set TYPESAFE_API_KEY or pass apiKey to createJev`. A key TypeSafe rejects is a `ProviderError` with `status` `401` or `403` and `retryable: false`. [Keys](../providers.md#keys) and [Errors](../providers.md#errors) have the general rules.

## Defaults

| | |
| --- | --- |
| Entry | `huncho/jev` |
| Factory | `createJev(options)` |
| Ready-made instance | `jev` |
| Key from | `TYPESAFE_API_KEY` |
| URL | `https://api.typesafe.ai/v1/systemone` |
| Model id | `jev-latest` |
| Wire | `systemone` |

`jev()` is the default model; `jev("some-id")` is another id at the same endpoint. Both return a `Model`, one method, `evaluate`.

## Options

`createJev(options)` takes the [core options](../providers.md#options) every provider shares, `apiKey`, `url`, `defaultModel`, `fetch` and `retries`, plus:

| Option | Meaning |
| --- | --- |
| `headers` | Extra request headers, merged under the `Authorization` header. |

```ts
const jev = createJev({
  apiKey: await vault.read("jev"),
  defaultModel: "jev-latest",
  retries: 2,
  headers: { "X-Team": "support" },
});
```

## On the wire

`jev` speaks the `systemone` dialect: the model id, the state and the questions go in a JSON body, answers come back in the canonical shape, usage arrives as `input_tokens` and `output_tokens`, and the request id is the `x-request-id` response header. The dialect is specified by the fixtures under [`fixtures/wires/systemone/`](../../fixtures/wires/systemone), described in [Wire fixtures](../wires.md). Transport [retries](../providers.md#retries) `408`, `429`, `500`, `502`, `503` and `529` with backoff and fails any other status on first sight.
