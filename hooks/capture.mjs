import fs from 'node:fs';
import path from 'node:path';
import { parseSession } from '../server/indexer.mjs';
import { DATA, CODEX } from '../server/config.mjs';
import { hash, writeJSON } from '../server/storage.mjs';
let input;try{input=JSON.parse(fs.readFileSync(0,'utf8'));}catch{process.exit(0);}
const file=input.transcript_path;
if(!file||!path.resolve(file).startsWith(CODEX+path.sep)||!fs.existsSync(file))process.exit(0);
const stat=fs.statSync(file),data=await parseSession(file);
if(data&&data.thread.id===input.session_id){
 writeJSON(path.join(DATA,'sessions',`${hash(file)}.json`),{signature:`v3:${stat.size}:${stat.mtimeMs}`,data});
 fs.writeFileSync(path.join(DATA,'posted'),String(Date.now()));
}
