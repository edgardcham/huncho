---
title: Stability
description: What is public, what a version number means, how an export is deprecated before it is removed, fixtures as the contract, Node support.
---

What can change between versions of `huncho`, and how you will hear about it.

## What is public

The public surface is everything exported from a documented entry. The entries are the `exports` map in `package.json`: `huncho`, `huncho/jev`, `huncho/openrouter`, `huncho/gateway`, `huncho/node`, `huncho/otel` and `huncho/testing`. A name you can import from one of those is public, and every rule below applies to it. Types count: a change to an exported type that stops existing calling code from compiling is treated the same as a change to a function.

Anything under `src/` that is not re-exported from an entry is internal. Transport, the wires and the response normalisers live there. A deep import such as `huncho/dist/src/transport.js` is not supported and may change in any release.

Two contracts are public and outlive the TypeScript code:

- **JournalRecord v1**, the record every decision writes, specified in [journal.md](journal.md).
- **The fixtures** under `fixtures/wires/` and `fixtures/policy/`, specified in [wires.md](wires.md) and [policy.md](policy.md).

Documented defaults are part of the surface too: the environment variable each provider reads, its default URL and default model id ([providers.md](providers.md)), the retry schedule, and `exit` defaulting to `enter` in a numeric clause. A program written against a default keeps working until a major.

## What a version number means

Versions follow [semver](https://semver.org). For this package:

| Change | Version |
| --- | --- |
| A new export, a new optional option, a new optional field on a result | minor |
| A new JournalRecord field | minor |
| A new wire, with its own fixture directory | minor |
| An export deprecated as described below | minor |
| A fix that brings behaviour in line with what the docs and fixtures already say | patch |
| A removed or renamed export | major |
| A changed default | major |
| A renamed or removed JournalRecord field, or a change to how one is computed | major |
| A change to the expected output of any fixture | major |
| Raising the minimum Node version | major |

Nothing on the public surface changes in a patch. A patch fixes behaviour that contradicted the docs or the fixtures; it adds nothing and takes nothing away.

The JournalRecord rule from [journal.md](journal.md), restated: adding a field is a minor version and old readers keep working; renaming or removing a field is a major version and every reader and writer upgrades together. There is no version field on the record. The document version is the contract.

## Deprecation

An export is never removed without first being deprecated in a released minor. The minor that deprecates it:

- tags the declaration `@deprecated`, naming the replacement, so editors strike it through and the API reference lists it as deprecated;
- warns once per process, on first use, with `console.warn`, naming the export and the replacement;
- records it in `CHANGELOG.md` under **Deprecated**;
- keeps it working exactly as before.

Only a major removes it, and only after at least one released minor has carried the deprecation; every release between the two keeps it working. The major records the removal under **Removed**. A type has no runtime, so it gets the tag and the changelog entry and no warning.

## Fixtures are the contract

`fixtures/wires/<wire>/<case>.json` specifies each vendor dialect: the request huncho sends and the answers it decodes from the response. `fixtures/policy/<case>.json` specifies policy semantics: same clauses, same answers, same outcome. The TypeScript tests run every file; a port in another language passes the same files unchanged, and a journal written by one port replays in the other.

A change to the expected output of any fixture is a breaking change by definition, whatever the reason. That includes correcting a fixture that turns out to be wrong: journals written and outcomes decided under the old file differ from those under the new one, so the correction is a major. Adding a case that the current implementation already passes is not a change to the contract; it pins behaviour that was already there.

## Node

huncho supports the Node LTS lines from the floor in `package.json` `engines.node` upward, and CI runs the test suite on each of them. Support for a line is dropped only in a major, even after Node itself stops maintaining it. Adding a line is a minor.

Every entry but `huncho/node` is written against standard JavaScript and `fetch`; `huncho/node` is the file journal, and it imports `node:fs/promises` on first use. Other runtimes are not in CI and are not covered by this policy.

## How you hear about it

`CHANGELOG.md` records every change to the public surface, by version, under **Added**, **Changed**, **Deprecated**, **Removed** and **Fixed**. The `vX.Y.Z` tag on `main` is the release; the changelog entry is the notice. A deprecation also announces itself at runtime, once, the first time the deprecated export is used.
