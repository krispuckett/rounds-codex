// The built canvas, served with no Vite: the API first, then the files in dist/, and the app
// itself for any other path.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handle } from "./api.mjs";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".json": "application/json", ".ico": "image/x-icon" };

export function serve(port) {
  const server = http.createServer((req, res) => {
    handle(req, res, () => {
      const url = new URL(req.url, "http://x");
      let f = path.join(DIST, decodeURIComponent(url.pathname));
      if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
      res.setHeader("content-type", TYPES[path.extname(f)] || "application/octet-stream");
      if (f.includes(`${path.sep}assets${path.sep}`)) res.setHeader("cache-control", "max-age=31536000, immutable");
      fs.createReadStream(f).pipe(res);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
