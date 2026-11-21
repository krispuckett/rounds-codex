import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const hash = value => crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
export const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
export function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value));
  fs.renameSync(temp, file);
}
// The web server and separate MCP processes can update notes at the same time.
export function updateJSON(file, fallback, update) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`, until = Date.now() + 3000;
  while (true) {
    try { fs.mkdirSync(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 30000) { fs.rmdirSync(lock); continue; } } catch {}
      if (Date.now() >= until) throw new Error('Notes are busy. Try again.');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { const next = update(readJSON(file, fallback)); writeJSON(file, next); return next; }
  finally { fs.rmdirSync(lock); }
}
export function records(dir) {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => readJSON(path.join(dir, f), null)).filter(Boolean); } catch { return []; }
}
export function walk(dir, match) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name), match) : e.isFile() && match(e.name) ? [path.join(dir, e.name)] : []);
}
