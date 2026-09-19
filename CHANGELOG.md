# Changelog

Notable changes to the `huncho` package. Versions follow [semver](https://semver.org); the public surface is everything exported from `huncho` and its subpath entries, the JournalRecord v1 contract in [docs/journal.md](docs/journal.md), and the fixture formats under `fixtures/`.

## Unreleased

### Added

- Subpath entries along the seams: `huncho/jev`, `huncho/openrouter` and `huncho/gateway` export one provider each (`createX` and the ready-made `x`); `huncho/node` exports `fileJournal` and `readJournal`, the only code that touches Node APIs. The root entry still re-exports everything, so no 0.1 import changes. Every entry but `huncho/node` loads where `node:` modules cannot be resolved.

### Changed

- Node 22 or later (`engines.node` is `>=22`); CI runs the suite on 22 and 24.

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

- `ask(model, state, questions, { signal? })` returns typed answers for `noul`, `choice` and `score` questions.
- Question builders `noul`, `choice`, `score` and `wrapAnswers`; `Answers<Q>` infers answer types from the questions.
- Model seam: `Model.evaluate({ state, questions, signal? })` with canonical answers, usage, timing, provider and model id. Failures reject with `HunchoError` carrying `provider`, `status`, `requestId`, `body` and `cause`.
- `createJev` / `jev` provider (`TYPESAFE_API_KEY`) on the `systemone` wire. Transport retries `408`, `429`, `500`, `502`, `503` and `529` with exponential backoff capped at 8 s, never other `4xx`, and honours `AbortSignal` during requests and backoff.
- Zero runtime dependencies. ESM only. Node 24 or later.
