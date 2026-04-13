#!/usr/bin/env bash
# Launch ai-assistant + claude-code-runner gateway together.
# The gateway serves trello-clone/dist, so the frontend just needs to be pre-built.
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$*"; }

# ─── Load .env ───────────────────────────────────────────────
if [ -f .env ]; then
  set -a; . ./.env; set +a
else
  warn ".env not found — run ./setup.sh first (or copy .env.example to .env)"
fi

export PORT="${PORT:-3456}"
export AI_ASSISTANT_PORT="${AI_ASSISTANT_PORT:-3000}"
export ASSISTANT_URL="${ASSISTANT_URL:-http://localhost:${AI_ASSISTANT_PORT}}"
export OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
export OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
export OLLAMA_API_URL="${OLLAMA_API_URL:-http://localhost:11434}"
export EMBEDDING_MODEL="${EMBEDDING_MODEL:-nomic-embed-text}"
export CHAT_MODEL="${CHAT_MODEL:-llama3.2:1b}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-$CHAT_MODEL}"
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/ai_assistant}"

# ─── Pre-flight ──────────────────────────────────────────────
if [ ! -d trello-clone/dist ]; then
  log "trello-clone/dist missing — building now"
  (cd trello-clone && npx vite build)
fi

if [ ! -d ai-assistant/node_modules ] || [ ! -d claude-code-runner/node_modules ]; then
  warn "Subproject node_modules missing — run ./setup.sh first"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1 || ! pg_isready -q 2>/dev/null; then
  warn "Postgres does not appear to be running — start it (e.g. 'brew services start postgresql@16')"
fi

if ! curl -fsS "${OLLAMA_URL}/api/tags" >/dev/null 2>&1; then
  warn "Ollama at $OLLAMA_URL is unreachable — start it (e.g. 'brew services start ollama')"
fi

# ─── Launch both services via concurrently ───────────────────
log "Starting ai-assistant (port $AI_ASSISTANT_PORT) + gateway (port $PORT)"
log "Open http://localhost:${PORT} when ready"

exec npx concurrently \
  -n assistant,runner \
  -c blue,green \
  --kill-others-on-fail \
  "PORT=$AI_ASSISTANT_PORT npm --prefix ai-assistant run dev" \
  "node claude-code-runner/server.js"
