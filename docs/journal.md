---
title: Journal and replay
description: The JournalRecord v1 contract every decision writes, the memory and file adapters, and replay, which re-runs a policy over the records with no model call.
---

The journal is a public seam: `write` appends a record, `read` returns every record in write order. Adapters (memory, JSONL file) hide how the bytes sit. Replay and calibrate consume `JournalRecord[]` and never call a model.

```ts
import { huncho, noul } from "huncho";
import { jev } from "huncho/jev";
import { fileJournal } from "huncho/node";

const route = huncho("support.route", { model: jev(), journal: fileJournal("decisions.jsonl") })
  .ask({ urgent: noul("Does this need a human within the hour?") })
  .when((a) => a.urgent.p, { enter: 0.8, exit: 0.6 }, "page")
  .else("wait");
```

Every `decide` on that huncho appends one record. The record is **JournalRecord v1**, the language-neutral contract below: a port in another language must read and write the same fields and produce the same hashes, so a journal written by one port replays in the other.

## Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `t` | yes | ISO-8601 timestamp of the decision. |
| `huncho` | yes | Name of the huncho that wrote the record. |
| `key` | yes | Hysteresis key: the entity the decision is about. |
| `provider` | yes | Model provider id (`Model.provider`). |
| `model` | yes | Model id (`Model.id` / evaluate result `model`). |
| `stateHash` | yes | SHA-256 hex of `stableStringify(state)`. |
| `questionsHash` | yes | SHA-256 hex of `stableStringify(questions)`. |
| `state` | no | The state the model saw. Opt-in; omit unless the caller asked to keep it. Journals can be large and may carry PII. |
| `answers` | yes | Canonical raw answers, one per question, keyed by question id (`noul` \| `choice` \| `score`). |
| `outcome` | yes | Policy outcome of this decision. |
| `previous` | no | Outcome previously held for `key`, if any. |
| `path` | yes | Outcomes from the root huncho down through nested branches. A root-only decision is `[outcome]`. |
| `usage` | yes | `{ inputTokens, outputTokens }`. |
| `ms` | yes | Wall-clock milliseconds for the model call. |

Unknown fields on read must be preserved by an adapter that round-trips bytes (a file journal) and may be ignored by a typed reader.

## Versioning

This is **v1**. Adding a field is a minor version: old readers keep working. Renaming or removing a field is a major version: every reader and writer upgrades together.

There is no version field on the record. The document version is the contract.

## Hashing

`stateHash` and `questionsHash` are lowercase hex SHA-256 of `stableStringify(value)`.

`stableStringify` is JSON with object keys sorted lexicographically at every level. Arrays keep their order. Values that implement `toJSON` (for example `Date`) are reduced once with the JSON property key, the same way JSON reduces them; the replacement is then stringified and is not reduced again. `undefined` object values are omitted, so `{ a: 1, b: undefined }` and `{ a: 1 }` hash equal. Two states that differ only in key order produce the same digest.

The journal stores the hex strings. It does not re-hash on write.

## Memory adapter

`memoryJournal()` is an in-process `Journal` with a `records` array in write order. `write` copies the record in; `read` copies the records out. Nothing is persisted.

## File adapter

`huncho/node` is the entry for the file adapter; the root entry re-exports it.

```ts
import { fileJournal, readJournal } from "huncho/node";
```

`fileJournal(path, { includeState? })` is a `Journal` that appends one JSON object per line. Writes on one adapter are serialised in call order, so concurrent `write`s (as concurrent `decide`s would issue) do not interleave. `read` waits for writes already queued on that adapter.

`state` is omitted from the line unless `includeState` is true.

`readJournal(path)` reads the same JSONL without going through an adapter. A missing file is an empty list. A trailing incomplete line (an interrupted append) is ignored so earlier records stay readable. Replay consumes that list and never opens the file itself.

`node:fs/promises` is imported on the first file read or write, not when `huncho` or `huncho/node` is imported.

## Replay

`replay(records, huncho)` re-applies a huncho's current policy to journal records. There is no model call: the recorded answers are wrapped and decided again, chaining hysteresis per key in record order. Change a threshold with `with()` and replay to see what would move before shipping it.

```ts
import { huncho, replay } from "huncho";
import { readJournal } from "huncho/node";

const stricter = route.with({ page: { enter: 0.9, exit: 0.7 } });
const { n, changed, outcomes, results } = replay(await readJournal("decisions.jsonl"), stricter);

changed;   // how many outcomes would move
outcomes;  // { page: 12, wait: 171 }
results;   // one { record, outcome, changed } per record, in record order
```

Records are matched to the huncho by name; records from other hunchos are skipped. For a key's first record, `previous` is taken from the record; after that, replay chains the outcomes it decides itself, so a run over a whole journal reproduces the hysteresis the policy would have shown live. `n` counts the records replayed.

A record that predates a question the huncho now asks has no answer for it, and wrapping it is an `AnswerError` naming the question; replay only the records that carry it. A record that matches no clause of a policy with no `else` is a `PolicyError`.
