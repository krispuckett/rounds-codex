import fs from 'node:fs';
let input;try{input=JSON.parse(fs.readFileSync(0,'utf8'));}catch{process.exit(0);}
if(input.session_id)process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:`Rounds for Codex is available. For rounds_post and rounds_change use session_id=${JSON.stringify(input.session_id)} and cwd=${JSON.stringify(input.cwd)}. Use the same session_id for rounds_notes and rounds_reply. Post finished visual work with a topic, caption, and screenshots or an HTML file. Check this chat’s notes before continuing work.`}}));
