# Working on huncho

Read `CONTRIBUTING.md` first. It is the working agreement and is short.

## What this is

huncho is a TypeScript SDK that makes a probabilistic decision a first-class object: typed questions, thresholds with hysteresis, nested decisions, a journal, replay without inference, calibration. Decision models are providers behind one seam (TypeSafe Jev direct, OpenRouter, Vercel AI Gateway, custom).

## How to take a ticket

1. Tickets live in Linear, team Huncho, project "huncho 0.1". Take the lowest-numbered unblocked ticket in the earliest open milestone unless told otherwise.
2. The ticket names the module, its interface, what it hides, the tests, and acceptance. Build exactly that. If the ticket cannot be done without changing another module, stop and say so in the PR.
3. Branch from `main` with a short descriptive branch name. Do not use the ticket id in the branch name, the PR title or the PR body. One ticket per PR.
4. Run `npm test` before pushing. Unit tests must not touch the network.
5. Open a PR against `main` with the template filled in. The title describes the change.
6. Babysit the PR: wait for CI and for Greptile's review of the head commit. For every comment, fix it in a new commit or reply with a precise reason and resolve the thread. Push and wait for the re-review. Repeat until CI is green, Greptile scores 5/5 on the head commit and no thread is unresolved. Then squash-merge the PR yourself, move the ticket to Done in Linear with the PR attached, and stop. Cap: 6 review rounds or 90 minutes; past that, stop and report what is still open instead of merging.

## Hard rules

- Zero runtime dependencies. CI fails otherwise.
- No vendor names above the Model seam.
- Tests cross the module's interface. Never reach inside.
- Identifiers are `huncho` / `Huncho`. Errors are `HunchoError`.
- No tool, assistant or generator references in code, comments, commits or PRs.
- Keep the core runtime-agnostic: Node-only APIs are imported lazily inside adapters that need them.

## Where things are

- `src/` modules, one per file, named after the module.
- `test/` node:test files, one per module, plus fixture runners.
- `fixtures/wires/<wire>/` and `fixtures/policy/` are contracts; add cases when you add behaviour.
- `docs/` per-topic notes tickets ask for.
- Branch `spike/reference`: a rough first pass. Useful for wire formats. Not for copying.

## Commands

```
npm ci && npm test
```
