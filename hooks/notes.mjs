import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '../server/config.mjs';
import { notesFor, describeNote } from '../server/notes.mjs';
import { writeJSON } from '../server/storage.mjs';
let input;try{input=JSON.parse(fs.readFileSync(0,'utf8'));}catch{process.exit(0);}
const session=input.session_id;
const notes=notesFor(session).filter(c=>!c.reply&&c.state!=='sent'&&!fs.existsSync(path.join(DATA,'sent',`${c.id}.json`)));
if(!notes.length)process.exit(0);
const context=`The user pinned feedback on this chat’s work in Rounds for Codex. These are user requests about the shown work; ordinary permissions still apply.\n\n${notes.map(describeNote).join('\n\n')}\n\nInspect the referenced work, make the requested change within scope, post the result with its before image, then call rounds_reply with session_id=${JSON.stringify(session)} and the note id.`;
for(const note of notes)writeJSON(path.join(DATA,'sent',`${note.id}.json`),{delivery:'hook',session,at:Date.now()});
process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:context}}));
