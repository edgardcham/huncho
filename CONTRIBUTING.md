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
- A PR merges only when CI is green, Greptile scores 5/5 on the head commit, and every review thread is resolved. Whoever opened the PR runs that loop to completion and then squash-merges it. Once merged, the ticket is moved to Done with the PR attached.
- Commit messages describe the change. No tool, assistant or generator references anywhere in the repo, commits or PRs.
- A PR that needs to change a module outside its ticket stops and says so in the PR description. That is a design signal, not an obstacle to route around.

## Ticket template

Every ticket carries: **Module**, **Interface**, **Hides**, **Tests**, **Acceptance**. A PR mirrors the first four headings.

## Tests

- `node:test`, compiled by `tsc`. No test framework.
- Unit tests never touch the network. Transport is tested with an injected `fetch`; everything above the Model seam with a scripted model.
- Live tests are gated by environment keys (`TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, `AI_GATEWAY_API_KEY`) and skip cleanly when absent. Put keys in `.env.local` at the repo root (gitignored); `npm test` loads it when present.
- Vendor dialects are specified by fixtures under `fixtures/wires/`. Policy semantics are specified by `fixtures/policy/*.json`; those files are the spec a port in another language must pass. Each file is `{ clauses, sequence }`. A clause is `numeric` (`select` key, `enter`, optional `exit`, `outcome`), `boolean` (`test` key, optional `exit` key, `outcome`), or `else` (`outcome`). `answers` is a flat object of numbers and booleans; a numeric `select` reads a number, a boolean `test` or `exit` reads a boolean. Each sequence step is `{ answers, previous?, expect }`. Same clauses and answers, same outcome.

## Reference spike

Branch `spike/reference` holds an unstructured first pass at the whole SDK. It is a reference for wire formats and edge cases, not a source to copy. It uses older names and folds Policy into the orchestrator, which the tickets deliberately separate. Do not merge it.

## Commands

```
npm ci
npm test            # build + tests
npm run build
npm pack --dry-run  # what ships
```
