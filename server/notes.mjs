import fs from 'node:fs';
import path from 'node:path';
import { DATA, POSTS, STORE } from './config.mjs';
import { readJSON, updateJSON, records } from './storage.mjs';
export function notesFor(session) {
 if(!session)return[];
 return readJSON(path.join(DATA,'comments.json'),[]).filter(c=>c.thread===session);
}
export function describeNote(c){
 const posts=records(POSTS).filter(p=>p.session===c.thread);
 const index=readJSON(path.join(DATA,'index.json'),{sets:[]});
 const set=(index.sets||[]).find(s=>s.thread===c.thread&&s.shots.some(sh=>sh.hash===c.hash));
 const post=posts.find(p=>p.shots?.some(s=>s.hash===c.hash)||p.page?.hash===c.hash);
 const shot=post?.shots?.find(s=>s.hash===c.hash)||set?.shots?.find(s=>s.hash===c.hash);
 const location=shot?`Screen: ${path.join(STORE,'img',`${shot.hash}.${shot.ext}`)} (${shot.w}x${shot.h}), pin x=${Math.round(c.x*shot.w)}, y=${Math.round(c.y*shot.h)}`:`Page: ${path.join(STORE,`${c.hash}.html`)}, pin x=${Math.round(c.x)}, y=${Math.round(c.y)} at 1280 wide`;
 return `Note ${c.id}: ${JSON.stringify(c.text)}\n${location}${c.reply?`\nReply: ${c.reply.text}`:''}`;
}
export function replyToNote(session,id,reply){
 const file=path.join(DATA,'comments.json');let found=false;
 updateJSON(file,[],all=>{const c=all.find(c=>c.id===id&&c.thread===session);if(c){c.reply={text:reply,at:Date.now()};found=true;}return all;});
 return found;
}
