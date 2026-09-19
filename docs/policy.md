# Policy

Policy is a pure function of answers and an optional previous outcome. Replay runs it with no model. Clauses are declared in order; the first active one wins.

Compose helpers combine probabilities **in code**. The model never combines anything. Use them inside `when` selectors and tests.

## Helpers

| Helper | Meaning |
| --- | --- |
| `all(...ps)` | Minimum. Empty input is `0`. |
| `any(...ps)` | Maximum. Empty input is `0`. |
| `weighted([[p, w], …])` | Weighted mean. Empty input or zero total weight is `0`. Probabilities must be finite; weights must be finite and non-negative. |
| `uncertain(p, band?)` | Absolute difference from `0.5` is less than `band`. Default band is `0.15`. The bound is open: a value exactly `band` away from `0.5` is not uncertain. |
| `violation(checks, threshold?)` | True when any check is `>= threshold`. Default threshold is `0.7`. Empty input is false. |

## weighted versus violation

**weighted** is for compensating preferences. A strong signal can make up for a weaker one; the result is one probability you can threshold.

**violation** is an any-serious-violation rule. One check clearing the threshold is enough. A pile of mild checks does not add up. That is deliberate: do not average harm signals.
