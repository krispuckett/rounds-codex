import fs from "node:fs";
import path from "node:path";
import os from "node:os";
export const HOME = os.homedir();
export const DATA = path.resolve(process.env.ROUNDS_CODEX_HOME || path.join(HOME, ".rounds-codex"));
export const CODEX = path.resolve(process.env.ROUNDS_CODEX_SOURCE || process.env.CODEX_HOME || path.join(HOME, ".codex"));
export const STORE = path.join(DATA, "store");
export const IMG = path.join(STORE, "img");
export const POSTS = path.join(DATA, "posts");
export const PUSHES = path.join(DATA, "pushes");
export const CONFIG = path.join(DATA, "config.json");
export function loadConfig() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CONFIG, "utf8")); } catch {}
  return { projects: [], private: [], folders: true, home: "Studio", ...c,
    port: Number(process.env.ROUNDS_CODEX_PORT || c.port || 4798), relay: false };
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
