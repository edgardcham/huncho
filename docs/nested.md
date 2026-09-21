---
title: Nested decisions
description: Hang a huncho under an outcome of another, record the path, and ask a whole tree in one model call.
---

A huncho can hang under an outcome of another. The parent decides first; if its outcome has a branch, the child decides next and `path` records the descent.

```ts
import { choice, huncho, noul } from "huncho";
import { jev } from "huncho/jev";

const escalate = huncho("support.escalate", { model: jev() })
  .ask({ human: noul("Should a person take this?") })
  .when((a) => a.human.p, { enter: 0.8, exit: 0.6 }, "page")
  .else("queue");

const route = huncho("support.route", { model: jev() })
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "escalate")
  .else("wait")
  .branch({ escalate, wait: null }, { speculative: "chosen" });

const decision = await route.decide(ticket, { key: ticket.id });
decision.outcome;  // "escalate" | "wait" | "page" | "queue"
decision.path;     // ["escalate", "page"]
decision.child;    // the escalate decision
```

## branch

`branch(children, options?)` maps each of the parent's outcomes to a child huncho or to `null`, which marks an outcome that is deliberately a leaf. Every key must be one of the parent's outcomes. `decision.outcome` is the deepest outcome on the path, so its type is the union of the parent's and every child's; `decision.path` is the parent's outcome first, then each child's; `decision.child` is the child's own decision, with its own `answers`, `usage` and `ms`. `decision.children` holds every child that decided in the call, by the outcome it hangs under: the one under the parent's outcome, and under [`speculative: "all"`](#one-call-for-the-tree) every unshaped child. It is absent when no child decided.

A child with its own `shape` receives the parent's input and shapes it itself. A child without one receives the parent's state, already shaped.

A child decides under the parent's key unless the branch's `key` option derives one for it. It is called once per child that decides, with the outcome the child hangs under, the parent's key and the parent's input as `decide` received it, and returns the key that child decides under; that key is on the child's decision and record, and the child's hysteresis holds under it. Without the option a child inherits the parent's key.

```ts
const route = huncho("support.route", { model: jev() })
  .shape((t: Ticket) => t.body)
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "escalate")
  .else("wait")
  .branch({ escalate, wait: null }, { key: (outcome, key, t) => `${t.customer}:${outcome}` });

const decision = await route.decide(ticket, { key: ticket.id });
decision.key;        // ticket.id
decision.child?.key; // `${ticket.customer}:escalate`
```

`branch` closes `shape`: a branched huncho cannot be reshaped, because the children were built against the state the parent now sees. Call `shape` first.

## One call for the tree

Without `speculative`, the tree costs one model call per level: the parent's, then the chosen child's. With it, the parent asks the children's questions in its own request, prefixed with the outcome they hang under (`escalate.human`), and children settle from those answers with `ms: 0` and zero usage; the parent's decision and record carry the whole call's cost. A child with its own `shape` needs its own state, so it keeps its own call, made only when it is chosen. There are two modes:

- `"chosen"` settles only the child under the outcome the parent decided. The other children's answers are discarded. `true` means the same and is what 0.1 called it.
- `"all"` settles every unshaped child, whichever outcome the parent decided, each with its own `id`, its own record, `parentId` of the parent's decision and its own hysteresis under its own key. `decision.children` holds them by outcome, `decision.child` is still the one under the parent's outcome, and `path` still descends through that one only.

`"all"` is for a decision where every option gets a judgement of its own in one call: a page of blocks asked which block bears on the task and, for each block, whether applying it would change what to do now. With `key` deriving `${session}:${block}` for each child, each block holds its own outcome for the session, and a label on a block's decision joins by that decision's `id`.

```ts
const apply = huncho("page.apply", { model: jev(), journal })
  .ask({ use: noul("Would applying this block change what to do right now?") })
  .when((a) => a.use.p, { enter: 0.7, exit: 0.5 }, "use")
  .else("skip");

const page = huncho("page.pick", { model: jev(), journal })
  .ask({ best: choice("Which block bears on the task?", ["intro", "body", "summary"]) })
  .when((a) => a.best.is("intro", 0.5), "intro")
  .when((a) => a.best.is("body", 0.5), "body")
  .else("summary")
  .branch(
    { intro: apply, body: apply, summary: apply },
    { speculative: "all", key: (block, session) => `${session}:${block}` },
  );

const decision = await page.decide(task, { key: session });
decision.path;                       // ["body", "use"]
decision.children?.intro?.outcome;   // "use" | "skip", from the same call
decision.children?.summary?.key;     // `${session}:summary`
```

One request asks `best`, `intro.use`, `body.use` and `summary.use`. Four records are written: one per block, keyed `${session}:${block}` with `ms: 0`, then the page's, with the call's usage. The same huncho may hang under several outcomes, as `apply` does here; the prefix and the key keep the children apart.

The prefix keeps question ids apart. A child question whose prefixed id collides with a question the parent already asks is a `ConfigError` at decide time; rename the question or the outcome.

## Journal and hysteresis

Each huncho in the tree writes its own journal record, with its own outcome and its own hysteresis memory under its own key: the parent's, unless `key` derived another. Children's records land before the parent's, in the order the branch declares them. Replay a child on its own records exactly as you would a root: `replay(records, escalate)` picks the records by name, and a child hung under several outcomes replays all of them, hysteresis chained per key.

Every decision in the tree has its own `id`, and a child's `parentId` is the `id` of the decision that chose it: `decision.child.parentId === decision.id`, and the same two values are on the records. The root has no `parentId`. A speculative child, answered in the parent's call, is a decision of its own and carries `parentId` the same way. `path` names outcomes; `id` and `parentId` name decisions, so a label or a trace on a child rolls up to its parent by id alone.

## A tree built at decide time

`branch` declares the children up front. When the children are only known once the parent has decided, because they are read from a store and change between calls, build the next huncho then and hand `decide` the id of the decision that chose it:

```ts
const chosen = await route.decide(node, { key: node.id });
for (const next of await children(chosen.outcome)) {
  const step = huncho(`walk.${next.id}`, { model: jev(), journal })
    .ask({ relevant: noul("Does this node bear on the question?") })
    .when((a) => a.relevant.p, { enter: 0.7 }, "descend")
    .else("stop");
  await step.decide(next, { key: next.id, parentId: chosen.id });
}
```

Each `step` writes a record whose `parentId` is `chosen.id` and whose `id` is its own, exactly as a `branch` child's would, so the walk reassembles from the journal by `parentId` alone. The option belongs to the huncho `decide` is called on: a `branch` child under it keeps that huncho's `id` as its own `parentId`, whatever the caller passed.

## Tracing

Under [`withTracing`](observability.md), the tree is one span, named after the root, and the children decide inside it.
