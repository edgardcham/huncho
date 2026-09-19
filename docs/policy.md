# Policy

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

**Numeric clause** — `when(select, { enter, exit? }, outcome)`. `select` reads a number from the answers. The clause is active when the value is at least `enter`, or when the previous outcome for this key was this clause's outcome and the value is at least `exit`. `exit` defaults to `enter`, which is a plain threshold with no hysteresis.

**Boolean clause** — `when(test, outcome, { exit? })`. Active when `test(answers)` is true, or when the previous outcome was this clause's outcome and `exit(answers)` is true. Without `exit` there is no hold.

**Fallback** — `else(outcome)`. Used when no clause is active. Without an `else`, a decision with no active clause throws `no outcome for policy "<name>"`.

## Hysteresis

Two thresholds stop an outcome flapping around a single one. With `{ enter: 0.8, exit: 0.6 }`, a key enters `page` at 0.8 and stays there until the value drops below 0.6:

| value | previous | outcome |
| --- | --- | --- |
| 0.85 | | page |
| 0.70 | page | page |
| 0.65 | page | page |
| 0.55 | page | wait |
| 0.70 | wait | wait |

The hold is per outcome and only applies to the clause that produced it: a held `page` does not keep a different clause active. An earlier clause that enters on its own beats a later clause's hold, so priority is always declaration order.

`previous` is whatever the caller passes. Inside a huncho it is the outcome last decided for the same `key`, kept in memory for the life of that huncho instance; the first decision for a key has no previous. `key` defaults to `"default"`. Replay takes `previous` from the journal record for a key's first record, then chains its own replayed outcomes.

## Changing thresholds

`with({ outcome: { enter?, exit? } })` returns a copy with a numeric clause's thresholds replaced. Boolean clauses and `else` are unaffected. Overriding only `enter` on a clause that had no explicit `exit` moves `exit` with it, so a plain threshold stays plain. The original is untouched; replay the copy against the journal before deploying it.

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
| `weighted([[p, w], …])` | Weighted mean. Empty input or zero total weight is `0`. Probabilities must be finite; weights must be finite and non-negative. |
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

`fixtures/policy/*.json` is the specification. Each file is `{ clauses, sequence }`: clauses as `numeric` (`select` key, `enter`, optional `exit`, `outcome`), `boolean` (`test` key, optional `exit` key, `outcome`) or `else` (`outcome`); a sequence of `{ answers, previous?, expect }` steps over a flat object of numbers and booleans. Same clauses and answers, same outcome, in every language.
