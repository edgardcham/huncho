# JournalRecord v1

The journal is a public seam: `write` appends a record, `read` returns every record in write order. Adapters (memory now, a file later) hide how the bytes sit. Replay and calibrate consume `JournalRecord[]` and never call a model.

This file is the language-neutral contract. A port in another language must read and write the same fields and produce the same hashes.

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

`stableStringify` is JSON with object keys sorted lexicographically at every level. Arrays keep their order. `undefined` object values are omitted, so `{ a: 1, b: undefined }` and `{ a: 1 }` hash equal. Two states that differ only in key order produce the same digest.

The journal stores the hex strings. It does not re-hash on write.

## Memory adapter

`memoryJournal()` is an in-process `Journal` with a `records` array in write order. `write` copies the record in; `read` copies the records out. Nothing is persisted.
