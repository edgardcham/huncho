# Changelog

Every change to the public surface of the `huncho` package, by version, under **Added**, **Changed**, **Deprecated**, **Removed** and **Fixed**. What the surface is and what a version number means are defined in [docs/stability.md](docs/stability.md).

## Unreleased

### Added

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
