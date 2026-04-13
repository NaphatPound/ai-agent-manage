# AI Agent Board

Merged distribution of three projects served from a single gateway on port
3456:

- **trello-clone** — React + Vite board UI (root `/`)
- **claude-code-runner** — Express + node-pty terminal bridge (`/runner`, `/api/*`, WebSocket)
- **ai-assistant** — RAG + chat + MCP orchestrator backed by Postgres + pgvector (`/assistant`)

```
ai-agent-manage/
├── package.json           — root launcher (install / build / start scripts)
├── setup.sh               — one-shot bootstrap (deps, DB, models, builds)
├── start.sh               — launch ai-assistant + gateway together
├── .env.example           — copy to .env and edit if your ports/DB differ
├── trello-clone/          — React frontend (built into dist/)
├── claude-code-runner/    — Express server + WebSocket PTY bridge + MCP server
└── ai-assistant/          — TypeScript RAG/chat service
```

## Prerequisites

Installed on the host (macOS or Linux):

| Tool                                      | Notes                                           |
| ----------------------------------------- | ----------------------------------------------- |
| **Node.js 20+**                           | `brew install node` / nvm / nodejs.org           |
| **PostgreSQL 16** + **pgvector** extension | `brew install postgresql@16 pgvector`            |
| **Ollama**                                | `brew install ollama` or https://ollama.com     |
| **`claude` CLI**                          | `npm i -g @anthropic-ai/claude-code` (setup.sh does this) |

`setup.sh` will install the Homebrew-able pieces for you on macOS.

## First-time setup

```bash
cp .env.example .env      # optional — defaults work for a fresh install
./setup.sh                # install deps, create DB, build UI, pull models
```

`setup.sh` is idempotent — re-run it any time you pull new code or want to
rebuild the trello-clone bundle.

## Run

```bash
./start.sh                # or: npm start
```

Then open <http://localhost:3456>. The Trello-style board is served at `/`,
and the raw runner terminal UI is reachable at `/runner`.

`start.sh` launches two Node processes side-by-side via `concurrently`:

1. `ai-assistant` — RAG + chat service on port **3000** (internal)
2. `claude-code-runner/server.js` — gateway on port **3456** (exposed)

Ctrl-C stops both. If either process crashes, the other is killed too.

## Developing a single subproject

```bash
# Frontend with HMR on :5173 (talks to the gateway on :3456 for APIs)
npm --prefix trello-clone run dev

# RAG service only
npm --prefix ai-assistant run dev

# Runner gateway only
node claude-code-runner/server.js
```

## Configuration (.env)

| Variable              | Default                                               | Purpose                                        |
| --------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| `PORT`                | `3456`                                                | Gateway HTTP + WebSocket port                  |
| `AI_ASSISTANT_PORT`   | `3000`                                                | Internal port for the RAG service              |
| `ASSISTANT_URL`       | `http://localhost:3000`                               | Where the gateway proxies `/assistant/*`       |
| `OLLAMA_URL`          | `http://localhost:11434`                              | Ollama daemon for chat/embeddings              |
| `OLLAMA_AUTH_TOKEN`   | *(none)*                                              | Bearer token when using Ollama Cloud           |
| `DATABASE_URL`        | `postgresql://postgres:postgres@localhost:5432/ai_assistant` | RAG store                             |
| `EMBEDDING_MODEL`     | `nomic-embed-text`                                    | Must be pulled via `ollama pull`               |
| `CHAT_MODEL`          | `llama3.2:1b`                                         | Default chat model                             |
| `API_KEY`             | *(none)*                                              | Optional bearer token for `/api/*`             |
| `ANTHROPIC_API_KEY`   | *(none)*                                              | Enables Claude-powered stall detection         |
| `STALL_DETECTION`     | `true`                                                | Set `false` to disable auto-unsticking         |
| `MODELS`              | *(none)*                                              | Comma-separated override of the models dropdown |

## How the projects are wired together

- The trello-clone Vite app is compiled to `trello-clone/dist` during setup.
- The runner's Express server (`claude-code-runner/server.js`) is the single
  gateway:
  - `/` → trello-clone SPA (served from `dist/`)
  - `/runner/*` → original runner terminal UI
  - `/api/*` → runner REST API (tasks, models, stop/delete)
  - `/assistant/*` → reverse-proxied to the local `ai-assistant` process
  - `/ollama-api/*` → reverse-proxied to `OLLAMA_URL`
  - WebSocket (`ws://localhost:3456`) attaches to the same HTTP server for PTY streaming
- `ai-assistant` connects to Postgres via `DATABASE_URL`.
- The single host-facing port is `3456`.

## RAG / memory for dev work

`ai-assistant` exposes a semantic store backed by pgvector. The runner's MCP
server (`claude-code-runner/mcp-server/index.js`) ships three RAG-aware tools
so Claude Code sessions can capture and recall long-lived context:

| Tool              | What it does                                                    |
| ----------------- | --------------------------------------------------------------- |
| `save_dev_log`    | Chunks + embeds a dev-log entry (decision / memory / doc)        |
| `search_dev_logs` | Semantic search over saved logs with % match scores              |
| `ask_dev_memory`  | Grounded Q&A via the assistant's `/api/chat` (RAG + LLM)         |

Register the MCP server in your Claude Code config to let it auto-save
rationale, bug notes, and feature specs as you work, and retrieve them on the
next session.

## Troubleshooting

- **`psql: could not connect to server`** — start Postgres: `brew services start postgresql@16`
- **`ollama: connection refused`** — start Ollama: `brew services start ollama` (or `ollama serve`)
- **`extension "vector" is not available`** — install pgvector: `brew install pgvector`, then re-run `setup.sh`
- **node-pty build fails** — install Xcode CLT on macOS: `xcode-select --install`
- **`claude: command not found`** — `npm i -g @anthropic-ai/claude-code`
