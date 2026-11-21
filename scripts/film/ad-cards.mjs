// The Codex edition's replacement words and end, based on the original Rounds film at 9b863e2.
// Drawn a frame at a time in Chrome so the type stays sharp while it
// moves. Each word cuts in on its beat with a short focus pull, then pushes in slowly for the rest
// of the beat. The end is one lockup that builds in place: the mark on the impact, the name on the
// next hit, then what it's for, then how to get it.
//   node scripts/film/ad-cards.mjs <desktop|phone> <out dir>
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const [view = "desktop", OUT] = process.argv.slice(2);
const [W, H] = view === "desktop" ? [1920, 1080] : [1080, 1350];
const HERE = path.dirname(fileURLToPath(import.meta.url));
const B = 30;
// name, words, beats on screen (as in ad-cut.py)
export const WORDS = [
  ["w1", "Everything", 1], ["w2", "you make", 1], ["w3", "with Codex.", 2],
  ["w4", "Open anything.", 1], ["w5", "Pin a note.", 1], ["w6", "Codex fixes it.", 1],
  ["w7", "Go back", 1], ["w8", "to any day.", 1],
];
const END = 12; // beats
const mark = fs.readFileSync(path.join(HERE, "../../docs/rounds-mark.svg"), "utf8");
const mono = `data:font/woff2;base64,${fs.readFileSync(path.join(HERE, "../../public/fonts/GeistMono-Variable.woff2")).toString("base64")}`;
const css = `
  @font-face { font-family: "Geist Mono"; src: url(${mono}) format("woff2"); font-weight: 100 900; }
  html, body { margin: 0; background: transparent; }
  body { width: 100vw; height: 100vh; display: grid; place-items: center; -webkit-font-smoothing: antialiased; overflow: hidden; }
  .w { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif; font-weight: 600; letter-spacing: -0.045em;
    color: rgba(21, 24, 29, 0.9); line-height: 1; white-space: nowrap; will-change: transform, filter, opacity; }
  .lock { display: grid; justify-items: center; will-change: transform; }
  .lock > * { will-change: transform, opacity; }
  .mark svg { width: 100%; height: 100%; display: block; }
  .quiet { color: #9aa2ad; }
  .npx { font-family: "Geist Mono", ui-monospace, monospace; color: #5d6570; letter-spacing: 0; }
`;
const easeOut = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
// a settle with the faintest overshoot, for the mark landing on the impact
const settle = (t) => { t = Math.min(1, Math.max(0, t)); return 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2); };

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
async function frames(name, n, draw) {
  const dir = path.join(OUT, `${view}-${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  console.log(`${view}: rendering ${name} (${n} frames)`);
  for (let i = 0; i < n; i++) {
    await page.evaluate(draw, i);
    await page.screenshot({ path: path.join(dir, `${String(i).padStart(4, "0")}.png`), omitBackground: true });
  }
}

// the words: as big as one line can be (four fifths of the width at most)
const BIG = view === "desktop" ? 250 : 168;
for (const [name, text, beats] of WORDS.filter(([name]) => ["w3", "w6"].includes(name))) {
  await page.setContent(`<style>${css}</style><div class="w" style="font-size:${BIG}px">${text}</div>`);
  await page.evaluate(({ W }) => { const e = document.querySelector(".w"); const k = Math.min(1, (W * 0.84) / e.getBoundingClientRect().width); e.style.fontSize = `${parseFloat(e.style.fontSize) * k}px`; }, { W });
  const n = beats * B;
  await frames(name, n, new Function("i", `
    const n = ${n}, e = document.querySelector(".w");
    const pull = Math.min(1, i / 5);
    const push = 1 + 0.035 * (i / n);
    e.style.filter = "blur(" + (9 * (1 - pull) * (1 - pull)) + "px)";
    e.style.opacity = String(0.55 + 0.45 * pull);
    e.style.transform = "scale(" + ((1.025 - 0.025 * pull) * push) + ")";
  `));
}

// the end: one lockup, built in place
{
  const [m, size, sub, npx] = view === "desktop" ? [140, 190, 64, 40] : [128, 160, 54, 36];
  await page.setContent(`<style>${css}</style>
    <div class="lock">
      <div class="mark" style="width:${m}px;height:${m}px;margin-bottom:${m * 0.26}px">${mark}</div>
      <div class="w name" style="font-size:${size}px">Rounds</div>
      <div class="w sub quiet" style="font-size:${sub}px;letter-spacing:-0.03em;margin-top:${sub * 0.42}px">For Codex.</div>
      <div class="npx" style="font-size:${npx}px;margin-top:${npx * 1.25}px">npx github:krispuckett/rounds-codex</div>
    </div>`);
  const ease = `const easeOut = ${easeOut.toString()}; const settle = ${settle.toString()};`;
  await frames("end", END * B, new Function("i", `
    ${ease}
    const B = ${B}, n = ${END * B};
    const q = (s) => document.querySelector(s);
    // the whole lockup drifts in, all the way to the end
    q(".lock").style.transform = "scale(" + (1 + 0.025 * (i / n)) + ")";
    // the mark lands on the impact
    const a = i / 16;
    q(".mark").style.opacity = String(Math.min(1, i / 5));
    q(".mark").style.transform = "scale(" + (0.82 + 0.18 * settle(a)) + ")";
    // each line rises into place on its hit: the name two beats in, then four, then six
    const rise = (el, at) => { const t = easeOut((i - at) / 16); el.style.opacity = String(Math.min(1, Math.max(0, (i - at) / 10))); el.style.transform = "translateY(" + (18 * (1 - t)) + "px)"; el.style.filter = "blur(" + (6 * (1 - t) * (1 - t)) + "px)"; };
    rise(q(".name"), 2 * B);
    rise(q(".sub"), 4 * B);
    rise(q(".npx"), 6 * B);
  `));
}
await browser.close();
console.log(view, "ad words and end, frame by frame");
