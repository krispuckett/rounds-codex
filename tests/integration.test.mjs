import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'rounds-codex-test-'));
const data=path.join(temp,'data'),source=path.join(temp,'codex'),repo=path.join(temp,'project');
fs.mkdirSync(repo,{recursive:true});fs.mkdirSync(path.join(repo,'.git'));fs.mkdirSync(path.join(source,'sessions'),{recursive:true});
process.env.ROUNDS_CODEX_HOME=data;process.env.ROUNDS_CODEX_SOURCE=source;process.env.ROUNDS_CODEX_BROWSER='none';
const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));process.env.ROUNDS_CODEX_PORT=String(port);
const {buildIndex}=await import('../server/indexer.mjs');
const {configuredHooks,removeHooks,install,uninstall}=await import('../server/install.mjs');
const {writeJSON,readJSON}=await import('../server/storage.mjs');
const image=path.resolve('public/apple-touch-icon.png');
const sessionA='00000000-0000-4000-8000-000000000001',sessionB='00000000-0000-4000-8000-000000000002';
function rpc(name,args){
 const r=spawnSync(process.execPath,['bin/rounds-codex.mjs','mcp'],{input:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})+'\n',encoding:'utf8',env:process.env});
 assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim()).result;
}
function hook(name,input){const r=spawnSync(process.execPath,[`hooks/${name}.mjs`],{input:JSON.stringify(input),encoding:'utf8',env:process.env});assert.equal(r.status,0,r.stderr);return r.stdout?JSON.parse(r.stdout):null;}
let server;
test.after(()=>{server?.closeAllConnections();server?.close();fs.rmSync(temp,{recursive:true,force:true});});
test('posting, pinned feedback, delivery, and replies stay with the owning chat',async()=>{
 const a=rpc('rounds_post',{session_id:sessionA,cwd:repo,caption:'First screen',topic:'Home screen',images:[image]});
 const b=rpc('rounds_post',{session_id:sessionB,cwd:repo,caption:'Second chat using the same image',topic:'Home screen',images:[image]});
 assert.ok(!a.isError);assert.ok(!b.isError);
 const id=a.content[0].text.match(/post ([a-f0-9]+)/)[1];const post=readJSON(path.join(data,'posts',`${id}.json`));
 await buildIndex();const {serve}=await import('../server/serve.mjs');server=await serve(port);
 const response=await fetch(`http://localhost:${port}/api/comments`,{method:'POST',headers:{'Content-Type':'application/json',Origin:`http://localhost:${port}`},body:JSON.stringify({page:`shot-${post.shots[0].hash}`,hash:post.shots[0].hash,set:id,x:.3,y:.4,text:'Move the title up'})});
 assert.equal(response.status,200);const note=await response.json();assert.equal(note.thread,sessionA);
 assert.equal(hook('notes',{session_id:sessionB}),null);
 assert.match(rpc('rounds_notes',{session_id:sessionB}).content[0].text,/No notes/);
 assert.equal(rpc('rounds_reply',{session_id:sessionB,id:note.id,reply:'Wrong chat'}).isError,true);
 const delivery=hook('notes',{session_id:sessionA});assert.match(delivery.hookSpecificOutput.additionalContext,/Move the title up/);
 assert.equal(hook('notes',{session_id:sessionA}),null);
 assert.ok(!rpc('rounds_reply',{session_id:sessionA,id:note.id,reply:'Moved the title up.'}).isError);
 const notes=await(await fetch(`http://localhost:${port}/api/comments`)).json();assert.equal(notes[0].reply.text,'Moved the title up.');
 const rejected=await fetch(`http://localhost:${port}/api/comments`,{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:'{}'});assert.equal(rejected.status,403);
});
test('pages retain versions and before images survive source deletion',async()=>{
 const page=path.join(repo,'page.html');fs.writeFileSync(page,'<title>First version</title><p>Hello</p>');
 for(const title of ['First version','Second version']){fs.writeFileSync(page,`<title>${title}</title><p>Hello</p>`);assert.ok(!rpc('rounds_post',{session_id:sessionA,cwd:repo,caption:title,topic:'Landing page',page}).isError);}
 const before=path.join(repo,'before.png');fs.copyFileSync(image,before);
 assert.ok(!rpc('rounds_post',{session_id:sessionA,cwd:repo,caption:'Comparison',topic:'Home screen',images:[image],before:[before]}).isError);
 fs.unlinkSync(page);fs.unlinkSync(before);
 const idx=await buildIndex();assert.equal(idx.pages[0].versions.length,2);for(const v of idx.pages[0].versions)assert.ok(fs.existsSync(path.join(data,'store',`${v.hash}.html`)));
 assert.equal(idx.sets.find(s=>s.caption==='Comparison').before.length,1);
});
test('Codex history supports completed items, fallback messages, edits, archive, and caching',async()=>{
 const id='00000000-0000-4000-8000-000000000003',file=path.join(source,'sessions','rollout.jsonl');
 const at='2026-11-20T10:00:00Z';
 const rows=[{type:'session_meta',payload:{id,cwd:repo}},{type:'event_msg',payload:{type:'item_completed',thread_id:id,item:{id:'user',type:'UserMessage',content:[{text:'Build a home screen'}]}}},{type:'event_msg',payload:{type:'item_completed',thread_id:id,item:{id:'message',type:'AgentMessage',phase:'final_answer',content:[{text:`Made it.\n![Screen](${image})`}]}}},{type:'response_item',payload:{type:'message',role:'assistant',content:[{text:`Made it.\n![Screen](${image})`}]}},{type:'event_msg',payload:{type:'item_completed',thread_id:id,item:{id:'edit',type:'FileChange',status:'Completed',changes:{[path.join(repo,'main.ts')]:{type:'update',unified_diff:'@@ -1 +1 @@\n-old\n+new'}}}}}];
 fs.writeFileSync(file,rows.map(r=>JSON.stringify({timestamp:at,...r})).join('\n')+'\n{partial');
 fs.writeFileSync(path.join(source,'session_index.jsonl'),JSON.stringify({id,thread_name:'Named Codex chat',updated_at:at})+'\n');
 const idx=await buildIndex({scan:'all'});assert.equal(idx.threads.find(t=>t.id===id).title,'Named Codex chat');assert.equal(idx.sets.filter(s=>s.thread===id).length,1);
 const changed=idx.changed.find(c=>c.thread===id);assert.deepEqual(changed.edits[0].slice(1),[1,1]);
 const again=await buildIndex({scan:'all'});assert.equal(again.sets.filter(s=>s.thread===id).length,1);
 fs.unlinkSync(file);const retained=await buildIndex({scan:'all'});assert.ok(retained.threads.find(t=>t.id===id).gone);assert.equal(retained.sets.filter(s=>s.thread===id).length,1);
});
test('private filters hide previously captured work and ignore legacy Rounds environment',async()=>{
 process.env.ROUNDS_HOME=path.join(temp,'original-rounds');
 writeJSON(path.join(data,'config.json'),{private:['Named Codex chat']});
 const idx=await buildIndex();assert.ok(!idx.threads.some(t=>t.title==='Named Codex chat'));assert.ok(!fs.existsSync(process.env.ROUNDS_HOME));
 writeJSON(path.join(data,'config.json'),{});
});
test('installation preserves unrelated hooks and uninstall keeps canvas data',()=>{
 const extra={type:'command',command:'echo existing'};const original={description:'My hooks',hooks:{Stop:[{matcher:'*',hooks:[extra]}]}};
 const one=configuredHooks(original);assert.deepEqual(configuredHooks(one),one);assert.deepEqual(removeHooks(one),original);
 writeJSON(path.join(source,'hooks.json'),original);fs.writeFileSync(path.join(source,'config.toml'),'model = "existing-model"\n');
 const commands=[];install({codexRoot:source,runCodex:args=>commands.push(args),log:()=>{}});
 assert.equal(commands[0][2],'rounds-codex');assert.ok(fs.existsSync(path.join(source,'skills','rounds-codex','SKILL.md')));
 assert.equal(commands[0].at(-2),path.join(data,'app','bin','rounds-codex.mjs'));
 assert.ok(readJSON(path.join(source,'hooks.json')).hooks.SessionStart[0].hooks[0].command.includes(path.join(data,'app','bin','rounds-codex.mjs')));
 assert.ok(fs.readdirSync(source).some(f=>f.startsWith('hooks.json.before-rounds-codex')));
 uninstall({codexRoot:source,runCodex:args=>commands.push(args),log:()=>{}});
 assert.deepEqual(readJSON(path.join(source,'hooks.json')),original);assert.ok(fs.existsSync(path.join(data,'posts')));
 assert.equal(fs.readFileSync(path.join(source,'config.toml'),'utf8'),'model = "existing-model"\n');
});
test('compressed archived sessions and Stop capture update the cached canvas',async()=>{
 const id='00000000-0000-4000-8000-000000000004';
 const file=path.join(source,'sessions','capture.jsonl');
 const lines=[{timestamp:'2026-11-21T10:00:00Z',type:'session_meta',payload:{id,cwd:repo}},{timestamp:'2026-11-21T10:01:00Z',type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:`![Captured screen](${image})`}]}}].map(x=>JSON.stringify(x)).join('\n');
 fs.writeFileSync(file,lines+'\n');
 const output=hook('session',{session_id:id,cwd:repo});assert.match(output.hookSpecificOutput.additionalContext,new RegExp(id));
 hook('capture',{session_id:id,transcript_path:file});
 let idx=await buildIndex();assert.equal(idx.sets.filter(s=>s.thread===id).length,1);
 const zipped=path.join(source,'archived_sessions','capture.jsonl.zst');fs.mkdirSync(path.dirname(zipped),{recursive:true});
 const packed=spawnSync('zstd',['-q','-f',file,'-o',zipped]);assert.equal(packed.status,0);
 fs.unlinkSync(file);idx=await buildIndex({scan:'all'});assert.equal(idx.threads.find(t=>t.id===id).archived,true);assert.equal(idx.sets.filter(s=>s.thread===id).length,1);
 const cross=await fetch(`http://localhost:${port}/api/comments`,{method:'POST',headers:{Origin:'http://localhost:4797','Content-Type':'application/json'},body:'{}'});assert.equal(cross.status,403);
});
