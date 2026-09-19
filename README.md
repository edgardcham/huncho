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

## Ask a question

```ts
import { ask, choice, noul } from "huncho";
import { jev } from "huncho/jev";

const { answers } = await ask(jev(), "The invoice is overdue and the card was declined twice.", {
  urgent: noul("Does this need a human within the hour?"),
  topic: choice("What is it about?", ["billing", "bug", "other"]),
});

answers.urgent.p;            // 0.91
answers.urgent.yes;          // true
answers.topic.choice;        // "billing"
answers.topic.p("billing");  // 0.84
```

`jev()` reads `TYPESAFE_API_KEY` the first time it is called. Three question types: `noul` (probability of yes), `choice` (one of a named set, with a distribution), `score` (a position on an ordered rubric). Answer types are inferred from the questions, so `answers.topic.p("refund")` is a compile error.

## Decide, and hold the decision

A huncho is a named decision: what the model sees, what it is asked, and the policy that turns answers into an outcome.

```ts
import { huncho, choice, noul } from "huncho";
import { jev } from "huncho/jev";

type Ticket = { id: string; subject: string; body: string };

const route = huncho("support.route", { model: jev() })
  .shape((t: Ticket) => ({ subject: t.subject, body: t.body }))
  .ask({
    urgent: noul("Does this need a human within the hour?"),
    topic: choice("What is it about?", ["billing", "bug", "other"]),
  })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
  .when((a) => a.topic.is("billing", 0.7), "billing")
  .else("triage");

const ticket: Ticket = { id: "T-1041", subject: "Checkout is down", body: "Every customer gets a 500 at payment." };
const decision = await route.decide(ticket, { key: ticket.id });
decision.outcome;   // "page" | "billing" | "triage"
decision.previous;  // what this key decided last time, if anything
```

`{ enter: 0.8, exit: 0.6 }` is hysteresis. A ticket enters `page` at 0.8 and stays there until urgency drops below 0.6, so a value that wobbles around one threshold does not flip the outcome on every update. The hold is per `key`; pass the id of the thing the decision is about. Clauses are checked in order and the first active one wins. Combining answers happens in your code, with helpers like `all`, `any`, `weighted`, `uncertain` and `violation`; the model never combines anything. [docs/policy.md](docs/policy.md) has the full semantics.

## Journal and replay

Give a huncho a journal and every decision is written as a language-neutral record: hashes of the state and questions, the raw answers, the outcome, the previous outcome, usage and timing.

```ts
import { huncho, replay } from "huncho";
import { jev } from "huncho/jev";
import { fileJournal, readJournal } from "huncho/node";

const route = huncho("support.route", { model: jev(), journal: fileJournal("decisions.jsonl") })
  // ...same shape, questions and policy as above
```

Change a threshold and replay the journal against it. No model call; replay re-runs the policy over the recorded answers, chaining hysteresis per key in record order.

```ts
const stricter = route.with({ page: { enter: 0.9, exit: 0.7 } });
const { n, changed, outcomes } = replay(await readJournal("decisions.jsonl"), stricter);
changed;   // how many outcomes would move
outcomes;  // { page: 12, billing: 40, triage: 131 }
```

When you know what actually happened, `calibrate` tells you whether the probabilities meant anything: Brier score against the base rate, a reliability table, accuracy by confidence band. [docs/journal.md](docs/journal.md) is the record contract; [docs/calibration.md](docs/calibration.md) explains the numbers.

## Providers

Same decision, different provider, nothing else changes. Each provider has its own entry, so the import line says which vendor a file talks to:

```ts
import { jev } from "huncho/jev";
import { openrouter } from "huncho/openrouter";
import { gateway } from "huncho/gateway";

huncho("support.route", { model: jev() });          // TYPESAFE_API_KEY
huncho("support.route", { model: openrouter() });   // OPENROUTER_API_KEY
huncho("support.route", { model: gateway() });      // AI_GATEWAY_API_KEY
```

Those environment variable names are defaults, not requirements. Pass `apiKey` and the key can come from anywhere: a differently named variable, a secrets manager, a config file. Nothing is read from the environment at import time, only when a provider is first called.

```ts
import { createJev } from "huncho/jev";
import { createOpenRouter } from "huncho/openrouter";

const jev = createJev({ apiKey: process.env.MY_JEV_KEY });
const openrouter = createOpenRouter({ apiKey: await vault.read("openrouter") });
```

`createProvider` wraps anything with an `evaluate` function; `huncho/testing` exports `scriptedModel` so your own decisions are testable without a network. Adding a vendor is one wire file plus fixtures. [docs/providers.md](docs/providers.md) has env vars, URLs, model ids, options and the recipe.

The root entry re-exports everything, so `import { jev } from "huncho"` works too. The subpaths exist so a reader knows what an import pulls in: `huncho` is the runtime-agnostic core, `huncho/jev`, `huncho/openrouter` and `huncho/gateway` are one vendor each, `huncho/node` is the file journal (the only entry that touches Node APIs), and `huncho/testing` is the scripted model.

## Nested decisions

A huncho can hang under an outcome of another. The parent decides first; if its outcome has a branch, the child decides next and `path` records the descent.

```ts
const escalate = huncho("support.escalate", { model: jev() })
  .ask({ human: noul("Should a person take this?") })
  .when((a) => a.human.p, { enter: 0.8, exit: 0.6 }, "page")
  .else("queue");

const route = huncho("support.route", { model: jev() })
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "escalate")
  .else("wait")
  .branch({ escalate, wait: null }, { speculative: true });

const decision = await route.decide(ticket, { key: ticket.id });
decision.outcome;  // "escalate" | "wait" | "page" | "queue"
decision.path;     // ["escalate", "page"]
decision.child;    // the escalate decision
```

Without `speculative`, the tree costs one model call per level. With it, the parent asks the children's questions in its own request, keyed `escalate.human`, and the chosen child settles from those answers with `ms: 0` and zero usage. A child with its own `shape` needs its own state, so it keeps its own call. Each huncho still writes its own journal record.

## Examples

Each one runs with only `TYPESAFE_API_KEY` set, from the repo root after `npm run build`:

```
node --env-file-if-exists=.env.local dist/examples/support-route.js
```

| Example | Shows |
| --- | --- |
| [`ask.ts`](examples/ask.ts) | Typed answers in five lines. |
| [`support-route.ts`](examples/support-route.ts) | One ticket, three updates, a `page` that holds through a dip and then releases. |
| [`tool-gate.ts`](examples/tool-gate.ts) | An agent's proposed tool calls judged against [a policy file](examples/tool-policy.md); `violation` blocks, `uncertain` asks a person. |
| [`rerank.ts`](examples/rerank.ts) | Candidates scored on one rubric with a `score` question, sorted in code. |
| [`replay.ts`](examples/replay.ts) | Journal a batch to a file, raise the threshold, see which outcomes move without a model call. |

## Docs

- [Policy](docs/policy.md): clauses, hysteresis, `else`, `with`, compose helpers, fixtures.
- [Journal](docs/journal.md): the JournalRecord v1 contract, hashing, memory and file adapters.
- [Calibration](docs/calibration.md): Brier, reliability, accuracy by confidence.
- [Providers](docs/providers.md): env vars, URLs, model ids, errors, custom providers, adding a vendor.
- [Wires](docs/wires.md): the fixture format that specifies each vendor dialect.
- [Stability](docs/stability.md): what is public, what a version number means, deprecation, fixtures as the contract, Node support.
- API reference: `npm run docs` generates it from the type declarations into `docs/api/`.

## Design rules

- Small interfaces, deep implementations. Tests cross the same seam callers do.
- Raw judgments are reusable data. Policy is explicit and lives in code. Changing a weight or threshold never reruns inference.
- A probability near 0.5 means "don't know", not "medium". Abstaining is the easy path.
- Nothing ships without a journal you can replay.
- Zero runtime dependencies.

[CONTRIBUTING.md](CONTRIBUTING.md) is the working agreement and the module map.

## Packages

| Ecosystem | Package | Status |
| --- | --- | --- |
| npm | `huncho` | 0.1.0, the first full release; the public API is frozen from here and [CHANGELOG.md](CHANGELOG.md) records every change to it |
| PyPI | `huncho` | next, ported from the fixtures now that the TypeScript API is frozen |

One set of fixtures for wire dialects and policy semantics; each port passes the same files, and journals are interchangeable.

## License

MIT
