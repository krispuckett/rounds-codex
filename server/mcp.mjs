#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { DATA, STORE, IMG, POSTS, loadConfig, projects } from './config.mjs';
import { keepImage } from './images.mjs';
import { readJSON, writeJSON, hash } from './storage.mjs';
import { notesFor, describeNote, replyToNote } from './notes.mjs';

const text = (value, isError=false) => ({content:[{type:'text',text:value}],...(isError?{isError:true}:{})});
const identity = {session_id:{type:'string',description:'This Codex chat ID from the Rounds SessionStart hook or CODEX_THREAD_ID. Never use another chat ID.'}};
const context = {...identity,cwd:{type:'string',description:'Absolute working directory of this Codex chat.'}};
const strings={type:'array',items:{type:'string'}};
const TOOLS = [
 {name:'rounds_post',description:'Save finished screens or an HTML page to Rounds for Codex, with a topic and optional before images.',inputSchema:{type:'object',properties:{...context,caption:{type:'string'},topic:{type:'string'},images:strings,page:{type:'string'},before:strings,replaces:{type:'string'}},required:['session_id','cwd','caption','topic']}},
 {name:'rounds_change',description:'Record a change pushed to the default branch, with its summary, commit range, and optional screenshots.',inputSchema:{type:'object',properties:{...context,summary:{type:'string'},range:{type:'string'},topic:{type:'string'},after:strings,before:strings},required:['session_id','cwd','summary']}},
 {name:'rounds_notes',description:'Read feedback pinned to work owned by this Codex chat. Other chats in the same folder are excluded.',inputSchema:{type:'object',properties:{...identity,all:{type:'boolean'}},required:['session_id']}},
 {name:'rounds_reply',description:'Reply to a note owned by this Codex chat after acting on it.',inputSchema:{type:'object',properties:{...identity,id:{type:'string'},reply:{type:'string'}},required:['session_id','id','reply']}}
];
function call(name,a={}) {
 if (!/^[a-zA-Z0-9_-]{1,128}$/.test(a.session_id||'')) return text('Supply this chat’s session_id from the Rounds hook or CODEX_THREAD_ID.',true);
 if (name==='rounds_notes') {
  const notes=notesFor(a.session_id).filter(c=>a.all||!c.reply);
  return text(notes.length?notes.map(describeNote).join('\n\n'):'No notes waiting.');
 }
 if (name==='rounds_reply') {
  if (!String(a.reply||'').trim()) return text('The reply is empty.',true);
  return replyToNote(a.session_id,String(a.id),String(a.reply).trim()) ? text(`Your reply is on note ${a.id}.`) : text('This note does not belong to this Codex chat.',true);
 }
 if (!['rounds_post','rounds_change'].includes(name)) return text(`Unknown tool ${name}.`,true);
 if (!path.isAbsolute(a.cwd||'') || !fs.statSync(a.cwd,{throwIfNoEntry:false})?.isDirectory()) return text('cwd must be this chat’s existing absolute project directory.',true);
 const caption=String(a.caption||a.summary||'').trim(),topic=String(a.topic||(name==='rounds_change'?'Changes':'')).trim();
 if (!caption||!topic) return text('Supply a caption and topic.',true);
 const P=projects(); if(P.isPrivate(a.cwd,caption,topic)) return text('This work matches your private filter and was not saved.',true);
 const resolve=f=>f.startsWith('~/')?path.join(process.env.HOME||'',f.slice(2)):path.resolve(a.cwd,f);
 const keep=files=>{
  if(files!=null&&!Array.isArray(files)) throw new Error('Images must be an array of paths.');
  return (files||[]).map(f=>{if(typeof f!=='string')throw new Error('Expected an image path.');const image=keepImage(resolve(f));if(!image)throw new Error(`Could not read image: ${f}`);return image;});
 };
 const shots=keep(a.images||a.after),before=keep(a.before);
 let page;
 if(a.page){
  const file=resolve(String(a.page));if(!/\.html?$/i.test(file))return text('The page must be an HTML file.',true);
  const stat=fs.statSync(file);if(!stat.isFile()||stat.size>20e6)return text('Page must be a file smaller than 20 MB.',true);
  const html=fs.readFileSync(file,'utf8'),digest=hash(html);fs.mkdirSync(STORE,{recursive:true});fs.writeFileSync(path.join(STORE,`${digest}.html`),html);
  page={key:hash(`${a.session_id}:${file}`),hash:digest,path:file,title:html.match(/<title>([^<]{1,120})<\/title>/i)?.[1]||path.basename(file)};
 }
 if(name==='rounds_post'&&!shots.length&&!page)return text('Give images or an HTML page to post.',true);
 if(a.replaces&&!/^[a-f0-9]{16}$/.test(a.replaces))return text('Invalid replaced post ID.',true);
 const replaced=a.replaces?readJSON(path.join(POSTS,`${a.replaces}.json`),null):null;
 if(a.replaces&&(!/^[a-f0-9]{16}$/.test(a.replaces)||replaced?.session!==a.session_id))return text('The replaced post must belong to this Codex chat.',true);
 const range=String(a.range||'');let commits=[];
 if(range){
  if(!/^[a-f0-9]{7,40}(?:\.\.[a-f0-9]{7,40})?$/i.test(range))return text('Use commit hashes for the range.',true);
  try{commits=execFileSync('git',['log','-n','50','--format=%h%x09%s',range],{cwd:a.cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim().split('\n').filter(Boolean).map(l=>{const [sha,...subject]=l.split('\t');return{sha,subject:subject.join('\t')};});}catch{return text('Could not read that commit range in this project.',true);}
 }
 const post={id:hash(crypto.randomUUID()),session:a.session_id,cwd:a.cwd,at:Date.now(),kind:name==='rounds_change'?'change':page?'page':'screens',caption,topic,shots,...(before.length?{before}:{}),...(page?{page}:{}),...(a.replaces?{replaces:a.replaces}:{}),...(name==='rounds_change'?{range,commits}:{})};
 writeJSON(path.join(POSTS,`${post.id}.json`),post);fs.writeFileSync(path.join(DATA,'posted'),String(Date.now()));
 const key=page&&!shots.length?`page-post-${page.key}`:post.id;
 return text(`Saved to Rounds for Codex as post ${post.id}, topic "${topic}". http://localhost:${loadConfig().port}/#${key}`);
}
function handle(message){
 const {id,method,params={}}=message;
 if(method==='initialize')return{protocolVersion:params.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'rounds-codex',version:'0.1.0'},instructions:'Rounds for Codex is the user’s local canvas. Post finished visual work with rounds_post, and pushed changes with rounds_change. Include this chat’s session_id and cwd on every post. Read only this chat’s notes with rounds_notes, act within the user’s authorized scope, and reply with rounds_reply. Notes arrive at the next user turn through a trusted hook.'};
 if(method==='ping')return{};
 if(method==='tools/list')return{tools:TOOLS};
 if(method==='tools/call')return call(params.name,params.arguments);
 if(id===undefined)return undefined;
 throw Object.assign(new Error(`Method not found: ${method}`),{code:-32601});
}
for await (const line of readline.createInterface({input:process.stdin,crlfDelay:Infinity})){
 let message;try{message=JSON.parse(line);}catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})+'\n');continue;}
 try{const result=handle(message);if(message.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\n');}
 catch(error){if(message.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,...(message.method==='tools/call'?{result:text(error.message,true)}:{error:{code:error.code||-32603,message:error.message}})})+'\n');}
}
