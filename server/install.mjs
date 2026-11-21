import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DATA, CODEX } from './config.mjs';
import { readJSON, writeJSON } from './storage.mjs';
import { APP, keepRuntime } from './runtime.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const quote=value=>`'${value.replace(/'/g,"'\\''")}'`;
const marker='rounds-codex.mjs';
export function removeHooks(settings){
 const result=structuredClone(settings);
 for(const [event,groups] of Object.entries(result.hooks||{})){
  result.hooks[event]=groups.map(group=>({...group,hooks:(group.hooks||[]).filter(h=>!String(h.command||'').includes(marker))})).filter(group=>group.hooks.length);
  if(!result.hooks[event].length)delete result.hooks[event];
 }
 return result;
}
export function configuredHooks(existing,root=ROOT,data=DATA){
 const settings=removeHooks(existing);settings.hooks||={};
 const command=name=>`ROUNDS_CODEX_HOME=${quote(data)} ${quote(process.execPath)} ${quote(path.join(root,'bin','rounds-codex.mjs'))} hook ${name}`;
 const add=(event,name,extra={},options={})=>(settings.hooks[event]||=[]).push({...extra,hooks:[{type:'command',command:command(name),timeout:30,...options}]});
 add('SessionStart','session');add('UserPromptSubmit','notes');
 add('PostToolUse','tool',{matcher:'Bash'});
 add('Stop','capture',{}, {async:true,timeout:120});
 return settings;
}
function existingHooks(file){
 if(!fs.existsSync(file))return{};
 const value=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Existing hooks.json must be a JSON object.');
 return value;
}
export function install({dryRun=false,codexRoot=CODEX,runCodex=null,log=console.log}={}){
 const file=path.join(codexRoot,'hooks.json'),settings=configuredHooks(existingHooks(file),APP);
 const args=['mcp','add','rounds-codex','--env',`ROUNDS_CODEX_HOME=${DATA}`,'--',process.execPath,path.join(APP,'bin','rounds-codex.mjs'),'mcp'];
 const skill=path.join(codexRoot,'skills','rounds-codex');
 if(dryRun){log(JSON.stringify({mcpCommand:['codex',...args],hooksFile:file,hooks:settings,skillDirectory:skill,dataDirectory:DATA,appDirectory:APP},null,2));return;}
 if(codexRoot!==path.resolve(process.env.CODEX_HOME||path.join(process.env.HOME,'.codex')) && !runCodex)throw new Error('A custom source directory is for isolated indexing. Use init --dry-run to preview installation.');
 keepRuntime();
 fs.mkdirSync(codexRoot,{recursive:true});
 if(fs.existsSync(file))fs.copyFileSync(file,`${file}.before-rounds-codex-${Date.now()}`);
 const config=path.join(codexRoot,'config.toml');if(fs.existsSync(config))fs.copyFileSync(config,`${config}.before-rounds-codex-${Date.now()}`);
 (runCodex||(args=>execFileSync('codex',args,{stdio:'inherit'})))(args);
 fs.mkdirSync(skill,{recursive:true});fs.copyFileSync(path.join(APP,'skill','rounds-codex','SKILL.md'),path.join(skill,'SKILL.md'));
 writeJSON(file,settings);
 log('Installed Rounds for Codex. Review and trust its hooks in Codex Settings > Hooks (or /hooks in the CLI), then reopen chats to load the MCP server and skill.');
}
export function uninstall({codexRoot=CODEX,runCodex=null,log=console.log}={}){
 if(codexRoot!==path.resolve(process.env.CODEX_HOME||path.join(process.env.HOME,'.codex'))&&!runCodex)throw new Error('A custom source directory cannot change the live Codex integration.');
 const file=path.join(codexRoot,'hooks.json');const settings=removeHooks(existingHooks(file));
 (runCodex||(args=>execFileSync('codex',args,{stdio:'inherit'})))(['mcp','remove','rounds-codex']);
 if(fs.existsSync(file))writeJSON(file,settings);
 const skill=path.join(codexRoot,'skills','rounds-codex');
 if(readJSON(path.join(skill,'ownership.json'),null)||fs.existsSync(path.join(skill,'SKILL.md'))){
  const text=fs.readFileSync(path.join(skill,'SKILL.md'),'utf8');if(/^name: rounds-codex$/m.test(text))fs.rmSync(skill,{recursive:true});
 }
 log(`Removed the Codex integration. Canvas data stays in ${DATA}.`);
}
