import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DATA } from './config.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APP = path.join(DATA, 'app');
const FILES = ['bin', 'server', 'hooks', 'skill', 'dist', 'demo', 'package.json', 'LICENSE', 'README.md'];

// npm may evict its cache. Installed hooks must use a complete, durable runtime.
export function keepRuntime({ source = ROOT, destination = APP } = {}) {
  if (fs.realpathSync(source) === path.resolve(destination)) return destination;
  if (!fs.existsSync(path.join(source, 'dist', 'index.html'))) {
    throw new Error('The canvas has not been built. Run npm run build, then init again.');
  }
  if (fs.existsSync(destination)) {
    let installed;
    try { installed = JSON.parse(fs.readFileSync(path.join(destination, 'package.json'), 'utf8')); } catch {}
    if (installed?.name !== 'rounds-codex') throw new Error(`Refusing to replace an unrelated folder: ${destination}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(destination), '.rounds-install-'));
  const previous = `${stage}.previous`;
  try {
    for (const name of FILES) fs.cpSync(path.join(source, name), path.join(stage, name), { recursive: true, dereference: true });
    const require = createRequire(path.join(source, 'package.json'));
    // playwright-core is the only production dependency and has no transitive dependencies.
    const browserPackage = path.dirname(require.resolve('playwright-core/package.json'));
    fs.cpSync(browserPackage, path.join(stage, 'node_modules', 'playwright-core'), { recursive: true, dereference: true });
    if (fs.existsSync(destination)) fs.renameSync(destination, previous);
    try { fs.renameSync(stage, destination); }
    catch (error) { if (fs.existsSync(previous)) fs.renameSync(previous, destination); throw error; }
    fs.rmSync(previous, { recursive: true, force: true });
    return destination;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
