# AI Agent Board

Merged distribution of three projects served from a single gateway on port
3456:

- **trello-clone** — React + Vite board UI (root `/`)
- **Claude-Code-Runner** — Express + node-pty terminal bridge (`/runner`, `/api/*`, WebSocket)
- **ai-assistant** — RAG + chat + MCP orchestrator backed by Postgres + pgvector (`/assistant`)

```
ai-agent-borad/
├── Dockerfile              — gateway image (Vite → node-pty → runtime)
├── docker-compose.yml      — one-command launch (gateway + assistant + db)
├── trello-clone/           — React frontend sources (built into dist at image-build time)
├── claude-code-runner/     — Express server + WebSocket PTY bridge + MCP server
└── ai-assistant/           — TypeScript RAG/chat service (its own Dockerfile)
```

## Run with one command

```bash
docker compose up --build
```

Then open <http://localhost:3456> — the Trello-style board is served at `/`,
and the raw runner terminal UI is reachable at `/runner`.

To rebuild from scratch after source changes:

```bash
docker compose up --build --force-recreate
```

To stop:

```bash
docker compose down
```

## Without docker-compose

```bash
docker build -t ai-agent-board .
docker run --rm -p 3456:3456 ai-agent-board
```

## Configuration

Environment variables (set in `docker-compose.yml` or via `-e` on `docker run`):

| Variable              | Default  | Purpose                                         |
| --------------------- | -------- | ----------------------------------------------- |
| `PORT`                | `3456`   | HTTP + WebSocket port                           |
| `API_KEY`             | *(none)* | Bearer token required for `/api/*` requests     |
| `ANTHROPIC_API_KEY`   | *(none)* | Enables Claude-powered stall detection          |
| `STALL_DETECTION`     | `true`   | Set `false` to disable auto-unsticking          |
| `MODELS`              | *(none)* | Comma-separated override of the models dropdown |

## How the projects are wired together

* At build time the Vite app is compiled to `trello-clone/dist`.
* The runner's Express server (`claude-code-runner/server.js`) acts as the
  single gateway:
  * `/` → trello-clone SPA
  * `/runner/*` → original runner terminal UI
  * `/api/*` → runner REST API (tasks, models, stop/delete)
  * `/assistant/*` → reverse-proxied to the `ai-assistant` container (RAG, chat, documents)
  * `/ollama-api/*` → reverse-proxied to `https://ollama.com/api/*`
  * WebSocket (`ws://<host>:3456`) attaches to the same HTTP server for PTY streaming
* `ai-assistant` connects to the `db` service (pgvector) over the compose network.
* The single published port is `3456` — everything else stays on the internal
  compose network.

## RAG / memory for dev work

`ai-assistant` exposes a semantic store backed by pgvector. The runner's MCP
server (`claude-code-runner/mcp-server/index.js`) ships three RAG-aware tools
so Claude Code sessions can capture and recall long-lived context:

| Tool              | What it does                                                   |
| ----------------- | -------------------------------------------------------------- |
| `save_dev_log`    | Chunks + embeds a dev-log entry (decision / memory / doc)       |
| `search_dev_logs` | Semantic search over saved logs with % match scores             |
| `ask_dev_memory`  | Grounded Q&A via the assistant's `/api/chat` (RAG + LLM)        |

Register the MCP server in your Claude Code config to let it auto-save
rationale, bug notes, and feature specs as you work, and retrieve them on the
next session.

## Notes

* The container ships with `@anthropic-ai/claude-code` globally installed so
  the runner can spawn `claude` inside a PTY. Provide your Anthropic API key
  via `ANTHROPIC_API_KEY` to actually run Claude.
* A named `workspace` volume is mounted at `/workspace` — point the runner's
  task `workingDir` there if you want generated files to survive restarts.
