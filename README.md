# Rounds for Codex

A local browser canvas of your Codex work on macOS. Screens, HTML pages, before and after comparisons, file changes, and notes linked to the chat that made them.

This is an independent port of [Rounds](https://github.com/krispuckett/rounds), based on commit `9b863e289f30c676b35379be5de2859f5858a273`. The original repository and Claude integration are unchanged. The MIT license and original canvas design are retained.

## Run

Requires macOS, Node 20 or newer, and Codex. Chrome or another Chromium browser enables HTML page previews. Install `zstd` with Homebrew to import compressed older Codex sessions.

```sh
npm install
npm run build
npm start
```

Open [localhost:4798](http://localhost:4798). The server binds only to the loopback interface. The first launch imports saved Codex history in a background process; subsequent launches reuse a per-session cache. The terminal reports import progress.

```sh
npm start -- --demo           # original public sample work, in a separate demo folder
npm start -- --no-open        # serve without opening a browser
npm start -- --no-index       # use already imported history
npm run index                # explicitly refresh all local history
```

## Connect Codex

Preview the exact changes, then install:

```sh
node bin/rounds-codex.mjs init --dry-run
node bin/rounds-codex.mjs init --yes
```

Installation registers the `rounds-codex` MCP server, installs the `rounds-codex` skill, and adds four lifecycle hooks. Existing Codex hooks are preserved, with timestamped backups of the existing hooks and config files. It does not add Git hooks or write to the original Rounds project or Claude configuration.

In Codex, review and trust the new hooks in **Settings > Hooks**, or use `/hooks` in the CLI. Reopen existing chats to load the MCP server and skill. Hook trust is handled by Codex and is never granted by this installer.

- `SessionStart` supplies the chat ID and working directory.
- `PostToolUse` recognizes successful pushes and asks Codex to record them.
- `Stop` captures completed work from the local session into the canvas cache.
- `UserPromptSubmit` delivers pending notes only to the chat that owns the work.

A pin is delivered on your next message to its chat. It does not wake an idle chat. You can also ask Codex to check `rounds_notes`. Each MCP call includes an explicit `session_id`, so concurrent chats in one project remain separate.

## What gets captured

The `rounds_post` tool saves screenshots or an HTML file immediately. `rounds_change` records a pushed change. Images and HTML snapshots are copied into Rounds storage when posted, with before images and page versions preserved. `rounds_notes` and `rounds_reply` complete the feedback loop.

History import reads local Codex rollout files, including archived sessions and `.jsonl.zst` files when `zstd` is installed. It captures image embeds and local HTML links from assistant messages, and file-change events with their recorded diffs. Missing source files cannot be recovered from a path alone. Remote/cloud-only work is not imported. HTML is preserved as a file snapshot; external scripts, styles, and assets are not bundled.

The rollout format is an internal Codex format and may change. Live MCP posts and explicit chat identity do not depend on parsing it. Current parsing supports completed-item events and assistant-message records observed in Codex 0.166.

Topic grouping uses explicit post topics or chat titles. It runs locally without background model calls.

## Storage and configuration

All canvas data lives in `~/.rounds-codex`. The demo uses `~/.rounds-codex-demo`. Codex sessions are read from `CODEX_HOME`, or `~/.codex` by default.

Optional `~/.rounds-codex/config.json`:

```json
{
  "projects": [{ "key": "shop", "name": "Shop", "match": ["shop", "storefront"] }],
  "private": ["internal-project"],
  "port": 4798
}
```

Private rules hide matching work from the canvas. Previously stored snapshots are retained on disk. Environment overrides: `ROUNDS_CODEX_HOME`, `ROUNDS_CODEX_SOURCE` (read-only session input), `ROUNDS_CODEX_PORT`, and `ROUNDS_CODEX_BROWSER`. `ROUNDS_CODEX_BROWSER=none` disables browser previews. Original Rounds environment variables are ignored.

## Remove integration

```sh
node bin/rounds-codex.mjs uninstall --yes
```

This removes this port's MCP registration, skill, and hooks. It preserves unrelated Codex configuration and your canvas data.

## Develop and verify

```sh
npm run dev                  # localhost:4798
npm run check
npm test
npm run build
```

Integration tests use temporary Codex and data directories. They exercise MCP posting, HTTP pinning, chat isolation, one-time note delivery, replies, page versions, history retention, file diffs, origin checks, and install/uninstall preservation. No live model calls are needed.

Integration references: [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Codex deep links](https://learn.chatgpt.com/docs/reference/commands).
