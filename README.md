# Rounds for Codex

A local browser canvas of your Codex work on macOS. Screens, HTML pages, before and after comparisons, file changes, and notes linked to the chat that made them.

This is an independent port of [Rounds](https://github.com/krispuckett/rounds), based on commit `9b863e289f30c676b35379be5de2859f5858a273`. The original repository and Claude integration are unchanged. The MIT license and original canvas design are retained.

## Get started

Requires macOS, [Node.js](https://nodejs.org/) 20 or newer, and a current version of Codex with the `codex` command available in your terminal. Chrome or another Chromium browser enables HTML page previews. Optional: `brew install zstd` to import compressed older Codex sessions.

```sh
npx github:krispuckett/rounds-codex#v0.1.0 init
```

Confirm installation, then review and trust the hooks in Codex **Settings > Hooks** (or `/hooks` in the CLI). Reopen chats to load the MCP server and skill.

Start the canvas:

```sh
node ~/.rounds-codex/app/bin/rounds-codex.mjs
```

Your browser opens [localhost:4798](http://localhost:4798). Keep the terminal running while using the canvas; press Ctrl+C to stop it. It does not start automatically at login.

The first launch imports saved local Codex history in the background. Large histories can take a few minutes. Subsequent launches reuse a per-session cache, and the terminal reports import progress.

Want to try it before connecting Codex? This uses public sample work in a separate demo folder and does not install hooks:

```sh
npx github:krispuckett/rounds-codex#v0.1.0 --demo
```

## Use the canvas

- Ask Codex to post finished visual work to Rounds. The installed skill uses `rounds_post` for screenshots and HTML, and `rounds_change` for pushed changes.
- Browse work by project and chat. Open a screen to inspect it, compare versions, or pin a note.
- Click through to the owning Codex chat and send a message. Pending notes are delivered to that chat, and Codex can reply on the canvas.

A pin is delivered on your next message to its chat. It does not wake an idle chat. You can also ask Codex to check `rounds_notes`. Each MCP call includes an explicit `session_id`, so concurrent chats in one project remain separate.

## What installation changes

Preview the exact changes, then install:

```sh
npx github:krispuckett/rounds-codex#v0.1.0 init --dry-run
```

Installation keeps a complete runtime in `~/.rounds-codex/app`, registers the `rounds-codex` MCP server, installs the `rounds-codex` skill, and adds four lifecycle hooks. Clearing npm's download cache will not break the installation. Existing Codex hooks are preserved, with timestamped backups of existing hooks and config files. It does not add Git hooks or write to the original Rounds project or Claude configuration.

Hook trust is handled by Codex and is never granted by this installer.

- `SessionStart` supplies the chat ID and working directory.
- `PostToolUse` recognizes successful pushes and asks Codex to record them.
- `Stop` captures completed work from the local session into the canvas cache.
- `UserPromptSubmit` delivers pending notes only to the chat that owns the work.

To update, stop the canvas and run `init` with the newer release tag, then start it again. Saved work and notes are retained. If you move or replace your Node installation, rerun `init` so the hooks use its current path.

## What gets captured

The `rounds_post` tool saves screenshots or an HTML file immediately. `rounds_change` records a pushed change. Images and HTML snapshots are copied into Rounds storage when posted, with before images and page versions preserved. `rounds_notes` and `rounds_reply` complete the feedback loop.

History import reads local Codex rollout files, including archived sessions and `.jsonl.zst` files when `zstd` is installed. It captures image embeds and local HTML links from assistant messages, and file-change events with their recorded diffs. Missing source files cannot be recovered from a path alone. Remote/cloud-only work is not imported. HTML is preserved as a file snapshot; external scripts, styles, and assets are not bundled.

The rollout format is an internal Codex format and may change. Live MCP posts and explicit chat identity do not depend on parsing it. Current parsing supports completed-item events and assistant-message records observed in Codex 0.166.

Topic grouping uses explicit post topics or chat titles. It runs locally without background model calls.

## Storage and configuration

All canvas data lives in `~/.rounds-codex`. The demo uses `~/.rounds-codex-demo`. Codex sessions are read from `CODEX_HOME`, or `~/.codex` by default. The server binds only to the loopback interface; it does not upload your history or work to a Rounds service.

Optional `~/.rounds-codex/config.json`:

```json
{
  "projects": [{ "key": "shop", "name": "Shop", "match": ["shop", "storefront"] }],
  "private": ["internal-project"],
  "port": 4798
}
```

Private rules hide matching work from the canvas. Previously stored snapshots are retained on disk. Environment overrides: `ROUNDS_CODEX_HOME`, `ROUNDS_CODEX_SOURCE` (read-only session input), `ROUNDS_CODEX_PORT`, and `ROUNDS_CODEX_BROWSER`. `ROUNDS_CODEX_BROWSER=none` disables browser previews. Original Rounds environment variables are ignored.

Useful commands after installation:

```sh
node ~/.rounds-codex/app/bin/rounds-codex.mjs --no-open   # serve without opening a browser
node ~/.rounds-codex/app/bin/rounds-codex.mjs --no-index  # use already imported history
node ~/.rounds-codex/app/bin/rounds-codex.mjs index       # refresh all local history
```

## Remove integration

```sh
node ~/.rounds-codex/app/bin/rounds-codex.mjs uninstall
```

This removes this port's MCP registration, skill, and hooks. It preserves unrelated Codex configuration, the local runtime, and your canvas data.

## Develop and verify

```sh
git clone https://github.com/krispuckett/rounds-codex.git
cd rounds-codex
npm ci                       # installs dependencies and builds the canvas
npm start
npm run dev                  # localhost:4798
npm run check
npm test
npm run build
```

Run either the built server or the development server on port 4798 at one time. Tests require `zstd` and a built canvas (`npm ci` builds it automatically).

Integration tests use temporary Codex and data directories. They exercise MCP posting, HTTP pinning, chat isolation, one-time note delivery, replies, page versions, history retention, file diffs, origin checks, install/uninstall preservation, and operation after npm cache deletion. CI runs on macOS with Node 20 and 22. No live model calls are needed.

Integration references: [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Codex deep links](https://learn.chatgpt.com/docs/reference/commands).
