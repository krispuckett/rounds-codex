// Where Rounds keeps things, and how it decides what a piece of work belongs to.
//
// ~/.rounds/config.json (every field optional):
//   {
//     "projects": [{ "key": "shop", "name": "Shop", "match": ["shop", "storefront"] }],
//     "private": ["acme-internal"],   // anything matching never reaches the canvas
//     "folders": true,                // unmatched work is named for its repo folder
//     "home": "Studio",               // the name for work with no project (a home folder)
//     "port": 4797,
//     "relay": false                  // Claude desktop app: a relay session delivers notes at once
//   }
// A project is matched by its rules first (thread name, folder, caption), then, with "folders"
// on, by the git repo (or folder) the session ran in.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Overrides are ROUNDS_HOME, ROUNDS_CLAUDE_HOME, ROUNDS_DESKTOP_SESSIONS, ROUNDS_PORT and
// ROUNDS_BROWSER. The WORKBENCH_ names from before the name Rounds still work; both are set
// alike here, so every part reads the same value.
for (const k of ["HOME", "CLAUDE_HOME", "DESKTOP_SESSIONS", "PORT", "BROWSER"]) {
  const v = process.env[`ROUNDS_${k}`] ?? process.env[`WORKBENCH_${k}`];
  if (v != null) process.env[`ROUNDS_${k}`] = process.env[`WORKBENCH_${k}`] = v;
}

export const HOME = os.homedir();
// ~/.rounds, or ~/.workbench for an install from before the name, so nothing has to move
const at = (n) => path.join(HOME, n);
export const DATA = process.env.ROUNDS_HOME || (!fs.existsSync(at(".rounds")) && fs.existsSync(at(".workbench")) ? at(".workbench") : at(".rounds"));
export const CLAUDE = process.env.ROUNDS_CLAUDE_HOME || path.join(HOME, ".claude");
export const DESKTOP_SESSIONS = process.env.ROUNDS_DESKTOP_SESSIONS || path.join(HOME, "Library/Application Support/Claude/claude-code-sessions");
export const STORE = path.join(DATA, "store");
export const IMG = path.join(STORE, "img");
export const POSTS = path.join(DATA, "posts");
export const PUSHES = path.join(DATA, "pushes");
// each page as the tool hook caught it the moment it was published: <artifact id>.json
export const PUBLISHED = path.join(DATA, "published");
export const CONFIG = path.join(DATA, "config.json");

const DEFAULTS = { projects: [], private: [], folders: true, home: "Studio", port: 4797, relay: false };

export function loadConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CONFIG, "utf8")); } catch {}
  return { ...DEFAULTS, ...c };
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "work";

// The repo a folder belongs to: the nearest parent holding .git, else the folder itself.
function repoOf(dir) {
  let d = dir;
  for (let i = 0; i < 12 && d && d !== path.dirname(d); i++) {
    if (fs.existsSync(path.join(d, ".git"))) return d;
    d = path.dirname(d);
  }
  return dir;
}

/** One function for every caller: which project a thing belongs to, and every project's name. */
export function projects(cfg = loadConfig()) {
  const rules = (cfg.projects || []).map((p) => ({ key: p.key || slug(p.name), name: p.name, re: new RegExp((p.match || [p.name]).join("|"), "i") }));
  const priv = (cfg.private || []).length ? new RegExp(cfg.private.join("|"), "i") : null;
  const names = new Map(rules.map((r) => [r.key, r.name]));
  names.set("studio", cfg.home);
  const repoCache = new Map();
  return {
    names,
    isPrivate: (...texts) => !!priv && priv.test(texts.filter(Boolean).join(" ")),
    of(texts, cwd) {
      const t = [...texts, cwd].filter(Boolean).join(" ");
      for (const r of rules) if (r.re.test(t)) return r.key;
      if (!cfg.folders || !cwd || path.resolve(cwd) === HOME) return "studio";
      let repo = repoCache.get(cwd);
      if (!repo) { repo = repoOf(cwd); repoCache.set(cwd, repo); }
      if (path.resolve(repo) === HOME) return "studio";
      const name = path.basename(repo);
      const key = slug(name);
      if (!names.has(key)) names.set(key, name);
      return key;
    },
  };
}
