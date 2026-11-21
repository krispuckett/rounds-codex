// A first launch on an empty canvas can bring in the pushes to main from the last 30 days, in
// every repo a Claude session worked in. Nothing leaves the machine: the folders come from the
// sessions' own records, the pushes from git's log of the remote branch (each `git push`
// leaves a dated entry there). Each becomes a push record, the same as the git hook writes.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { PUSHES } from "./config.mjs";

const DAYS = 30;
const git = (cwd, ...a) => { try { return execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000 }).trim(); } catch { return ""; } };

// one entry per repo, however many folders and worktrees the sessions ran in
function repos(cwds) {
  const seen = new Map();
  for (const cwd of new Set(cwds)) {
    if (!cwd || !fs.existsSync(cwd)) continue;
    const common = git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
    if (!common || seen.has(common)) continue;
    // the repo's own folder (a worktree's name would make a project of its own)
    const top = path.basename(common) === ".git" ? path.dirname(common) : git(cwd, "rev-parse", "--show-toplevel");
    if (top) seen.set(common, top);
  }
  return [...seen.values()];
}

// each push to main since then, from the remote branch's log: cheap, just the log itself
function pushesIn(repo, since) {
  const main = git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").split("/").pop()
    || ["main", "master"].find((b) => git(repo, "rev-parse", "--verify", "-q", `refs/remotes/origin/${b}`));
  if (!main) return [];
  // newest first: "<sha>\t<ref>@{<unix time>}\t<what moved it>"
  const log = git(repo, "reflog", "show", "--date=unix", "--format=%H%x09%gd%x09%gs", `refs/remotes/origin/${main}`)
    .split("\n").filter(Boolean).map((l) => { const [sha, sel, what] = l.split("\t"); return { sha, at: Number(sel.match(/@\{(\d+)\}/)?.[1] || 0) * 1000, what: what || "" }; });
  const out = [];
  for (let i = 0; i < log.length && log[i].at >= since; i++) {
    if (log[i].what.startsWith("update by push")) out.push({ repo, branch: main, sha: log[i].sha, prev: log[i + 1]?.sha, at: log[i].at });
  }
  return out;
}

// a push in full: its commits and the files they touched (null when the commits are gone)
function detail({ repo, branch, sha, prev, at }) {
  const range = prev ? `${prev}..${sha}` : sha;
  const commits = git(repo, "log", "--format=%h%x09%s", "-n", "50", ...(prev ? [range] : ["-1", sha])).split("\n").filter(Boolean)
    .map((l) => { const [s, ...rest] = l.split("\t"); return { sha: s, subject: rest.join("\t") }; });
  if (!commits.length) return null;
  const files = prev ? git(repo, "diff", "--name-only", prev, sha).split("\n").filter(Boolean).slice(0, 200) : [];
  return {
    id: crypto.createHash("sha1").update(`${repo}${range}`).digest("hex").slice(0, 16),
    repo, branch, range, commits, files, at,
    summary: commits.length === 1 ? commits[0].subject : `${commits.length} commits to ${branch}`,
  };
}

// What there is to bring in, from the folders the sessions ran in.
export function pastPushes(cwds, days = DAYS) {
  const since = Date.now() - days * 864e5;
  return repos(cwds).flatMap((r) => pushesIn(r, since));
}

// Writes them where the git hook writes, so the indexer shows them the same way. `keep` says
// which to leave out (the private filter).
export function importPushes(found, keep = () => true) {
  fs.mkdirSync(PUSHES, { recursive: true });
  let added = 0;
  for (const f of found) {
    const x = detail(f);
    if (!x || !keep(x)) continue;
    const file = path.join(PUSHES, `${x.id}.json`);
    if (fs.existsSync(file)) continue;
    fs.writeFileSync(file, JSON.stringify(x, null, 1));
    added++;
  }
  return added;
}
