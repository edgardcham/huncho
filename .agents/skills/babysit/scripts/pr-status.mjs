#!/usr/bin/env node
// pr-status: one JSON view of everything a PR needs before it is done — Greptile score and
// unresolved threads, CI checks — plus the actions the loop needs.
// No dependencies. Auth: GH_TOKEN or GITHUB_TOKEN in env, else `gh auth token`.
//
//   node pr-status.mjs status [pr]                 JSON snapshot (exit 0 done, 1 not done)
//   node pr-status.mjs wait [pr] [--timeout 900] [--grace 240] [--no-request]
//        poll until Greptile + checks have reported on HEAD; mentions @greptileai only if
//        Greptile shows no activity on HEAD after --grace seconds (it usually reviews on push)
//   node pr-status.mjs request-review [pr]         comment "@greptileai review"
//   node pr-status.mjs reply <thread-id> <text>    reply inside a review thread
//   node pr-status.mjs resolve <thread-id>...      mark review threads resolved (reply first!)
//   node pr-status.mjs merge [pr]                  squash-merge once status is done; refuses otherwise
import { execSync } from "node:child_process";

const API = "https://api.github.com";
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const VALUE_FLAGS = new Set(["--timeout", "--grace"]);
const pos = args.slice(1).filter((a, i, arr) => !a.startsWith("--") && !VALUE_FLAGS.has(arr[i - 1]));

function sh(c) { return execSync(c, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim(); }
function ghToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return sh("gh auth token"); } catch (e) { console.error(`pr-status: no GitHub token. Set GH_TOKEN or run \`gh auth login\` (gh said: ${String(e.stderr || e.message).trim().split("\n")[0]})`); process.exit(2); }
}
const TOKEN = ghToken();
const remote = sh("git remote get-url origin");
const m = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/); if (!m) { console.error("pr-status: origin is not a GitHub remote"); process.exit(2); }
const [OWNER, REPO] = [m[1], m[2]];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function restRaw(path, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", ...(init.headers || {}) } });
    if ((res.status >= 500 || res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) && attempt < 4) { await sleep(1500 * 2 ** attempt); continue; }
    if (!res.ok) throw new Error(`${init.method || "GET"} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res;
  }
}
async function rest(path, init = {}) { const res = await restRaw(path, init); return res.status === 204 ? null : res.json(); }
// follow Link: rel="next" so PRs with more than 100 comments, reviews or check runs are read completely
async function restAll(path, key = null) {
  let url = path, out = [];
  while (url) { const res = await restRaw(url); const j = await res.json(); out = out.concat(key ? j[key] : j); const next = (res.headers.get("link") || "").match(/<([^>]+)>;\s*rel="next"/); url = next ? next[1] : null; }
  return out;
}
async function gql(query, variables) {
  const res = await fetch(`${API}/graphql`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
  const j = await res.json(); if (j.errors) throw new Error(JSON.stringify(j.errors)); return j.data;
}
async function prNumber() {
  if (pos[0] && /^\d+$/.test(pos[0])) return +pos[0];
  const branch = sh("git rev-parse --abbrev-ref HEAD");
  const prs = await rest(`/repos/${OWNER}/${REPO}/pulls?head=${OWNER}:${branch}&state=open`);
  if (!prs.length) { console.error(`pr-status: no open PR for branch ${branch}`); process.exit(2); }
  return prs[0].number;
}
const RERUN = new Set();
const isGreptile = login => /greptile/i.test(login || "");
const scoreOf = text => { const s = (text || "").match(/Confidence Score:\s*(\d)\s*\/\s*5/i); return s ? +s[1] : null; };

async function snapshot(n) {
  const pr = await rest(`/repos/${OWNER}/${REPO}/pulls/${n}`);
  const head = pr.head.sha;
  const headCommit = await rest(`/repos/${OWNER}/${REPO}/commits/${head}`);
  const headAt = headCommit.commit.committer.date;
  const [comments, reviews, checks] = await Promise.all([
    restAll(`/repos/${OWNER}/${REPO}/issues/${n}/comments?per_page=100`),
    restAll(`/repos/${OWNER}/${REPO}/pulls/${n}/reviews?per_page=100`),
    restAll(`/repos/${OWNER}/${REPO}/commits/${head}/check-runs?per_page=100`, "check_runs"),
  ]);
  // Greptile: the score lives in its summary comment (marker <!-- greptile_summary -->, "Confidence Score: N/5"),
  // edited in place on re-review, so pick the newest by updated_at. Never read the PR description: humans write it.
  const summaries = comments.filter(c => isGreptile(c.user.login) && /<!--\s*greptile_summary\s*-->/.test(c.body || "")).map(c => ({ at: c.updated_at, url: c.html_url, score: scoreOf(c.body) })).filter(c => c.score !== null).sort((a, b) => (a.at < b.at ? 1 : -1));
  const latest = summaries[0] || null;
  const latestBody = latest ? (comments.find(c => c.html_url === latest.url)?.body || "") : "";
  // issues Greptile lists in its summary (some may have no inline thread): "### Issue N" blocks with file:lines and a bold title
  const plain = latestBody.replace(/<[^>]*>/g, "");
  const summaryIssues = [...plain.matchAll(/###\s*Issue\s+(\d+)\s*\n\s*([^\n]+)\n\s*([^\n]+)/g)].map(m => ({ n: +m[1], where: m[2].trim(), text: m[3].trim().slice(0, 300) }));
  // which commit did Greptile actually review? its review objects carry commit_id, and the summary links "Last reviewed commit"
  const reviewShas = reviews.filter(r => isGreptile(r.user.login)).map(r => r.commit_id);
  const summarySha = (latestBody.match(/\/commit\/([0-9a-f]{40})/) || [])[1] || null;
  const reviewedSha = summarySha || reviewShas[reviewShas.length - 1] || null;
  const reviewedHead = !!latest && (summarySha === head || reviewShas.includes(head)); // never inferred from timestamps
  // in progress: 👀 reaction from greptile on the newest @greptileai request, newer than any review
  const requests = comments.filter(c => /@greptileai/i.test(c.body || "")).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  let inProgress = false;
  if (requests[0] && (!latest || requests[0].created_at > latest.at)) {
    const re = await rest(`/repos/${OWNER}/${REPO}/issues/comments/${requests[0].id}/reactions`).catch(() => []);
    inProgress = re.some(x => x.content === "eyes" && isGreptile(x.user.login));
  }
  // unresolved review threads (any author; the loop must answer humans too)
  const threads = []; let cursor = null;
  do {
    const d = await gql(`query($o:String!,$r:String!,$n:Int!,$c:String){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100,after:$c){pageInfo{hasNextPage endCursor}nodes{id isResolved isOutdated path line comments(first:3){nodes{databaseId author{login} body url}}}}}}}`, { o: OWNER, r: REPO, n, c: cursor });
    const rt = d.repository.pullRequest.reviewThreads; threads.push(...rt.nodes); cursor = rt.pageInfo.hasNextPage ? rt.pageInfo.endCursor : null;
  } while (cursor);
  const unresolved = threads.filter(t => !t.isResolved).map(t => { const c0 = t.comments.nodes[0]; return { id: t.id, path: t.path, line: t.line, outdated: t.isOutdated, author: c0?.author?.login, commentId: c0?.databaseId, url: c0?.url, body: (c0?.body || "").slice(0, 600), replies: t.comments.nodes.length - 1 }; });
  const checkRows = checks.map(c => ({ name: c.name, status: c.status, conclusion: c.conclusion, runId: (c.details_url || "").match(/\/actions\/runs\/(\d+)/)?.[1] || null }));
  // a cancelled run on HEAD (for example concurrency cancel-in-progress) is neither green nor a real failure: re-run it once
  // needs a token with Actions read/write; without it the re-run request fails, the run stays cancelled and blocks, and the
  // error is reported so a human can re-run it. Only remembered once the request actually succeeded.
  for (const c of checkRows.filter(c => c.conclusion === "cancelled" && c.runId && !RERUN.has(c.runId))) {
    try { await rest(`/repos/${OWNER}/${REPO}/actions/runs/${c.runId}/rerun`, { method: "POST", body: "{}" }); RERUN.add(c.runId); c.status = "queued"; c.conclusion = null; c.rerun = true; } catch (e) { c.rerunError = e.message.slice(0, 200); }
  }
  const failing = checkRows.filter(c => c.status === "completed" && !["success", "neutral", "skipped"].includes(c.conclusion));
  const pending = checkRows.filter(c => c.status !== "completed");
  const blockers = [];
  if (!latest) blockers.push("greptile has not reviewed yet");
  else if (!reviewedHead) blockers.push(`greptile review is for an older commit (reviewed ${latest.at}, head ${headAt})`);
  else if (latest.score < 5) blockers.push(`greptile score ${latest.score}/5`);
  if (unresolved.length) blockers.push(`${unresolved.length} unresolved review thread(s)`);
  if (!checkRows.length) blockers.push("no checks have reported yet");
  if (failing.length) blockers.push(`failing checks: ${failing.map(c => c.name + (c.rerunError ? ` (cancelled; re-run request failed: ${c.rerunError})` : "")).join(", ")}`);
  if (pending.length) blockers.push(`pending checks: ${pending.map(c => c.name).join(", ")}`);
  return { pr: n, url: pr.html_url, branch: pr.head.ref, head, headAt, greptile: latest ? { score: latest.score, at: latest.at, url: latest.url, reviewedSha, reviewedHead, inProgress, summaryIssues } : { score: null, inProgress, summaryIssues: [] }, unresolved, checks: checkRows, blockers, done: blockers.length === 0 };
}

(async () => {
  if (cmd === "status") { const s = await snapshot(await prNumber()); console.log(JSON.stringify(s, null, 2)); process.exit(s.done ? 0 : 1); }
  if (cmd === "wait") {
    const n = await prNumber(); const timeout = +flag("--timeout", 900) * 1000; const grace = +flag("--grace", 240) * 1000; const t0 = Date.now(); let s, requested = args.includes("--no-request");
    let failures = 0;
    for (;;) {
      try { s = await snapshot(n); failures = 0; } catch (e) { if (++failures > 5) throw e; process.stderr.write(`transient error (${failures}/5): ${e.message}\n`); await sleep(30000); continue; }
      // Greptile reviews on push when configured that way; only nudge it if nothing has happened on HEAD after the grace period
      if (!requested && Date.now() - t0 > grace && !s.greptile.inProgress && !(s.greptile.score !== null && s.greptile.reviewedHead)) {
        await rest(`/repos/${OWNER}/${REPO}/issues/${n}/comments`, { method: "POST", body: JSON.stringify({ body: "@greptileai review" }) });
        process.stderr.write("no Greptile activity on HEAD after the grace period; requested a review\n"); requested = true;
      }
      const settled = s.greptile.score !== null && s.greptile.reviewedHead && !s.greptile.inProgress && s.checks.length > 0 && s.checks.every(c => c.status === "completed");
      if (settled) break;
      if (Date.now() - t0 > timeout) { console.error(`pr-status: timed out after ${timeout / 1000}s; last blockers: ${s.blockers.join("; ")}`); break; }
      process.stderr.write(`waiting: ${s.blockers.join("; ")}\n`); await sleep(30000);
    }
    console.log(JSON.stringify(s, null, 2)); process.exit(s.done ? 0 : 1);
  }
  if (cmd === "request-review") { const n = await prNumber(); await rest(`/repos/${OWNER}/${REPO}/issues/${n}/comments`, { method: "POST", body: JSON.stringify({ body: "@greptileai review" }) }); console.log(`requested Greptile review on #${n}`); process.exit(0); }
  if (cmd === "reply") { const [id, ...text] = pos; if (!id || !text.length) { console.error("usage: reply <thread-id> <text>"); process.exit(2); }
    await gql(`mutation($t:ID!,$b:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$t,body:$b}){comment{url}}}`, { t: id, b: text.join(" ") }); console.log("replied"); process.exit(0); }
  if (cmd === "resolve") { if (!pos.length) { console.error("usage: resolve <thread-id>..."); process.exit(2); }
    for (const id of pos) await gql(`mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}`, { t: id }); console.log(`resolved ${pos.length} thread(s)`); process.exit(0); }
  if (cmd === "merge") { const n = await prNumber(); const s = await snapshot(n);
    if (!s.done) { console.error(`pr-status: not done; blockers: ${s.blockers.join("; ")}`); process.exit(1); }
    const r = await rest(`/repos/${OWNER}/${REPO}/pulls/${n}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "squash" }) });
    if (!r?.merged) { console.error(`pr-status: merge refused: ${JSON.stringify(r).slice(0, 300)}`); process.exit(1); }
    await rest(`/repos/${OWNER}/${REPO}/git/refs/heads/${encodeURIComponent(s.branch)}`, { method: "DELETE" }).catch(() => {});
    console.log(JSON.stringify({ pr: n, url: s.url, merged: true, sha: r.sha, greptile: s.greptile.score })); process.exit(0); }
  console.error("usage: pr-status.mjs status|wait|request-review|reply|resolve|merge"); process.exit(2);
})().catch(e => { console.error(`pr-status: ${e.message}`); process.exit(2); });
