---
name: babysit
description: Mandatory after opening or pushing to a pull request. Wait for Greptile to review, fix or justify every finding, push, and repeat until Greptile scores 5/5 on the head commit with zero unresolved threads and green checks; then squash-merge the PR yourself and move the ticket to Done. Use whenever a PR exists for your branch and before you report the work as done.
---
# Babysit a PR until it is merged

A PR is not done when it is opened, and not done when it is clean. It is done when it is **merged**, which requires all of these on the current head commit:

1. Greptile's latest review scores **5/5**.
2. **Zero unresolved review threads** (Greptile's and humans').
3. All checks are green.

Until then you are not finished, whatever else you have done. Never declare the task complete, hand off, or stop with an open PR unless you hit the limits below and say so explicitly. Never wait for a human to merge: merging is your job.

## The loop

All commands run from the repo root. Call `.agents/skills/babysit/scripts/pr-status.mjs` `PRS` below.

1. **Push** your branch and make sure a PR exists (`gh pr create` if not). The branch name, PR title and body describe the change and never carry a ticket id.
2. **Wait** for the reviewers to report on HEAD: `node PRS wait` (up to 15 minutes). Greptile reviews on every push, so do not mention it yourself; `wait` posts `@greptileai review` only if Greptile shows no activity on HEAD after 4 minutes. It prints a JSON snapshot with `blockers`, `greptile.score`, `greptile.summaryIssues[]` (every issue named in the summary, threaded or not), and `unresolved[]`.
3. **Merge** if `done` is true: `node PRS merge`. It squash-merges and deletes the branch, and refuses if anything is still open. Then move the Linear ticket to Done with the PR attached and one line naming what shipped. Write one line in your final message with the score, the PR URL and the iteration count. You are finished.
4. **Fix** otherwise. Work through every entry in `greptile.summaryIssues[]` and `unresolved[]` (cross-check them: an issue in the summary without a thread still counts). For each, either:
   - change the code, or
   - if the reviewer is wrong or the change is deliberately out of scope, `node PRS reply <thread-id> "<one-line reason>"` and then `node PRS resolve <thread-id>`. Never resolve without replying. Never resolve a thread whose point you have not addressed.
   Read the comment before acting. Greptile inline comments carry a severity (P0, P1, P2); fix P0 and P1 first.
5. **Verify locally** before pushing: `npm test`.
6. **Push** and go back to step 2. Do not post `@greptileai` after a push; `wait` handles it.

## Limits

- Maximum **6 iterations** or **90 minutes** wall clock, whichever comes first. If you reach either, stop, and report exactly what is still open with the current `blockers` list and why you could not clear it. That report is the only acceptable way to finish with an open PR.
- Never force-push, never rewrite history that reviewers have commented on, never resolve threads in bulk to get to zero.
- If two consecutive Greptile reviews raise the same point after you changed the code, stop and ask a human instead of iterating again.

## Reading the snapshot

- `greptile.reviewedHead: false` means the score is for an older commit. Do not trust it; wait or re-request.
- `greptile.inProgress: true` means Greptile has 👀-reacted and is working. Wait.
- `unresolved[].author` tells you who wrote it. A human's thread outranks the bot's.

## Setup notes (once per environment)

- Local machines: `gh auth login` is enough; the script uses `gh auth token`.
- Cloud agents: add a `GH_TOKEN` secret to the environment (fine-grained token for this repo: Pull requests read/write, Contents read/write for the merge, Metadata read, and Actions read/write so cancelled check runs can be re-run). Without the token `node PRS status` exits with code 2 and explains why.
