#!/usr/bin/env node
// Rounds's MCP server: how a Claude session puts its work on the canvas and hears back.
// Plain JSON-RPC over stdio, no dependencies.
//
//   claude mcp add --scope user rounds -- node /path/to/rounds/bin/rounds.mjs mcp
//
// The session it serves is known without asking: every post is a tool call in that session's
// transcript, and the indexer reads transcripts. Posts land in the data folder's posts/; images and
// pages are copied into the store, so they outlive whatever folder they were saved in.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { execFileSync } from "node:child_process";
import { DATA, STORE, IMG, POSTS, loadConfig, projects } from "./config.mjs";
import { keepImage } from "./indexer.mjs";

const cwd = process.cwd();
const cfg = loadConfig();
const COMMENTS = path.join(DATA, "comments.json");
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
const resolve = (p) => (p.startsWith("~") ? path.join(process.env.HOME || "", p.slice(1)) : path.resolve(cwd, p));

const INSTRUCTIONS = `Rounds is the user's canvas of everything their Claude sessions make. Post to it whenever you
finish visual work worth looking at: screens you built or changed, a page you published, a before and after.
Name a topic for each post: the line of work it belongs to, in plain words, two to five of them, reusing a
topic you or another session already used when it's the same work. Write captions the way you'd tell a
person what changed and why.

When the user leaves a note on your work, it reaches you at the start of your next turn (or call
rounds_notes). Treat a note as a request from the user about that screen, act on it, then answer with
rounds_reply.`;

const TOOLS = [
  {
    name: "rounds_post",
    description: "Put screens (image files) or a page (an HTML file) on the user's Rounds canvas, with a caption and a topic. Post the same HTML path again later and the canvas shows a before and after.",
    inputSchema: {
      type: "object",
      properties: {
        caption: { type: "string", description: "What this shows and what changed, in a sentence or two of plain words." },
        topic: { type: "string", description: "The line of work this belongs to, two to five plain words, e.g. \"Swipe-up card\". Reuse an existing topic for the same work." },
        images: { type: "array", items: { type: "string" }, description: "Image files (png, jpg, webp), absolute or relative to the project." },
        page: { type: "string", description: "An HTML file to show as a page." },
        before: { type: "array", items: { type: "string" }, description: "Optional before images, one per image in the same order, for a before and after." },
        replaces: { type: "string", description: "Optional id of an earlier post these screens supersede; its screens become the before." },
      },
      required: ["caption", "topic"],
    },
  },
  {
    name: "rounds_change",
    description: "Record a change you pushed to the main branch: the commits, a plain summary, and after screens of what it touched (with before screens when you have them). Call it after a push to main.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "What changed for the person using it, in a sentence or two." },
        range: { type: "string", description: "The pushed commit range, e.g. \"a1b2c3d..e4f5a6b\"." },
        after: { type: "array", items: { type: "string" }, description: "Screens of what the change touched, as it is now." },
        before: { type: "array", items: { type: "string" }, description: "The same screens before the change, in the same order." },
        topic: { type: "string", description: "The line of work this belongs to; defaults to Changes." },
      },
      required: ["summary"],
    },
  },
  {
    name: "rounds_notes",
    description: "The notes the user pinned on work posted from this project, newest first, each with its screen and the point they pinned.",
    inputSchema: { type: "object", properties: { all: { type: "boolean", description: "Include notes already answered." } } },
  },
  {
    name: "rounds_reply",
    description: "Answer a note once you've acted on it: one or two plain sentences on what you changed. The reply shows on the user's pin.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, reply: { type: "string" } }, required: ["id", "reply"] },
  },
];

const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

function keep(files = []) {
  fs.mkdirSync(IMG, { recursive: true });
  const out = [], missing = [];
  for (const f of files) {
    const p = resolve(String(f));
    const m = fs.existsSync(p) ? keepImage(p) : null;
    if (m) out.push(m); else missing.push(f);
  }
  return { out, missing };
}

function save(post) {
  madeHere.add(post.id);
  fs.mkdirSync(POSTS, { recursive: true });
  fs.writeFileSync(path.join(POSTS, `${post.id}.json`), JSON.stringify(post, null, 1));
  // let a running canvas know there is something new (it reads posts as they land)
  fs.writeFileSync(path.join(DATA, "posted"), String(Date.now()));
}

const link = (id) => `http://localhost:${cfg.port}/#${id}`;
const projectName = () => { const P = projects(cfg); const k = P.of([], cwd); return P.names.get(k) || k; };

function commitsOf(range) {
  if (!range) return [];
  try {
    return execFileSync("git", ["log", "-n", "50", "--format=%h%x09%s", range], { cwd, encoding: "utf8" }).trim().split("\n").filter(Boolean).map((l) => {
      const [sha, ...rest] = l.split("\t");
      return { sha, subject: rest.join("\t") };
    });
  } catch { return []; }
}

// The session this server works for, learned from its own posts (the tool hook writes the
// session onto each post right after it is made).
const madeHere = new Set();
const mySession = () => { for (const id of madeHere) { const p = readJSON(path.join(POSTS, `${id}.json`), null); if (p?.session) return p.session; } return null; };

// The notes on this session's posts, once it is known; until then, on this project's posts.
function myNotes() {
  const posts = fs.existsSync(POSTS) ? fs.readdirSync(POSTS).map((f) => readJSON(path.join(POSTS, f), null)).filter(Boolean) : [];
  const repo = (d) => { try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: d, encoding: "utf8" }).trim(); } catch { return d; } };
  const here = repo(cwd);
  const session = mySession();
  const mine = session ? posts.filter((p) => p.session === session) : posts.filter((p) => p.cwd && repo(p.cwd) === here);
  const byHash = new Map();
  for (const p of mine) for (const s of [...(p.shots || []), ...(p.page ? [{ hash: p.page.hash, page: true }] : [])]) byHash.set(s.hash, p);
  const comments = readJSON(COMMENTS, []);
  return comments
    .map((c) => ({ c, post: byHash.get(c.hash) || mine.find((p) => c.page === `post-${p.page?.key}`) }))
    .filter((x) => x.post)
    .sort((a, b) => b.c.at - a.c.at);
}

function describe({ c, post }) {
  const shot = (post.shots || []).find((s) => s.hash === c.hash);
  const lines = [
    `Note ${c.id}${c.reply ? " (answered)" : ""}: ${c.text}`,
    `On: "${post.caption}"${post.topic ? ` (topic: ${post.topic})` : ""}`,
    shot ? `The screen: ${path.join(STORE, "img", `${shot.hash}.${shot.ext}`)} (${shot.w}x${shot.h}), pinned at x ${Math.round(c.x * shot.w)}, y ${Math.round(c.y * shot.h)}` : `The page: ${path.join(STORE, `${c.hash}.html`)}, pinned at x ${Math.round(c.x)}, y ${Math.round(c.y)} on the page at 1280 wide`,
    c.reply ? `You replied: ${c.reply.text}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

function call(name, a = {}) {
  if (name === "rounds_post") {
    const caption = String(a.caption || "").trim(), topic = String(a.topic || "").trim();
    if (!caption || !topic) return text("A post needs a caption and a topic.", true);
    if (!a.images?.length && !a.page) return text("Give images or a page to post.", true);
    const { out: shots, missing } = keep(a.images);
    const { out: before } = keep(a.before);
    if (missing.length) return text(`These images couldn't be read: ${missing.join(", ")}.`, true);
    let page = null;
    if (a.page) {
      const p = resolve(String(a.page));
      if (!fs.existsSync(p)) return text(`There is no page at ${a.page}.`, true);
      const html = fs.readFileSync(p, "utf8");
      const hash = sha(html);
      fs.mkdirSync(STORE, { recursive: true });
      fs.writeFileSync(path.join(STORE, `${hash}.html`), html);
      page = { key: sha(p), hash, path: p, title: html.match(/<title>([^<]{1,120})<\/title>/i)?.[1]?.trim() || path.basename(p, path.extname(p)) };
    }
    const post = { id: sha(crypto.randomUUID()), kind: page ? "page" : "screens", caption, topic, cwd, at: Date.now(), shots, ...(before.length ? { before } : {}), ...(page ? { page } : {}), ...(a.replaces ? { replaces: String(a.replaces) } : {}) };
    save(post);
    const what = page ? `the page "${page.title}"` : `${shots.length} screen${shots.length === 1 ? "" : "s"}`;
    return text(`Posted ${what} to Rounds as post ${post.id}, under ${projectName()}, topic "${topic}"${before.length ? ", with its before" : ""}. ${link(page && !shots.length ? `page-post-${page.key}` : post.id)}`);
  }
  if (name === "rounds_change") {
    const summary = String(a.summary || "").trim();
    if (!summary) return text("A change needs a summary.", true);
    const { out: shots, missing } = keep(a.after);
    const { out: before } = keep(a.before);
    if (missing.length) return text(`These images couldn't be read: ${missing.join(", ")}.`, true);
    const range = a.range ? String(a.range) : "";
    const post = { id: sha(crypto.randomUUID()), kind: "change", caption: summary, topic: String(a.topic || "Changes").trim(), cwd, at: Date.now(), shots, ...(before.length ? { before } : {}), range, commits: commitsOf(range) };
    save(post);
    return text(`Recorded the change to Rounds as post ${post.id}: ${post.commits.length} commit${post.commits.length === 1 ? "" : "s"}, ${shots.length} screen${shots.length === 1 ? "" : "s"}${before.length ? (shots.length === 1 ? " with its before" : " with their before") : ""}. ${link(post.id)}`);
  }
  if (name === "rounds_notes") {
    const notes = myNotes().filter((x) => a.all || !x.c.reply);
    if (!notes.length) return text("No notes waiting.");
    return text(notes.map(describe).join("\n\n"));
  }
  if (name === "rounds_reply") {
    const reply = String(a.reply || "").trim();
    if (!reply) return text("The reply is empty.", true);
    const comments = readJSON(COMMENTS, []);
    const c = comments.find((x) => x.id === String(a.id));
    if (!c) return text(`There is no note ${a.id}.`, true);
    c.reply = { text: reply, at: Date.now() };
    fs.writeFileSync(COMMENTS, JSON.stringify(comments, null, 1));
    return text(`Your reply is on note ${c.id}.`);
  }
  return text(`Unknown tool ${name}.`, true);
}

function handle(msg) {
  const { id, method, params = {} } = msg;
  if (method === "initialize") return { protocolVersion: params.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "rounds", version: "0.1.0" }, instructions: INSTRUCTIONS };
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: TOOLS };
  if (method === "tools/call") return call(params.name, params.arguments);
  if (id === undefined) return undefined; // a notification
  throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
}

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  try {
    const result = handle(msg);
    if (msg.id !== undefined && result !== undefined) send({ jsonrpc: "2.0", id: msg.id, result });
  } catch (err) {
    if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: err.code || -32603, message: err.message } });
  }
});
