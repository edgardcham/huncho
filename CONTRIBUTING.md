# Contributing to huncho

huncho is built as deep modules delivered in tracer bullets. This file is the working agreement. Read it before writing code; every PR is reviewed against it.

## Vocabulary

Use these words exactly.

- **Module**: anything with an interface and an implementation. A function, a file, a package.
- **Interface**: everything a caller must know to use the module correctly. The signature, but also invariants, ordering, error modes, configuration, cost.
- **Implementation**: what is inside the module.
- **Seam**: the place where a module's interface lives, and where behaviour can be swapped without editing callers.
- **Adapter**: a concrete thing that satisfies an interface at a seam.
- **Depth**: how much behaviour a caller gets per unit of interface they must learn. Deep is good.

Do not say component, service, API, or boundary.

## Rules

1. **Depth is at the interface.** Small interface, lots hidden. Internals may be as busy as they need to be.
2. **The interface is the test surface.** Tests cross the same seam callers do. If a test has to reach inside, the module is the wrong shape. Fix the shape, not the test.
3. **One adapter is a hypothetical seam. Two adapters is a real one.** Do not add a seam until something actually varies across it.
4. **Accept dependencies, return results.** Modules take collaborators as parameters and return values. Side effects live at the edges: transport and the file journal.
5. **The deletion test.** If deleting a module makes complexity vanish, it was a pass-through. Delete it.
6. **Tracer bullets.** Each milestone is a vertical slice that ends usable, tested and publishable. No horizontal layers built ahead of a slice that needs them.
7. **No vendor names above the Model seam.** Nothing in policy, orchestration, journal, replay or calibration may know which vendor answered.
8. **Zero runtime dependencies.** CI enforces it.

## Module map

```
                    ┌──────────────────────────────────────┐
  user code ──────▶ │  Huncho (orchestrator)               │
                    │  decide(input, { key }) → Decision   │
                    └───┬─────────┬──────────┬─────────┬───┘
                        │         │          │         │
                   Shape│    Policy│   Journal│    Model│   ◀── public seams
                        ▼         ▼          ▼         ▼
                     pure      pure    memory | file   HTTP provider | custom
                                                            │
                                                     Transport + Wire   ◀── internal seam
                                                            │
                                               systemone | gateway | (future vendors)
  Replay and Calibrate are pure functions over JournalRecord[] and Policy. They never touch a Model.
```

The full description of each module, its interface and what it hides lives in the Linear project document "Architecture: modules and seams". Tickets link to it.

## Naming

The product, the package and the orchestrator are all **huncho**: `huncho("support.route", { model })` returns a `Huncho`. The concept it models is a hunch, a probability with a policy attached. Use `huncho` for identifiers; use "hunch" only in prose about the concept.

## Workflow

- One ticket, one branch, one PR. Branch names and PR titles describe the change; they never carry a ticket id, and the PR body never references the tracker. The ticket links to the PR, not the other way round.
- PRs target `main`. Nothing is pushed to `main` directly.
- A PR merges only when CI is green, the code review bot (CodeRabbit) has posted its review of the head commit with no open findings, and every review thread is resolved. A review of an older commit never counts. Whoever opened the PR runs that loop to completion and then squash-merges it. Once merged, the ticket is moved to Done with the PR attached.
- Commit messages describe the change. No tool, assistant or generator references anywhere in the repo, commits or PRs.
- A PR that needs to change a module outside its ticket stops and says so in the PR description. That is a design signal, not an obstacle to route around.

## Ticket template

Every ticket carries: **Module**, **Interface**, **Hides**, **Tests**, **Acceptance**. A PR mirrors the first four headings.

## Tests

- `node:test`, compiled by `tsc`. No test framework.
- Unit tests never touch the network. Transport is tested with an injected `fetch`; everything above the Model seam with a scripted model.
- Every public export carries JSDoc with an `@example` in a fenced `ts` block. `test/jsdoc.test.ts` extracts every example under `src/` and compiles it against the built declarations, importing by package name as a caller would; `npm run docs` fails on an export without a comment. A new export ships with its docs in the same PR.
- Live tests are gated by environment keys (`TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, `AI_GATEWAY_API_KEY`) and skip cleanly when absent. Put keys in `.env.local` at the repo root (gitignored); `npm test` loads it when present.
- Vendor dialects are specified by fixtures under `fixtures/wires/`. Policy semantics are specified by `fixtures/policy/*.json`; those files are the spec a port in another language must pass. Each file is `{ clauses, sequence }`. A clause is `numeric` (`select` key, `enter`, optional `exit`, `outcome`), `boolean` (`test` key, optional `exit` key, `outcome`), or `else` (`outcome`). `answers` is a flat object of numbers and booleans; a numeric `select` reads a number, a boolean `test` or `exit` reads a boolean. Each sequence step is `{ answers, previous?, expect }`. Same clauses and answers, same outcome.

## Reference spike

Branch `spike/reference` holds an unstructured first pass at the whole SDK. It is a reference for wire formats and edge cases, not a source to copy. It uses older names and folds Policy into the orchestrator, which the tickets deliberately separate. Do not merge it.

## Docs

The site at [edgardcham.github.io/huncho](https://edgardcham.github.io/huncho/) is built from the repo, never written beside it. A page is a markdown file under `docs/` with `title` and `description` in its frontmatter and no top-level heading; the site reads it in place and GitHub renders it as it is. Links between pages are repo-relative, `policy.md#clauses` or `../providers.md#keys`, and become site URLs at build time; a link to any other file in the repo becomes its GitHub URL, and a link to a file that does not exist fails the build. The cookbook pages under `docs/site/src/content/docs/cookbook/` embed `examples/*.ts`, with the `../src/index.js` import shown as `huncho` the way a caller writes it, and the API reference is generated from the declarations by the same `typedoc.json` as `npm run docs`. Error messages in `src/` point at `docs/<page>.md#<anchor>` on GitHub; keep those anchors when you move a section.

`docs/site` is a Starlight project with its own `package.json`, so the root package stays zero-dependency. `.github/workflows/pages.yml` builds it on every pull request as a check and publishes it to GitHub Pages on a push to `main`; the build output is never committed.

## Releasing

Laptops never publish. A release is a version bump merged to `main` and a tag that CI turns into an npm publish. Which number to bump is decided by [docs/stability.md](docs/stability.md): compatible additions are minor, a removed or renamed export, a changed default or changed fixture output is major, and nothing on the surface changes in a patch.

1. Open a PR that bumps `version` in `package.json` and `VERSION` in `src/index.ts`, and adds the entry to `CHANGELOG.md`. Merge it.
2. On `main`, tag that commit `vX.Y.Z` with the same version and push the tag.
3. `.github/workflows/release.yml` runs the tests, checks that the tag matches `package.json`, and runs `npm publish`. It authenticates as a trusted publisher through GitHub's OIDC token, so there is no npm token anywhere and provenance is attached automatically.

The same workflow runs `npm publish --dry-run` on pull requests that touch it, so a change to the release steps is exercised before a tag fires them. `actionlint` checks every workflow file in CI.

## Public API

0.1.0 froze the public surface: everything exported from `huncho` and `huncho/testing`, JournalRecord v1 ([docs/journal.md](docs/journal.md)), and the fixture formats under `fixtures/wires/` and `fixtures/policy/`. The entries `huncho/jev`, `huncho/openrouter`, `huncho/gateway`, `huncho/node` and `huncho/otel` joined that surface afterwards and are frozen the same way. [docs/stability.md](docs/stability.md) is the policy for that surface: what a version number means, how an export is deprecated before it is removed, and which Node lines are supported.

The Python port ([README](README.md#packages)) starts only from this frozen surface. It is written against the same fixtures and JournalRecord v1, so a journal written by one port replays in the other.

## Commands

```
npm ci
npm test            # build + tests
npm run build
npm run docs        # API reference from the declarations, into docs/api/
npm pack --dry-run  # what ships
npm ci --prefix docs/site && npm run build --prefix docs/site   # the docs site, into docs/site/dist/
```
