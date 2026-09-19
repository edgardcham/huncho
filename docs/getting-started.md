---
title: Getting started
description: Install huncho, set a key, make a first decision and hold it. Sixty seconds.
---

huncho asks a decision model typed questions and turns the answers into an outcome through a policy you write in code. This page goes from an empty directory to a decision you can run, hold and replay.

## Install

Node 22 or later. huncho is ESM, so the project is too.

```sh
mkdir first-decision && cd first-decision
npm init -y && npm pkg set type=module
npm i huncho
```

## Key

The built-in providers call [TypeSafe Jev](https://typesafe.ai). Put a key in `.env.local`:

```sh
TYPESAFE_API_KEY=...
```

`jev()` reads the variable the first time it is called; nothing is read at import. OpenRouter and Vercel AI Gateway have their own entries and variables; [Providers](providers.md) has all three.

## First decision

Save this as `decide.ts`:

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

const decision = await route.decide("Checkout is down. Every customer gets a 500 at payment.", {
  key: "T-1041",
});

console.log(decision.outcome, decision.answers.urgent.p.toFixed(2), decision.answers.topic.choice);
```

Run it. Node 22.18 and later run a TypeScript file as it is; an earlier 22 needs `--experimental-strip-types`.

```sh
node --env-file=.env.local decide.ts
```

```
page 0.83 bug
```

That is a decision: a named huncho, two typed questions, a policy of three clauses, and an outcome the code around it can switch on. `decision.outcome` is typed `"page" | "billing" | "triage"`, and `decision.answers.topic.p("refund")` is a compile error because `refund` was never offered.

## What each line did

- `noul` asks for a probability of yes; `choice` asks for one of a named set with a distribution over the set. [Questions and answers](questions.md) covers both and `score`, the third type.
- `when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")` is a numeric clause with hysteresis. A ticket enters `page` at 0.8 and stays there until urgency drops below 0.6, so a value that wobbles around one threshold does not flip the outcome on every update. Clauses are checked in order; the first active one wins; `else` covers the rest. [Policy](policy.md) has the semantics.
- `key: "T-1041"` names the thing the decision is about. The hold is per key: decide the same key again and `decision.previous` is what it decided last time.

## Hold it, record it, replay it

Decide the same ticket twice more as it calms down and watch `page` hold through the dip:

```ts
for (const update of [
  "Payments are still failing for about half our customers, but the rate is dropping.",
  "Checkout is back for everyone. Filing this so the incident is on record.",
]) {
  const next = await route.decide(update, { key: "T-1041" });
  console.log(next.previous, "->", next.outcome, next.answers.urgent.p.toFixed(2));
}
```

```
page -> page 0.65
page -> triage 0.21
```

The second update is below `enter` and above `exit`, so `page` holds. The third is below `exit`, so the hold ends and the clauses are checked afresh; nothing enters, and `else` gives `triage`.

Give the huncho a journal and every decision is written as a record you can replay against a changed policy with no model call:

```ts
import { huncho, replay } from "huncho";
import { fileJournal, readJournal } from "huncho/node";

const journaled = huncho("support.route", { model: jev(), journal: fileJournal("decisions.jsonl") })
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
  .else("triage");

// ...decide a batch, then:
const stricter = journaled.with({ page: { enter: 0.9, exit: 0.7 } });
const { changed, outcomes } = replay(await readJournal("decisions.jsonl"), stricter);
```

[Journal and replay](journal.md) is the record contract and what replay does with it; [Calibration](calibration.md) is how to find out whether the probabilities meant anything once you know what really happened.

## Without a key

`huncho/testing` exports `scriptedModel`, a model that answers from a script, so the code around a decision is testable with no network and no key:

```ts
import { huncho, noul } from "huncho";
import { scriptedModel } from "huncho/testing";

const { model } = scriptedModel([{ answers: { urgent: { type: "noul", noul: 0.9 } } }]);
const route = huncho("support.route", { model })
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
  .else("triage");

(await route.decide("anything")).outcome; // "page"
```

## Where next

- The cookbook runs [the routing decision above](../examples/support-route.ts) through three updates of one ticket, [gates an agent's tool calls](../examples/tool-gate.ts), [reranks passages](../examples/rerank.ts) with a `score` question, and [replays a journal](../examples/replay.ts) after a threshold change.
- [Nested decisions](nested.md) hang one huncho under an outcome of another.
- [Observability](observability.md) sees every decision as it happens: a hook, or one OpenTelemetry span per `decide`.
