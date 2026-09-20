# Changelog

Every change to the public surface of the `huncho` package, by version, under **Added**, **Changed**, **Deprecated**, **Removed** and **Fixed**. What the surface is and what a version number means are defined in [docs/stability.md](docs/stability.md).

## Unreleased

### Added

- `id` on `Decision` and `JournalRecord`: a UUID minted inside `decide`, unique per decision and the same on the record it wrote, so a record can be joined to ground truth by `id` alone. `parentId` on both: the `id` of the decision that chose this one, present on every child in a tree, speculative or not, and absent on a root, so a tree can be reassembled from `parentId` alone.
- `via` on `Decision`, `JournalRecord` and each `replay` result: `enter` when a clause entered on its own, `hold` when a clause held the previous outcome by hysteresis, `else` when the fallback covered it. A replay diff can now say "held before, enters now". Policy fixture steps take an optional `via` that the runner checks when present; the four shipped fixtures pin it, with no change to any expected outcome.
- `JournalRecord` v1 gains the three fields above, a minor per the stability policy. Journals written by 0.3 lack them and still replay.
- `previous` on `decide(input, { previous })`: the held outcome for this call, from a store of the caller's own. A string replaces what the huncho remembers for the key, `null` says there is no previous; `decision.previous` reports what was used, and a supplied hold is `via: "hold"` like a remembered one. Hysteresis now survives a restart by handing back the outcome stored under the key, so no store seam is needed.
- `memory` on `huncho(name, { memory })`: how many keys' held outcomes the huncho keeps, least recently used going first. `10_000` by default; `0` keeps none. A `ConfigError` for anything but a non-negative integer.
- Labels: `Label` (`{ id, t, truth, note? }`, what actually happened for the decision whose `id` it names, `truth` in the shape of the question judged) and the `Labels` seam (`write`, `read`) with two adapters, `memoryLabels()` and, from `huncho/node`, `fileLabels(path)`, append-only JSONL serialised and read the way `fileJournal` is. The root entry re-exports both.
- `calibrate` takes a `Labels` or a `Label[]` as `outcome`, beside the callback it took before, and joins records to labels by `id`: the latest `t` per id wins, an unlabelled record is skipped, a `noul` scores the boolean `truth`, a `choice` or `score` scores `truth === label`. A `truth` of the wrong shape for its question is an `AnswerError` naming the id. With a `Labels` store the result is a `Promise<Calibration>`; the other two forms still return the `Calibration` itself.
- `sweep(records, huncho, { outcome, enter, exit?, labels? })`: which threshold to pick, from the journal. Every candidate `enter` paired with every candidate `exit` on one numeric clause, each a `replay` through `huncho.with()` so hysteresis chains per key, tabulated as `{ enter, exit, current, n, chosen, flaps }` plus `precision`, `recall` and `f1` when labels are given, and `best`, the max-f1 row with ties to fewer flaps. Candidates are listed or walked as `{ from, to, step }`; pairs with `exit` above `enter` are left out; the configured thresholds are always the `current` row. `labels` takes the three shapes `calibrate` takes, a `truth` read as whether the decision should have been `outcome`. `Sweep`, `SweepOptions` and `Candidates` are exported with it.

### Changed

- A huncho's hysteresis memory is bounded at `10_000` keys where it was unbounded; a long-lived process keying on ticket or user ids no longer grows without limit. A key dropped from memory decides as if for the first time, so pass `previous` from your own store where a hold must outlive the bound.

## 0.3.0 — 2026-09-19

### Added

- `onDecision` on `huncho()`: called with the decision `decide` returns, after that huncho's journal write, once per huncho in a tree (a child with its own decision, before its parent). A hook that throws, or returns a promise that rejects, is reported on `console.error` and the decision stands. `evaluate` and a rejected `decide` never call it.
- `huncho/otel`, exporting `withTracing(huncho, tracer)`: one span per `decide`, named after the huncho, carrying `huncho.outcome`, `huncho.provider`, `huncho.model`, `huncho.ms`, `huncho.usage.input_tokens` and `huncho.usage.output_tokens`; a rejected `decide` records the exception and an error status on the span and rethrows. The tracer is typed by shape (`Tracer` and `Span` are exported, as is `Decider`, what `withTracing` takes and returns), so an OpenTelemetry tracer fits and nothing is imported from it. The root entry re-exports `withTracing`.
- The docs site at [edgardcham.github.io/huncho](https://edgardcham.github.io/huncho/), built from `docs/`, `examples/` and the declarations on every push to `main`: getting started, one page per concept and per provider, the examples as cookbook pages, the API reference and the stability policy. The README now points there; the markdown under `docs/` is the source and still renders on GitHub.

### Fixed

- `scriptedModel`'s documentation said its results carry `ms: 0`. The value is measured, so it is near-zero rather than exactly zero; the comment says so now.

## 0.2.0 — 2026-09-19

### Added

- JSDoc on every public export: a summary, the invariants a caller must hold, `@throws` naming the error class, and an `@example` that compiles. The examples are extracted and type-checked in CI, and `npm run docs` fails on an undocumented export.
- Subpath entries along the seams: `huncho/jev`, `huncho/openrouter` and `huncho/gateway` export one provider each (`createX` and the ready-made `x`); `huncho/node` exports `fileJournal` and `readJournal`, the only code that touches Node APIs. The root entry still re-exports everything, so no 0.1 import changes. Every entry but `huncho/node` loads where `node:` modules cannot be resolved.
- `docs/stability.md`: what is public, what a version number means, how an export is deprecated before it is removed, fixtures as the behavioural contract, and which Node lines are supported.
- Typed errors. `ConfigError` (setup: a missing or empty key, thresholds that are not finite or have `exit` above `enter`, a builder called out of order, a bad `score()`, `calibrate()`, `weighted()` or `scriptedModel` argument), `ProviderError` (a model failed to answer; carries `provider`, `retryable`, optional `status`, `requestId`, `body`, `cause`), `PolicyError` (no clause matched and no `else`; names the huncho) and `AnswerError` (a question has no answer or a malformed one; names the question). All extend `HunchoError`.
- `isInstance(e)` on `HunchoError` and every subclass narrows `unknown` to that class without a cast, and holds across bundles and duplicated copies of the package where `instanceof` fails.
- Every message huncho throws names the fix and ends with a pointer into the docs.
- Numeric policy thresholds are checked when declared, in `when()` and in `with()`: `enter` and `exit` must be finite and `exit` at most `enter`.
- Transport failures say whether a retry can help: `ProviderError.retryable` is `true` for a retryable status or a network failure once retries are spent, `false` for any other status and for a response that does not decode.

### Changed

- Node 22 or later (`engines.node` is `>=22`); CI runs the suite on 22 and 24.
- `HunchoError` is now the lean base. `provider`, `status`, `requestId` and `body` live on `ProviderError`, which is what transport, the wires and `createProvider` throw; read them after `ProviderError.isInstance(e)`. Code that only catches `HunchoError` is unchanged. Code that constructed `new HunchoError(message, { provider, … })`, as a custom wire might, constructs `ProviderError` with `retryable` instead.
- Failures that were bare `Error`s (no outcome, no answer, no questions, bad `score()`, `calibrate()` and `weighted()` arguments) are now the `HunchoError` subclasses above.
- A 2xx response whose body is not JSON is a `ProviderError` with `retryable: false`, carrying the status, the request id and the first 300 characters of the body, with the parser's error as `cause`. It used to escape as the parser's own `SyntaxError`.
- A `noul` answer outside `[0, 1]`, or not a finite number, is an `AnswerError` naming the question, from `wrapAnswers` and so from `ask`, `decide`, `evaluate` and `replay`. It matches what a score outside the rubric already did; before, `p` surfaced the value as it came.

### Fixed

- `apiKey` on `JevOptions`, `OpenRouterOptions` and `GatewayOptions` is `string | undefined`, so `createJev({ apiKey: process.env.MY_JEV_KEY })` compiles under `exactOptionalPropertyTypes` as the README writes it. Resolution is unchanged: `undefined` and `""` fall back to the environment variable.

## 0.1.0 — 2026-09-19

First full release. Everything 0.0.1 exported is unchanged; the rest of the SDK arrives around it.

### Added

- `huncho(name, { model, journal? })`: a named decision built from `.shape()`, `.ask()`, `.when()`, `.else()`, `.with()` and `.branch()`, decided with `.decide(input, { key?, signal? })` or evaluated without a policy with `.evaluate(input)`. `Decision` carries the outcome, typed answers, raw answers, state hash, key, previous outcome, path, child, usage, timing, provider and model.
- Policy: boolean clauses with an optional `exit` test, numeric clauses with `enter` and `exit` thresholds (hysteresis), `else`, and `with(overrides)` for a copy with different thresholds. The outcome union is inferred from the clauses. `policy(name)` is exported for use outside a huncho. Semantics are specified by `fixtures/policy/*.json`.
- Hysteresis memory per `key`: a held outcome persists while its exit condition holds and no earlier clause enters.
- Compose helpers for policy clauses: `all`, `any`, `weighted`, `uncertain`, `violation`.
- Nested decisions: `.branch({ [outcome]: childHuncho | null })`. A child with its own `shape` gets its own model call; one without inherits the parent's state. `Decision.path` records the descent and `Decision.child` holds the child's decision. `{ speculative: true }` asks unshaped children's questions in the parent's request so a tree costs one round trip.
- Journal seam: `Journal { write, read }`, `memoryJournal()`, `fileJournal(path, { includeState? })` (append-only JSONL, writes serialised in order, Node imported lazily on first use so the core stays runtime-agnostic), `readJournal(path)`, `stableStringify` and `sha256`. Every decision writes a JournalRecord v1.
- `replay(records, huncho)`: re-runs the current policy over journaled answers, chaining hysteresis per key in record order, with no model call. Returns per-record results, the count that changed and outcome totals.
- `calibrate(records, { question, label?, outcome, buckets? })`: Brier score against the base rate, a reliability table and accuracy by confidence band for journaled probabilities.
- `shape(obj).pick().omit().rename().redact().truncate().add().build()` for trimming what the model sees.
- Providers: `createOpenRouter` / `openrouter` (`OPENROUTER_API_KEY`) on the `systemone` wire, `createGateway` / `gateway` (`AI_GATEWAY_API_KEY`) on the new `gateway` wire, and `createProvider({ name, defaultModel?, evaluate })` for in-process or custom models.
- `huncho/testing` subpath export with `scriptedModel(script)` so decisions are testable without a network.
- Wire conformance fixtures under `fixtures/wires/<wire>/` and a shared runner; each vendor dialect is specified by data.
- Docs: `docs/policy.md`, `docs/journal.md`, `docs/calibration.md`, `docs/providers.md`, `docs/wires.md`; `npm run docs` generates the API reference. Runnable examples under `examples/`.
- Releases are published from CI on a `vX.Y.Z` tag with npm provenance; nothing is published from a laptop.

### Changed

- The public API is frozen at 0.1. Additions land in a minor version with an entry here; nothing on the surface changes in a patch. The Python port starts from this surface and the fixtures.

## 0.0.1 — 2026-09-19

### Added

- `ask(model, state, questions, { signal? })` returns typed answers for `noul`, `choice` and `score` questions.
- Question builders `noul`, `choice`, `score` and `wrapAnswers`; `Answers<Q>` infers answer types from the questions.
- Model seam: `Model.evaluate({ state, questions, signal? })` with canonical answers, usage, timing, provider and model id. Failures reject with `HunchoError` carrying `provider`, `status`, `requestId`, `body` and `cause`.
- `createJev` / `jev` provider (`TYPESAFE_API_KEY`) on the `systemone` wire. Transport retries `408`, `429`, `500`, `502`, `503` and `529` with exponential backoff capped at 8 s, never other `4xx`, and honours `AbortSignal` during requests and backoff.
- Zero runtime dependencies. ESM only. Node 24 or later.
