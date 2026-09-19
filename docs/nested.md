---
title: Nested decisions
description: Hang a huncho under an outcome of another, record the path, and ask a whole tree in one model call.
---

A huncho can hang under an outcome of another. The parent decides first; if its outcome has a branch, the child decides next and `path` records the descent.

```ts
import { huncho, noul } from "huncho";
import { jev } from "huncho/jev";

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

## branch

`branch(children, options?)` maps each of the parent's outcomes to a child huncho or to `null`, which marks an outcome that is deliberately a leaf. Every key must be one of the parent's outcomes. `decision.outcome` is the deepest outcome on the path, so its type is the union of the parent's and every child's; `decision.path` is the parent's outcome first, then each child's; `decision.child` is the child's own decision, with its own `answers`, `usage` and `ms`.

A child with its own `shape` receives the parent's input and shapes it itself. A child without one receives the parent's state, already shaped.

`branch` closes `shape`: a branched huncho cannot be reshaped, because the children were built against the state the parent now sees. Call `shape` first.

## One call for the tree

Without `speculative`, the tree costs one model call per level: the parent's, then the chosen child's. With `{ speculative: true }`, the parent asks the children's questions in its own request, prefixed with the outcome they hang under (`escalate.human`), and the chosen child settles from those answers with `ms: 0` and zero usage. A child with its own `shape` needs its own state, so it keeps its own call.

The prefix keeps question ids apart. A child question whose prefixed id collides with a question the parent already asks is a `ConfigError` at decide time; rename the question or the outcome.

## Journal and hysteresis

Each huncho in the tree writes its own journal record, with its own outcome and its own hysteresis memory under the same key. Replay a child on its own records exactly as you would a root: `replay(records, escalate)` picks the records by name.

## Tracing

Under [`withTracing`](observability.md), the tree is one span, named after the root, and the children decide inside it.
