import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { IMG } from "./config.mjs";
export function which(name) {
  for (const d of (process.env.PATH || "").split(path.delimiter)) {
    try { const f = path.join(d, name); fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile()) return f; } catch {}
  }
  return null;
}
export const hasSips = () => !!which("sips");
// Width and height from the file's own header (PNG, JPEG), else from sips where there is one.
function dims(buf, file) {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o < buf.length - 9) {
      if (buf[o] !== 0xff) { o++; continue; }
      const m = buf[o + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: buf.readUInt16BE(o + 7), h: buf.readUInt16BE(o + 5) };
      o += 2 + buf.readUInt16BE(o + 2);
    }
  }
  if (!hasSips()) return null;
  try {
    const out = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8" });
    return { w: Number(out.match(/pixelWidth: (\d+)/)[1]), h: Number(out.match(/pixelHeight: (\d+)/)[1]) };
  } catch { return null; }
}

// A screen a session showed, copied into the store by its content so it outlives the scratchpad
// it was saved to.
export function keepImage(file) {
  let buf;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > 40e6) return null;
    buf = fs.readFileSync(file);
  } catch { return null; }
  const hash = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16);
  const ext = path.extname(file).slice(1).toLowerCase().replace("jpeg", "jpg");
  if (!["png", "jpg", "webp"].includes(ext)) return null;
  fs.mkdirSync(IMG, { recursive: true });
  const dest = path.join(IMG, `${hash}.${ext}`);
  const metaFile = path.join(IMG, `${hash}.json`);
  if (fs.existsSync(metaFile)) {
    try { return JSON.parse(fs.readFileSync(metaFile, "utf8")); } catch {}
  }
  const d = dims(buf, file);
  if (!d || !d.w || !d.h) return null;
  if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);
  const meta = { hash, ext, w: d.w, h: d.h, name: path.basename(file, path.extname(file)) };
  fs.writeFileSync(metaFile, JSON.stringify(meta));
  return meta;
}

