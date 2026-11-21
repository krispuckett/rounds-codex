import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA } from "./config.mjs";

export const TOPICS = path.join(DATA, "topics.json");
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
export const loadTopics = () => readJSON(TOPICS, { projects: {}, moves: {} });

/** A send filed under another project's topic belongs to that project. */
export function applyMoves(index, topics = loadTopics()) {
  const moves = topics.moves || {};
  return { ...index, sets: index.sets.map((s) => (moves[s.id] ? { ...s, project: moves[s.id] } : s)) };
}

// Explicit topics are already supplied by Codex. Historical work uses its chat title.
// Filing is local and never starts an inference request.
export async function fileTopics(index) { filePostTopics(index); return 0; }

/** Posts that named their topic go straight under it: the session knew what it was working on. */
export function filePostTopics(index) {
  const topics = loadTopics();
  let changed = false;
  const held = new Set(Object.values(topics.projects).flat().flatMap((t) => t.sets));
  for (const s of index.sets) {
    if (!s.topic || held.has(s.id)) continue;
    const list = (topics.projects[s.project] ||= []);
    let t = list.find((x) => x.title.toLowerCase() === s.topic.toLowerCase());
    if (!t) list.push((t = { id: crypto.randomUUID().slice(0, 8), title: s.topic.replace(/\s*[\u2014\u2013]\s*/g, ", ").slice(0, 48), sets: [] }));
    t.sets.push(s.id);
    changed = true;
  }
  if (changed) fs.writeFileSync(TOPICS, JSON.stringify(topics, null, 1));
}
