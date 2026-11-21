#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),command=args.includes('--help')||args.includes('-h')?'help':args[0]?.startsWith('-')?'start':args[0]||'start';
if(Number(process.versions.node.split('.')[0])<20)throw new Error('Rounds for Codex needs Node 20 or newer.');
if(args.includes('--demo')){
 const folder=path.join(os.homedir(),'.rounds-codex-demo');
 if(!fs.existsSync(path.join(folder,'posts')))fs.cpSync(path.join(ROOT,'demo'),folder,{recursive:true});
 process.env.ROUNDS_CODEX_HOME=folder;process.env.ROUNDS_CODEX_SOURCE=path.join(folder,'.empty');
 fs.mkdirSync(process.env.ROUNDS_CODEX_SOURCE,{recursive:true});
}
if(command==='mcp')await import('../server/mcp.mjs');
else if(command==='hook'){
 const hook=args[1];if(!['session','notes','tool','capture'].includes(hook))throw new Error('Unknown hook.');
 await import(`../hooks/${hook}.mjs`);
}else if(command==='index'){
 const {buildIndex}=await import('../server/indexer.mjs');await buildIndex({scan:'all',log:args.includes('--quiet')?()=>{}:console.log});
}else if(command==='init'||command==='uninstall'){
 const {install,uninstall}=await import('../server/install.mjs');
 if(args.includes('--dry-run'))install({dryRun:true});
 else{
  let accepted=args.includes('--yes');
  if(!accepted){const rl=readline.createInterface({input:process.stdin,output:process.stdout});accepted=/^y/i.test(await rl.question(`${command==='init'?'Install':'Remove'} the Rounds for Codex MCP server, skill, and hooks? [y/N] `));rl.close();}
  if(accepted)(command==='init'?install:uninstall)();
 }
}else if(command==='start'){
 const {DATA,loadConfig}=await import('../server/config.mjs');
 const {buildIndex}=await import('../server/indexer.mjs');
 if(!fs.existsSync(path.join(ROOT,'dist','index.html')))throw new Error('Build the canvas first with npm run build.');
 await buildIndex({scan:'cached'});
 const {serve}=await import('../server/serve.mjs');const server=await serve(loadConfig().port);
 const url=`http://localhost:${loadConfig().port}`;console.log(`Rounds for Codex is open at ${url}\nData: ${DATA}`);
 if(!args.includes('--no-open'))spawn('open',[url],{stdio:'ignore',detached:true}).unref();
 // History import is separate from the web process; the canvas remains responsive.
 let child;
 if(!args.includes('--no-index')&&!args.includes('--demo')){
  child=spawn(process.execPath,[path.join(ROOT,'bin','rounds-codex.mjs'),'index'],{stdio:['ignore','inherit','inherit']});
  child.on('error',e=>console.error(`History import: ${e.message}`));
 }
 const stop=()=>{child?.kill();server.close(()=>process.exit(0));};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}else{
 console.log('rounds-codex [start|index|init|uninstall] [--demo] [--no-open]\ninit --dry-run previews the Codex integration. init --yes installs it.');
 if(command!=='help'&&!args.includes('--help'))process.exitCode=1;
}
