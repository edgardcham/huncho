# huncho

[![ci](https://github.com/edgardcham/huncho/actions/workflows/ci.yml/badge.svg)](https://github.com/edgardcham/huncho/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/huncho)](https://www.npmjs.com/package/huncho)
[![license](https://img.shields.io/npm/l/huncho)](LICENSE)

Decisions as code.

A hunch is a probability with a policy attached. huncho makes that a first-class object in TypeScript: ask typed questions of a decision model, apply thresholds that do not flap, nest decisions, journal every one, replay a policy change without inference, and calibrate against what actually happened.

Decision models are providers, not the product. Out of the box: TypeSafe Jev called directly, Jev through OpenRouter, Jev through Vercel AI Gateway, and a factory for anything else. Nothing above the model seam knows which vendor answered. Zero runtime dependencies.

```
npm i huncho
```

```ts
import { choice, huncho, noul } from "huncho";
import { jev } from "huncho/jev";

const route = huncho("support.route", { model: jev() })
  .ask({
    urgent: noul("Does this need a human within the hour?"),
    topic: choice("What is it about?", ["billing", "bug", "other"]),
  })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
  .when((a) => a.topic.is("billing", 0.7), "billing")
  .else("triage");

const decision = await route.decide("Checkout is down. Every customer gets a 500 at payment.", { key: "T-1041" });
decision.outcome;   // "page" | "billing" | "triage"
decision.via;       // "enter" | "hold" | "else": how the outcome was reached
decision.previous;  // what this key decided last time, if anything
```

`jev()` reads `TYPESAFE_API_KEY` the first time it is called. `{ enter: 0.8, exit: 0.6 }` is hysteresis: the ticket enters `page` at 0.8 and stays there until urgency drops below 0.6, per `key`. Answer types follow from the questions, so `a.topic.p("refund")` is a compile error.

## Docs

The documentation is the site at [edgardcham.github.io/huncho](https://edgardcham.github.io/huncho/). It is built from this repo, so the pages under [`docs/`](docs) and the scripts under [`examples/`](examples) are the source, and the API reference is generated from the type declarations.

- [Getting started](https://edgardcham.github.io/huncho/getting-started/): install, key, first decision, sixty seconds.
- [Closing the loop](https://edgardcham.github.io/huncho/closing-the-loop/): decide, label, calibrate, sweep; a threshold read from the journal instead of picked by hand.
- Concepts: [questions and answers](https://edgardcham.github.io/huncho/questions/), [policy and hysteresis](https://edgardcham.github.io/huncho/policy/), [journal and replay](https://edgardcham.github.io/huncho/journal/), [calibration](https://edgardcham.github.io/huncho/calibration/), [sweep](https://edgardcham.github.io/huncho/sweep/), [nested decisions](https://edgardcham.github.io/huncho/nested/), [observability](https://edgardcham.github.io/huncho/observability/).
- Providers: [overview](https://edgardcham.github.io/huncho/providers/), [TypeSafe Jev](https://edgardcham.github.io/huncho/providers/jev/), [OpenRouter](https://edgardcham.github.io/huncho/providers/openrouter/), [Vercel AI Gateway](https://edgardcham.github.io/huncho/providers/gateway/), [adding a vendor](https://edgardcham.github.io/huncho/providers/adding-a-vendor/).
- [Cookbook](https://edgardcham.github.io/huncho/cookbook/support-route/): the examples as pages. Each runs with only `TYPESAFE_API_KEY` set, from the repo root after `npm run build`: `node --env-file-if-exists=.env.local dist/examples/support-route.js`.
- [API reference](https://edgardcham.github.io/huncho/api/), [wire fixtures](https://edgardcham.github.io/huncho/wires/), [stability](https://edgardcham.github.io/huncho/stability/), [changelog](CHANGELOG.md).

[CONTRIBUTING.md](CONTRIBUTING.md) is the working agreement and the module map.

## Packages

| Ecosystem | Package | Status |
| --- | --- | --- |
| npm | `huncho` | 0.5.0; the public API has been frozen since 0.1.0, [CHANGELOG.md](CHANGELOG.md) records every change to it and [stability](https://edgardcham.github.io/huncho/stability/) says what a version number means |
| PyPI | `huncho` | next, ported from the fixtures now that the TypeScript API is frozen |

One set of fixtures for wire dialects and policy semantics; each port passes the same files, and journals are interchangeable.

## License

MIT
