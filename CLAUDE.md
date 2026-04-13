# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

This repo is a **merged distribution** of three previously-independent
projects, copied verbatim into sibling folders and stitched together by a
single Express gateway. The three sources upstream (`/Users/administrator/Documents/project/trello-clone`,
`/Users/administrator/Documents/project/Claude-Code-Runner`,
`/Users/administrator/Documents/project/ai-assistant`) are intentionally left
untouched — all edits happen in the copies here.

```
package.json          Root launcher — install/build/start scripts
setup.sh              One-shot bootstrap (host deps, DB, models, builds)
start.sh              Launches ai-assistant + gateway via concurrently
.env.example          Copy to .env; defaults work for a fresh install
trello-clone/         React + Vite board UI (root `/`)
claude-code-runner/   Express + node-pty gateway (`/api/*`, `/runner`, WS)
claude-code-runner/mcp-server/   MCP server exposing runner + RAG tools
ai-assistant/         TypeScript RAG / chat / MCP orchestrator (`/assistant`)
ai-assistant/init-db.sql   pgvector extension bootstrap
```

The stack runs **natively on the host** — no Docker. Postgres (with
pgvector), Ollama, and the `claude` CLI must be installed on the host;
`setup.sh` handles this on macOS via Homebrew.

## Common commands

```bash
./setup.sh                 # first-time bootstrap (idempotent — re-run after pulls)
./start.sh                 # launch ai-assistant + gateway together (same as npm start)
npm start                  # alias for ./start.sh
npm run dev                # identical to start.sh but without the preflight checks
```

`start.sh` runs two Node processes side-by-side via `concurrently`:

1. `ai-assistant` — RAG + chat service on `AI_ASSISTANT_PORT` (default 3000, internal)
2. `claude-code-runner/server.js` — gateway on `PORT` (default 3456, host-facing)

If either process exits non-zero, the other is killed (`--kill-others-on-fail`).

Host-level service control (macOS / brew):

```bash
brew services start postgresql@16     # start Postgres
brew services start ollama            # start Ollama daemon
psql ai_assistant                     # open a psql shell to the RAG db
```

Working inside a subproject independently:

```bash
# Frontend (HMR on :5173; still calls the gateway on :3456 for APIs/WS)
npm --prefix trello-clone run dev
# Frontend production build (bypasses `tsc -b`, vite only — see note below)
(cd trello-clone && npx vite build)

# Runner gateway only
node claude-code-runner/server.js

# RAG service only
npm --prefix ai-assistant run dev              # tsx src/index.ts
npm --prefix ai-assistant test                 # jest --forceExit --detectOpenHandles
cd ai-assistant && npx jest src/__tests__/foo.test.ts   # single test file
```

## Big-picture architecture

### Single gateway, single port (3456)

`claude-code-runner/server.js` is the only process exposed on the host. It
is an Express server that multiplexes all three projects behind path
prefixes:

| Prefix           | Handled by                                   |
| ---------------- | -------------------------------------------- |
| `/`              | static files from `trello-clone/dist`        |
| `/runner/*`      | static files from `claude-code-runner/public` |
| `/api/*`         | Claude Code runner REST (tasks, models, stop) |
| WebSocket `/`    | `ws` server attached to the same HTTP server — PTY stream |
| `/assistant/*`   | **reverse proxied** to `http://ai-assistant:3000` (prefix stripped) |
| `/ollama-api/*`  | **reverse proxied** to `https://ollama.com/api/*`  |

**Ordering matters** in `server.js`:

1. `/ollama-api` and `/assistant` proxies are mounted **before**
   `express.json()` so request bodies stream through untouched (needed for
   the NDJSON streaming chat responses).
2. Static middleware for trello dist is mounted **after** `/runner` so the
   runner UI isn't shadowed by the SPA fallback.
3. The regex SPA fallback at the bottom excludes `/api/`, `/runner`,
   `/ollama-api`, and `/assistant` — if you add a new proxied prefix, add
   it there too or React Router will swallow it.

The `ws.Server` is attached to the same HTTP server with `{ server }`, so
PTY WebSocket traffic shares port 3456 — no second port is published.

### Runner task lifecycle (`server.js` lines ~290–500)

Tasks are not simple child processes — the runner spawns a **real PTY**
(`node-pty`) running a shell, then drives `claude --dangerously-skip-permissions`
interactively:

1. Spawn `$SHELL || /bin/bash` inside a PTY (`/bin/zsh` is preferred if
   present, which matters because the Docker image only has bash).
2. Type the `claude` command, then watch the output stream for known
   prompts ("Trust this folder", "How can I help", etc.) and auto-respond.
3. Detect completion by watching for the idle `❯` prompt to reappear after
   the task prompt has been running (300+ chars of output, then 4s debounce).
4. When idle is confirmed, send `/exit` then `exit\r` to close the shell.
5. Stall detection: if no output for `STALL_TIMEOUT_MS` (45s), call
   Anthropic's API to analyze the terminal state and auto-type a response
   (press_enter / yes / no / text). Max 5 retries per task.

All PTY output is streamed to subscribed WebSocket clients and also buffered
in `task.output`. Clients subscribe with `{type:"subscribe", taskId}` and
can send `{type:"input", data}` to type into the terminal or
`{type:"resize", cols, rows}` to match their local term size.

### Frontend same-origin wiring

Both frontends were originally coded to hit the runner / ollama on absolute
URLs. The copies in this repo have been patched to use same-origin paths so
everything works through the single gateway port:

- `trello-clone/src/services/claudeRunner.ts` — in production, `RUNNER_BASE=''`
  (relative) and the WebSocket URL is derived from `window.location`.
- `trello-clone/src/services/ai.ts` — `API_CHAT_URL` is hardcoded to
  `/ollama-api/chat` in both dev and prod (the gateway proxies).
- `ai-assistant/public/index.html` — `const API` auto-detects whether the
  page is served under `/assistant` and sets itself accordingly.

If you re-sync from upstream, re-apply these edits or the frontends will
call wrong URLs in the Docker build.

### RAG store topology

`ai-assistant/src/utils/db.ts` creates a `documents` table with
`vector(768)` embeddings and an HNSW index for cosine similarity, plus a
`chat_history` table. The `pgvector` extension must be enabled — the
compose setup does this via `ai-assistant/init-db.sql` mounted into
`/docker-entrypoint-initdb.d`. Use the `pgvector/pgvector:pg16` image, not
plain `postgres`.

Embeddings default to `nomic-embed-text` (768 dims). If you change
`EMBEDDING_MODEL` to one with a different dim count, you must drop the
`documents` table — the column type is hardcoded.

### MCP server — runner + dev memory tools

`claude-code-runner/mcp-server/index.js` is a stdio MCP server (not
auto-started by compose — register it in your Claude Code config). It
exposes two groups of tools:

**Runner control:**
- `run_claude_code` — submit prompt + (optionally) wait for completion
- `get_task_status` — poll by task id
- `list_tasks` — summary of all tasks
- `stop_task`, `delete_task` — lifecycle
- `send_input` — type into a running task's PTY over WebSocket

**Dev memory (RAG-backed):**
- `save_dev_log` — chunks + embeds a note into the `ai-assistant` store via
  `POST /assistant/api/documents/split` (uses the merged gateway by default)
- `search_dev_logs` — semantic search via `POST /assistant/api/documents/search`
- `ask_dev_memory` — grounded Q&A via `POST /assistant/api/chat`

These tools talk to the RAG service through the **gateway's `/assistant`
proxy** by default (`RAG_BASE = ${BACKEND_URL}/assistant`), so a single
`BACKEND_URL` env var is enough when the MCP runs outside the compose
network. Set `ASSISTANT_URL` to hit the RAG service directly instead.

## Non-obvious things to know

- **`trello-clone` has pre-existing TypeScript errors** (missing
  `SpeechRecognition` types, a `useClickOutside` arg mismatch). The root
  `Dockerfile` runs `npx vite build` instead of `npm run build` to skip
  `tsc -b`. Don't "fix" the Dockerfile to use `npm run build` without also
  fixing those TS errors first.

- **`node-pty` needs native build tools** — the runner-deps stage installs
  `python3 make g++` on `node:20-bookworm-slim`. Keep the stage split so
  these don't bloat the runtime image.

- **Shell detection for PTY** — `server.js` picks `process.env.SHELL` →
  `/bin/zsh` if present → `/bin/bash`. The Docker image only ships bash, so
  the fallback is what actually runs in production. If you add zsh to the
  image, behavior will change.

- **`claude` CLI is installed globally** in the runtime image
  (`@anthropic-ai/claude-code`). It still needs `ANTHROPIC_API_KEY` set at
  runtime to actually authenticate — see the commented block in
  `docker-compose.yml`.

- **Compose service names are DNS names**. The runner reaches the RAG
  service as `http://ai-assistant:3000`; the RAG service reaches Postgres
  as `db:5432`. If you rename a service, update `ASSISTANT_URL` and
  `DATABASE_URL` accordingly.

- **`workspace` volume** is mounted at `/workspace` in the gateway
  container — point the runner's task `workingDir` there if you want
  generated files to survive restarts.

- **Don't touch the upstream source folders.** Copies are authoritative
  here; the originals at `/Users/administrator/Documents/project/{trello-clone,Claude-Code-Runner,ai-assistant}`
  must stay untouched.
