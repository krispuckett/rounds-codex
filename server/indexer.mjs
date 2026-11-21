// Codex rollouts are read-only inputs. Cache each parsed file and retain captured work.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DATA, CODEX, STORE, IMG, POSTS, PUSHES, HOME, projects } from './config.mjs';
import { hash, readJSON, writeJSON, records, walk } from './storage.mjs';
import { keepImage, which } from './images.mjs';
import { filePostTopics } from './topics.mjs';
export { DATA, STORE, IMG, keepImage };
export { hasSips, which } from './images.mjs';
const CACHE = path.join(DATA, 'sessions');
const textOf = content => typeof content === 'string' ? content : (content || []).map(c => c.text || '').join('\n');
const dayOf = at => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const localPath = (value, cwd) => {
  if (!value || /^(?:https?:|data:|plugin:|app:|codex:|sandbox:)/i.test(value)) return null;
  try { value = decodeURIComponent(value); } catch {}
  return value.startsWith('~/') ? path.join(HOME, value.slice(2)) : path.resolve(cwd || HOME, value);
};
function projectFile(file, cwd) {
  if (!file || /(?:^|\/)(?:node_modules|\.git|\.build)\//.test(file)) return null;
  let dir = path.dirname(file);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return { repo: dir, file: path.relative(dir, file) };
    dir = path.dirname(dir);
  }
  if (cwd && cwd !== HOME && file.startsWith(cwd + path.sep)) return { repo: cwd, file: path.relative(cwd, file) };
  return null;
}
function hunksOf(change) {
  if (change.type === 'add' || change.type === 'delete') {
    return [{ o: change.type === 'add' ? 0 : 1, n: change.type === 'add' ? 1 : 0,
      lines: String(change.content || '').split('\n').map(l => `${change.type === 'add' ? '+' : '-'}${l}`) }];
  }
  const diff = change.unified_diff || change.diff || '';
  const hunks = []; let current;
  for (const line of diff.split('\n')) {
    const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (match) { current = { o: Number(match[1]), n: Number(match[2]), lines: [] }; hunks.push(current); }
    else if (/^[ +\-]/.test(line) && !/^---|^\+\+\+/.test(line)) {
      if (!current) { current = { o: 0, n: 0, lines: [] }; hunks.push(current); }
      current.lines.push(line);
    }
  }
  return hunks;
}
export async function parseSession(file, { log = () => {} } = {}) {
  let process, stream, completion;
  if (file.endsWith('.zst')) {
    if (!which('zstd')) { log('Compressed history needs zstd; skipping compressed sessions.'); return null; }
    process = spawn('zstd', ['-dc', '--', file], { stdio: ['ignore', 'pipe', 'ignore'] });
    completion = once(process, 'close'); stream = process.stdout;
  } else stream = fs.createReadStream(file, { encoding: 'utf8' });
  const result = { thread: null, sets: [], pages: [], edits: [], bindings: [] };
  const seen = new Set(), messageTexts = new Set(), fallbackMessages = [];
  const capture = (text, id, at) => {
    if (!text || !result.thread) return;
    const t = result.thread;
    const shots = [], paths = new Set();
    for (const match of text.matchAll(/(!?)\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
      const file = localPath(match[2] || match[3], t.cwd);
      if (!file || paths.has(file)) continue;
      paths.add(file);
      if (/\.(png|jpe?g|webp)$/i.test(file) && match[1]) {
        const image = keepImage(file); if (image) shots.push(image);
      }
      if (/\.html?$/i.test(file)) {
        try {
          const html = fs.readFileSync(file, 'utf8');
          const key = hash(`${t.id}:${file}`), digest = hash(html);
          fs.mkdirSync(STORE, { recursive: true });
          fs.writeFileSync(path.join(STORE, `${digest}.html`), html);
          result.pages.push({ id: `session-${key}`, url: '', title: html.match(/<title>([^<]+)<\/title>/i)?.[1] || path.basename(file), thread: t.id, at, dir: path.dirname(file), versions: [{ at, hash: digest }] });
        } catch {}
      }
    }
    if (shots.length) result.sets.push({ id: hash(`${t.id}:${id}`), thread: t.id, at, caption: text.replace(/!?\[[^\]]*\]\([^)]+\)/g, '').trim().slice(0, 600), shots });
  };
  try {
    for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) {
      // Large inline images and encrypted reasoning aren't needed for the canvas.
      if (!line.includes('session_meta') && !line.includes('item_completed') && !line.includes('response_item') && !line.includes('turn_context')) continue;
      let row; try { row = JSON.parse(line); } catch { continue; }
      const p = row.payload || {}, at = Date.parse(row.timestamp) || 0;
      if (row.type === 'session_meta') {
        result.thread = { id: p.id || p.session_id, title: '', cwd: p.cwd || '', at, archived: file.includes('/archived_sessions/'), recap: '', cli: true, days: {}, hidden: p.thread_source === 'guardian_review' || p.source?.subagent?.other === 'guardian' };
        // Subagents have their own identity. Never attribute inherited parent work to them.
        continue;
      }
      const t = result.thread; if (!t?.id || t.hidden) continue;
      t.at = Math.max(t.at, at);
      if (row.type === 'turn_context' && p.cwd) t.cwd = p.cwd;
      if (row.type === 'response_item' && p.type === 'message' && p.role === 'user' && !t.title) {
        const text = textOf(p.content).trim();
        if (!/^<|^# AGENTS\.md/.test(text)) t.title = text.split('\n')[0].slice(0, 100);
      }
      if (row.type === 'response_item' && p.type === 'message' && p.role === 'assistant' && (!p.phase || /^final(?:_answer)?$/i.test(p.phase)) && (!p.channel || p.channel === 'final')) fallbackMessages.push({ text: textOf(p.content), id: p.id || hash(line), at });
      if (row.type !== 'event_msg' || p.type !== 'item_completed') continue;
      const item = p.item || {}, id = item.id || hash(line);
      if (seen.has(id) || (p.thread_id && p.thread_id !== t.id)) continue;
      seen.add(id);
      if (item.type === 'UserMessage') {
        const text = textOf(item.content).trim();
        if (!t.title && !/^<|^# AGENTS\.md/.test(text)) t.title = text.split('\n')[0].slice(0,100);
        t.days[dayOf(at)] = (t.days[dayOf(at)] || 0) + 1;
      }
      if (item.type === 'AgentMessage' && (!item.phase || /^final(?:_answer)?$/i.test(item.phase))) { const text = textOf(item.content); messageTexts.add(hash(text)); capture(text, id, at); }
      if (item.type === 'McpToolCall' && /rounds_(post|change)$/.test(item.tool || '') && !/fail|error/i.test(item.status || '')) {
        const post = JSON.stringify(item.result).match(/\bpost ([a-f0-9]{16})\b/)?.[1];
        if (post) result.bindings.push(post);
      }
      if (item.type === 'FileChange' && /^(completed|success)$/i.test(item.status || 'completed')) {
        for (const [file, change] of Object.entries(item.changes || {})) {
          const where = projectFile(localPath(file, t.cwd), t.cwd); if (!where) continue;
          const hunks = hunksOf(change), lines = hunks.flatMap(h => h.lines);
          let left = 600;
          result.edits.push({ id: `${id}:${file}`, thread: t.id, at, ...where, add: lines.filter(l => l.startsWith('+')).length, del: lines.filter(l => l.startsWith('-')).length,
            hunks: hunks.map(h => { const keep = h.lines.slice(0, Math.max(0,left)); left -= keep.length; return { ...h, lines: keep }; }).filter(h => h.lines.length),
            ...(lines.length > 600 ? { cut: lines.length - 600 } : {}), ...(change.type === 'add' ? { created: true } : {}) });
        }
      }
    }
    if (completion && (await completion)[0] !== 0) throw new Error('Could not decompress session');
  } finally { stream.destroy(); if (process && process.exitCode === null) process.kill(); }
  for (const m of fallbackMessages) if (!messageTexts.has(hash(m.text))) { messageTexts.add(hash(m.text)); capture(m.text,m.id,m.at); }
  return result.thread?.id ? result : null;
}
export async function buildIndex({ log = () => {}, scan = 'cached' } = {}) {
  fs.mkdirSync(IMG, { recursive: true }); fs.mkdirSync(CACHE, { recursive: true });
  const P = projects(), old = readJSON(path.join(DATA, 'index.json'), { threads: [], sets: [], pages: [], changed: [] });
  const names = new Map();
  try { for (const line of fs.readFileSync(path.join(CODEX, 'session_index.jsonl'), 'utf8').split('\n')) { try { const x = JSON.parse(line); if (x.id) names.set(x.id, x.thread_name); } catch {} } } catch {}
  const files = [...walk(path.join(CODEX, 'sessions'), n => /\.jsonl(?:\.zst)?$/.test(n)), ...walk(path.join(CODEX, 'archived_sessions'), n => /\.jsonl(?:\.zst)?$/.test(n))];
  const threads = new Map(), sets = new Map(), pages = new Map(), edits = new Map(), bindings = new Map(), privateThreads = new Set();
  let parsed = 0;
  for (const file of files) {
    const stat = fs.statSync(file), signature = `v3:${stat.size}:${stat.mtimeMs}`, cacheFile = path.join(CACHE, `${hash(file)}.json`);
    let cached = readJSON(cacheFile, null), data;
    if (cached?.signature === signature || scan === 'cached') data = cached?.data;
    else {
      try { data = await parseSession(file, { log }); } catch (e) { log(`Skipped ${path.basename(file)}: ${e.message}`); continue; }
      if (data) writeJSON(cacheFile, { signature, data });
      parsed++; if (parsed % 20 === 0) log(`Read ${parsed} changed sessions…`);
    }
    if (!data) continue;
    const t = { ...data.thread, title: names.get(data.thread.id) || data.thread.title || path.basename(data.thread.cwd) || 'Codex chat' };
    if (t.hidden || P.isPrivate(t.title, t.cwd)) { privateThreads.add(t.id); continue; }
    t.project = P.of([t.title], t.cwd); threads.set(t.id, t);
    for (const s of data.sets) if (!P.isPrivate(s.caption)) sets.set(s.id, { ...s, project: t.project, topic: t.title });
    for (const p of data.pages) {
      if (P.isPrivate(p.title, p.dir)) continue;
      const existing = pages.get(p.id);
      pages.set(p.id, { ...p, project: t.project, versions: [...(existing?.versions || []), ...p.versions].filter((v,i,a) => a.findIndex(x => x.hash === v.hash) === i) });
    }
    for (const e of data.edits) if (!P.isPrivate(e.repo, e.file)) edits.set(e.id, e);
    for (const id of data.bindings) bindings.set(id, t.id);
  }
  const posts = records(POSTS).sort((a,b) => a.at-b.at), byId = new Map(posts.map(p => [p.id,p]));
  for (const p of posts) {
    const session = p.session || bindings.get(p.id);
    if (privateThreads.has(session)) continue;
    let t = threads.get(session);
    if (P.isPrivate(p.caption,p.cwd,p.topic,p.sessionTitle,p.page?.title,t?.title,names.get(session))) continue;
    if (session && !t) { t = { id: session, title: names.get(session) || p.sessionTitle || path.basename(p.cwd || '') || 'Codex chat', cwd: p.cwd || '', at: p.at, days: {}, archived: false, cli: true }; t.project = P.of([t.title],t.cwd); threads.set(session,t); }
    if (!p.session && session) writeJSON(path.join(POSTS,`${p.id}.json`), { ...p, session });
    const project = t?.project || P.of([p.caption],p.cwd), before = p.before?.length ? p.before : byId.get(p.replaces)?.shots || [];
    if (p.shots?.length || p.kind === 'change') sets.set(p.id, { id:p.id, thread:session || null, project, at:p.at, caption:p.caption, topic:p.topic, kind:p.kind, shots:p.shots || [], ...(before.length ? {before}:{}), ...(p.commits ? {commits:p.commits}:{}) });
    if (p.page) {
      const id=`post-${p.page.key}`, page=pages.get(id) || { id, url:'', versions:[], posted:true };
      Object.assign(page,{ title:p.page.title, thread:session || null, project, at:p.at, dir:path.dirname(p.page.path), topic:p.topic });
      if (page.versions.at(-1)?.hash !== p.page.hash) page.versions.push({at:p.at,hash:p.page.hash}); pages.set(id,page);
    }
  }
  for (const p of records(PUSHES)) if (!P.isPrivate(p.repo,p.summary)) sets.set(p.id,{ id:p.id,thread:null,project:P.of([],p.repo),at:p.at,caption:p.summary,topic:'Changes',kind:'push',shots:[],commits:p.commits,files:p.files });
  // Keep work after transcripts or scratch files disappear. Respect updated private rules.
  for (const t of old.threads) if (!threads.has(t.id) && !privateThreads.has(t.id) && !t.hidden && !P.isPrivate(t.title,t.cwd)) threads.set(t.id,{...t,gone:true,project:P.of([t.title],t.cwd)});
  for (const s of old.sets) if (!sets.has(s.id) && (!s.thread || threads.has(s.thread)) && !P.isPrivate(s.caption,s.topic)) sets.set(s.id,s);
  for (const p of old.pages) if ((!p.thread || threads.has(p.thread)) && !P.isPrivate(p.title,p.dir)) {
    const current=pages.get(p.id); if (!current) pages.set(p.id,p);
    else current.versions=[...p.versions,...current.versions].filter((v,i,a)=>a.findIndex(x=>x.hash===v.hash)===i).sort((a,b)=>a.at-b.at);
  }
  const byThread = new Map();
  for (const e of edits.values()) { const list=byThread.get(e.thread)||[];list.push(e);byThread.set(e.thread,list); }
  const changed=[];
  for (const t of threads.values()) {
    const file=path.join(STORE,'edits',`${t.id}.json`), stored=readJSON(file,{});
    for (const e of byThread.get(t.id)||[]) { const key=`${e.repo}\n${e.file}`, list=stored[key] ||= []; if (!list.some(x=>x.id===e.id)) list.push(e); }
    for (const [key,list] of Object.entries(stored)) {
      const [repo,file]=key.split('\n'); if (P.isPrivate(repo,file)) { delete stored[key];continue; }
      list.sort((a,b)=>a.at-b.at);changed.push({thread:t.id,repo,file,edits:list.map(e=>[e.at,e.add,e.del])});
    }
    if (Object.keys(stored).length) writeJSON(file,stored);
  }
  const index={privateThreads:[...privateThreads],builtAt:Date.now(),projects:Object.fromEntries(P.names),threads:[...threads.values()],sets:[...sets.values()].sort((a,b)=>a.at-b.at),pages:[...pages.values()],changed,folders:[...new Set([...threads.values()].map(t=>t.cwd).filter(Boolean))]};
  filePostTopics(index);writeJSON(path.join(DATA,'index.json'),index);
  if (scan === 'all') fs.writeFileSync(path.join(DATA,'posted'),String(Date.now()));
  log(`${files.length} sessions (${parsed} read), ${index.sets.length} sets, ${index.pages.length} pages, ${changed.length} changed files`);
  return index;
}
