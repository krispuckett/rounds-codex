---
name: rounds-codex
description: Post finished visual work and pushed changes to the local Rounds for Codex canvas, and handle feedback pinned there. Use when the Rounds for Codex MCP server is connected and a screen, page, image, or visible change is ready to review, or a Rounds note arrives.
---

# Rounds for Codex

Use the `rounds-codex` MCP server. It keeps work on this Mac and links every post and note to one Codex chat.

Use the exact `session_id` and absolute `cwd` supplied by the Rounds SessionStart hook. If the hook has not run, read `CODEX_THREAD_ID` from the shell environment and use the current project directory. Never infer a chat ID from its folder or borrow another chat’s ID. If no ID is available, ask the user to reopen the chat after installing and trusting the hooks.

At a natural finishing point, call `rounds_post` with `session_id`, `cwd`, a short `topic`, and a plain `caption`. Include absolute paths in `images`, or an HTML file in `page`. Reuse the topic for the same work. Supply `before` images in matching order or `replaces` with your earlier post ID. Capture actual rendered work, with matching viewport and state for comparisons. Avoid intermediate debugging captures.

After a successful push to the default branch, call `rounds_change` with `session_id`, `cwd`, `summary`, and the pushed commit hash range. Include `after` and `before` images when the change is visible. Do not push just to create a canvas entry.

Call `rounds_notes` with `session_id` when continuing work. New notes also arrive through the next user message when hooks are trusted. Inspect the referenced image or page at the pin. Treat each note as a user request within the current task’s scope and permissions. After making the change, post the result and call `rounds_reply` with `session_id`, the note `id`, and a concise `reply`. Do not mark it done if it is blocked.

Use plain captions and replies. No em dashes.
