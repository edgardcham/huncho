---
title: Policy
description: Clauses in order, hysteresis with enter and exit thresholds, else, with() for a copy, compose helpers, and the fixtures that specify it all.
---

A policy is a pure function of answers and an optional previous outcome: `decide(answers, previous?) → outcome`. No I/O, no model, no clock. That is why replay can re-run it over a journal without inference, and why the same file of fixtures specifies it for every port.

A huncho carries one policy and exposes its builder methods directly. `policy(name)` builds one on its own when you need it outside a huncho.

```ts
const route = huncho("support.route", { model })
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
  .when((a) => a.urgent.yes, "soon")
  .else("wait");
```

## Clauses

Clauses are checked in the order they were declared. The first active clause wins. Outcomes are string literals and accumulate into the outcome type, so `decision.outcome` above is `"page" | "soon" | "wait"`.

**Numeric clause** — `when(select, { enter, exit? }, outcome)`. `select` reads a number from the answers. The clause is active when the value is at least `enter`, or when the previous outcome for this key was this clause's outcome and the value is at least `exit`. `exit` defaults to `enter`, which is a plain threshold with no hysteresis. Both must be finite and `exit` at most `enter`; a hold that demands more than entering did can never hold, so declaring one is a `ConfigError`.

**Boolean clause** — `when(test, outcome, { exit? })`. Active when `test(answers)` is true, or when the previous outcome was this clause's outcome and `exit(answers)` is true. Without `exit` there is no hold.

**Fallback** — `else(outcome)`. Used when no clause is active. Without an `else`, a decision with no active clause throws a `PolicyError` naming the policy: `policy "<name>": no clause matched and there is no else`.

## Hysteresis

Two thresholds stop an outcome flapping around a single one. With `{ enter: 0.8, exit: 0.6 }`, a key enters `page` at 0.8 and stays there until the value drops below 0.6:

| value | previous | outcome | via |
| --- | --- | --- | --- |
| 0.85 | | page | enter |
| 0.70 | page | page | hold |
| 0.65 | page | page | hold |
| 0.55 | page | wait | else |
| 0.70 | wait | wait | else |

The hold is per outcome and only applies to the clause that produced it: a held `page` does not keep a different clause active. An earlier clause that enters on its own beats a later clause's hold, so priority is always declaration order.

A decision says which of the three paths produced its outcome, the `via` column above: `decision.via` is `enter` when a clause entered on its own, `hold` when a clause kept `previous` because only its exit condition held, and `else` when the fallback covered it. The [journal record](journal.md#fields) and each [replay result](journal.md#replay) carry the same field.

## Previous

`previous` is whatever the caller passes to the policy. Inside a huncho it comes from one of two places.

**The huncho's memory.** By default `decide` remembers the outcome it decided for each `key` and uses it as `previous` next time. `key` defaults to `"default"`. The memory is bounded: `huncho(name, { memory })` sets how many keys it holds, `10_000` unless you say otherwise, and when a new key would exceed that the key least recently decided is dropped, so a process keying on ticket or user ids stays flat however many it sees. A dropped key decides as if for the first time. `memory: 0` remembers nothing.

**The caller's store.** `decide(input, { key, previous })` replaces the memory for that one call. A string is the outcome you stored for the key last time; `null` says there is no previous, whatever the memory has. The decision reports what was used in `decision.previous`, and a hold from a supplied `previous` is `via: "hold"` exactly like a hold from memory. The outcome decided is remembered afterwards either way. `previous` belongs to the huncho you call `decide` on; a [nested child](nested.md) reads its own memory.

This is how hysteresis survives a restart, with no store seam in huncho: your database already has a row per ticket, so keep the outcome on it and hand it back.

```ts
const stored = await tickets.get(ticket.id); // { outcome: "page" } or nothing
const decision = await route.decide(ticket, { key: ticket.id, previous: stored?.outcome ?? null });
await tickets.set(ticket.id, { outcome: decision.path[0] });
```

Store this huncho's own outcome, `decision.path[0]`, which is `decision.outcome` when there is no branch. `decision.previous` says what the decision was held against, so a record can be checked against what you stored.

Replay takes `previous` from the journal record for a key's first record, then chains its own replayed outcomes.

## Changing thresholds

`with({ outcome: { enter?, exit? } })` returns a copy with a numeric clause's thresholds replaced. Boolean clauses and `else` are unaffected. Overriding only `enter` on a clause that had no explicit `exit` moves `exit` with it, so a plain threshold stays plain. The copy is checked like a new clause: lowering `enter` below an explicit `exit` is a `ConfigError`, so lower both. The original is untouched; replay the copy against the journal before deploying it.

```ts
const stricter = route.with({ page: { enter: 0.9 } });
replay(await readJournal("decisions.jsonl"), stricter).changed;
```

## Compose helpers

Combining probabilities happens **in code**, inside a selector or test. The model never combines anything.

| Helper | Meaning |
| --- | --- |
| `all(...ps)` | Minimum. Empty input is `0`. |
| `any(...ps)` | Maximum. Empty input is `0`. |
| `weighted([[p, w], …])` | Weighted mean. Empty input or zero total weight is `0`. Probabilities must be finite and weights finite and non-negative, or it throws a `ConfigError`. |
| `uncertain(p, band?)` | Absolute difference from `0.5` is less than `band`. Default band is `0.15`. The bound is open: a value exactly `band` away from `0.5` is not uncertain. |
| `violation(checks, threshold?)` | True when any check is `>= threshold`. Default threshold is `0.7`. Empty input is false. |

**weighted** is for compensating preferences. A strong signal can make up for a weaker one; the result is one probability you can threshold.

**violation** is an any-serious-violation rule. One check clearing the threshold is enough. A pile of mild checks does not add up. That is deliberate: do not average harm signals.

A probability near `0.5` means "don't know", not "medium". `uncertain` makes abstaining the easy path: route it to a person.

```ts
.when((a) => violation([a.destructive.p, a.exfiltrates.p]), "block")
.when((a) => uncertain(a.offPolicy.p, 0.2), "ask")
.else("allow")
```

## Fixtures

`fixtures/policy/*.json` is the specification. Each file is `{ clauses, sequence }`: clauses as `numeric` (`select` key, `enter`, optional `exit`, `outcome`), `boolean` (`test` key, optional `exit` key, `outcome`) or `else` (`outcome`); a sequence of `{ answers, previous?, expect, via? }` steps over a flat object of numbers and booleans. Same clauses and answers, same outcome, in every language. A step with `via` also pins how the outcome was reached, `enter`, `hold` or `else`; a runner checks it when present.
