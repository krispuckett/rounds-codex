import { buildIndex } from "./indexer.mjs";
const t = Date.now();
await buildIndex({ log: console.log });
console.log(`${Date.now() - t} ms`);
