# huncho

[![ci](https://github.com/edgardcham/huncho/actions/workflows/ci.yml/badge.svg)](https://github.com/edgardcham/huncho/actions/workflows/ci.yml)

Decisions as code.

A hunch is a probability with a policy attached. Huncho makes that a first-class object in TypeScript: build the state a question sees, ask typed questions, apply thresholds that do not flap, nest decisions into trees, compose answers in code, journal every decision, replay a policy change without inference, and calibrate against what actually happened.

Decision models are providers, not the product. Out of the box: TypeSafe Jev called directly, Jev through OpenRouter, Jev through Vercel AI Gateway, and a factory for anything in-process or future. Adding a vendor is one file plus fixtures; nothing above the model seam learns the vendor exists.

## Why

Decision models return typed answers with probabilities instead of text: a yes/no with a probability, a choice with a distribution, a score on a rubric, in a few hundred milliseconds. That makes them usable as programming primitives. Every project that uses one then hand-rolls the same five things around the raw answer:

- a threshold, and then a second threshold because the first one flickered
- a way to chain one decision into the next
- a rule for combining several answers into one action
- a log, so a bad decision can be replayed
- a spreadsheet, so somebody can check whether the probabilities mean anything

Huncho is those five things, done once, with types and tests.

## Quick start

```ts
import { ask, jev, noul } from "huncho";

const { answers } = await ask(jev(), "The invoice is overdue and the card was declined.", {
  urgent: noul("Does this need a human within the hour?"),
});

answers.urgent.yes;
answers.urgent.p;
```

`jev()` reads `TYPESAFE_API_KEY` on first use. Any other Model works the same.

## Sketch

The API is not final. This is the shape it is converging on.

```ts
import { huncho, noul, choice, jev, replay, readJournal } from "huncho";

const route = huncho("support.route", { model: jev() })
  .shape((t: Ticket) => ({ subject: t.subject, body: t.body, policies }))
  .ask({
    urgent: noul("Does this need a human within the hour?"),
    topic: choice("What is it about?", { billing: null, bug: null, other: null }),
  })
  .when(a => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
  .when(a => a.topic.is("billing", 0.7), "billing")
  .else("triage");

const decision = await route.decide(ticket, { key: ticket.id });
decision.outcome; // "page" | "billing" | "triage"
```

Same decision through a different provider, nothing else changes:

```ts
import { openrouter, gateway } from "huncho";
huncho("support.route", { model: openrouter() });
huncho("support.route", { model: gateway() });
```

Change a threshold and replay a day of journaled decisions, no tokens spent:

```ts
const { n, changed } = replay(
  await readJournal("decisions.jsonl"),
  route.with({ page: { enter: 0.85 } }),
);
changed; // how many outcomes move
n; // records for this huncho
```

## Nested decisions

A huncho can hang under an outcome of another. The parent decides first; if its outcome has a branch, the child decides next, and `path` records the descent.

```ts
const escalate = huncho("support.escalate", { model: jev() })
  .ask({ human: noul("Should a person take this?") })
  .when(a => a.human.p, { enter: 0.8, exit: 0.6 }, "page")
  .else("queue");

const route = huncho("support.route", { model: jev() })
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when(a => a.urgent.p, { enter: 0.8, exit: 0.6 }, "escalate")
  .else("wait")
  .branch({ escalate, wait: null });

const decision = await route.decide(ticket, { key: ticket.id });
decision.outcome; // "escalate" | "wait" | "page" | "queue"
decision.path;    // ["escalate", "page"]
decision.child;   // the escalate decision
```

Two model calls when `urgent` clears the threshold: one for `route`, one for `escalate`. The child has no `shape`, so it sees the same state the parent saw.

That second call is avoidable. Mark the branch speculative and the parent asks the children's questions in its own request, keyed `escalate.human`. When the parent's outcome picks a child, that child's answers are sliced out and its policy runs; the rest are dropped.

```ts
const route = huncho("support.route", { model: jev() })
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when(a => a.urgent.p, { enter: 0.8, exit: 0.6 }, "escalate")
  .else("wait")
  .branch({ escalate, wait: null }, { speculative: true });

const decision = await route.decide(ticket, { key: ticket.id });
decision.path;         // ["escalate", "page"], from one model call
decision.usage;        // the whole request
decision.child?.ms;    // 0
decision.child?.usage; // { inputTokens: 0, outputTokens: 0 }
```

One call for the whole tree. Only a child without a `shape` is speculated; a child with its own `shape` needs its own state, so it keeps its own call. A speculated child that is itself speculative passes its children's questions up the same way, so a tree of unshaped hunchos is always one round trip. Each huncho still writes its own journal record; the child's carries `ms: 0` and zero usage because the parent paid.

## What it provides

- **Model** and **Provider**: one method, `evaluate`, behind which live HTTP, auth, retries and vendor dialects.
- **Questions and answers**: `noul`, `choice`, `score` builders; answer types inferred from the questions.
- **Policy**: ordered clauses, thresholds with hysteresis, an `else`, pure and replayable.
- **Huncho**: the orchestrator that runs shape, model, policy, branches and journal in order.
- **Branches**: nest decisions under outcomes; speculative fan-out asks a whole tree in one round trip.
- **Journal**: memory and JSONL adapters writing a documented, language-neutral record.
- **Replay** and **calibrate**: pure functions over the journal. Brier score, reliability, accuracy by confidence.
- **Shape**: pick, rename, redact, truncate what the model sees.

## Design rules

- Small interfaces, deep implementations. Tests cross the same seam callers do.
- Raw judgments are reusable data. Policy is explicit and lives in code. Changing a weight or threshold never reruns inference.
- A probability near 0.5 means "don't know", not "medium". Abstaining is the easy path.
- Nothing ships without a journal you can replay.
- Zero runtime dependencies.

## Status

`0.0.1` is `ask()` through a Model. Later slices add policy, journal, replay and more providers. [CONTRIBUTING.md](CONTRIBUTING.md) is the source of truth for module shapes.

## Packages

| Ecosystem | Package | Status |
| --- | --- | --- |
| npm | `huncho` | 0.0.1 |
| PyPI | `huncho` | after the TypeScript API freezes |

One set of fixtures for wire dialects and policy semantics; each port passes the same files, and journals are interchangeable.


## License

MIT
