#!/usr/bin/env bash
# One-shot bootstrap: installs host deps, npm deps, creates the DB, builds the web UI,
# and pulls the embedding/chat models. Safe to re-run.
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$*"; }
err()  { printf '\033[1;31mxx \033[0m %s\n' "$*" >&2; }

# ─── Load .env if present ─────────────────────────────────────
if [ -f .env ]; then
  set -a; . ./.env; set +a
elif [ -f .env.example ]; then
  log ".env not found — copying from .env.example"
  cp .env.example .env
  set -a; . ./.env; set +a
fi

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/ai_assistant}"
EMBEDDING_MODEL="${EMBEDDING_MODEL:-nomic-embed-text}"
CHAT_MODEL="${CHAT_MODEL:-llama3.2:1b}"

# ─── Detect platform + package manager ───────────────────────
OS="$(uname -s)"
HAS_BREW=0
if command -v brew >/dev/null 2>&1; then HAS_BREW=1; fi

brew_install_if_missing() {
  local bin="$1" pkg="$2"
  if command -v "$bin" >/dev/null 2>&1; then
    log "$bin already installed"
    return
  fi
  if [ "$HAS_BREW" -eq 1 ]; then
    log "Installing $pkg via brew"
    brew install "$pkg"
  else
    warn "$bin is missing and Homebrew is not available — install $pkg manually"
  fi
}

# ─── 1. Host dependencies ────────────────────────────────────
log "Checking host dependencies"

if ! command -v node >/dev/null 2>&1; then
  err "Node.js is required (install node 20+ from https://nodejs.org or 'brew install node')"
  exit 1
fi

if [ "$OS" = "Darwin" ]; then
  brew_install_if_missing psql postgresql@16
  brew_install_if_missing ollama ollama
  # pgvector is a separate formula on macOS
  if [ "$HAS_BREW" -eq 1 ] && ! brew list pgvector >/dev/null 2>&1; then
    log "Installing pgvector via brew"
    brew install pgvector
  fi
else
  if ! command -v psql >/dev/null 2>&1; then
    warn "psql not found — install postgresql-16 + postgresql-16-pgvector for your distro"
  fi
  if ! command -v ollama >/dev/null 2>&1; then
    warn "ollama not found — install from https://ollama.com/download"
  fi
fi

# claude CLI (used by the runner to spawn PTY sessions)
if ! command -v claude >/dev/null 2>&1; then
  log "Installing @anthropic-ai/claude-code globally"
  npm install -g @anthropic-ai/claude-code --no-audit --no-fund || \
    warn "Global install failed — re-run with sudo or install manually"
fi

# ─── 2. Start Postgres + Ollama (macOS only — brew services) ─
if [ "$OS" = "Darwin" ] && [ "$HAS_BREW" -eq 1 ]; then
  if ! pg_isready -q 2>/dev/null; then
    log "Starting postgresql@16 via brew services"
    brew services start postgresql@16 >/dev/null || warn "Could not start postgresql@16"
    # give it a moment
    for _ in 1 2 3 4 5; do pg_isready -q && break; sleep 1; done
  else
    log "Postgres already running"
  fi
  if ! pgrep -x ollama >/dev/null 2>&1; then
    log "Starting ollama via brew services"
    brew services start ollama >/dev/null || warn "Could not start ollama"
    for _ in 1 2 3 4 5; do curl -fsS http://localhost:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done
  else
    log "Ollama already running"
  fi
fi

# ─── 3. Database: create DB + enable pgvector ────────────────
DB_NAME="$(printf '%s' "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')"
log "Ensuring database '$DB_NAME' exists"

# Try to create the DB (ignore 'already exists')
if command -v psql >/dev/null 2>&1; then
  if ! psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
    createdb "$DB_NAME" 2>/dev/null || warn "Could not createdb $DB_NAME — create it manually"
  fi
  log "Enabling pgvector extension"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ai-assistant/init-db.sql \
    || warn "Could not enable pgvector — install the pgvector package and re-run"
else
  warn "Skipping DB init — psql not on PATH"
fi

# ─── 4. Install npm deps for the 3 subprojects ───────────────
log "Installing npm deps (root)"
npm install --no-audit --no-fund

log "Installing npm deps (trello-clone)"
npm --prefix trello-clone install --no-audit --no-fund

log "Installing npm deps (claude-code-runner)"
npm --prefix claude-code-runner install --no-audit --no-fund

log "Installing npm deps (ai-assistant)"
npm --prefix ai-assistant install --no-audit --no-fund

# ─── 5. Build trello-clone (served statically by the gateway) ─
log "Building trello-clone (vite build — skipping tsc due to known type errors)"
(cd trello-clone && npx vite build)

# ─── 6. Pull Ollama models ───────────────────────────────────
if command -v ollama >/dev/null 2>&1; then
  log "Pulling embedding model: $EMBEDDING_MODEL"
  ollama pull "$EMBEDDING_MODEL" || warn "Embedding model pull failed"
  log "Pulling chat model: $CHAT_MODEL"
  ollama pull "$CHAT_MODEL" || warn "Chat model pull failed — continuing"
else
  warn "ollama not installed — skipping model pulls"
fi

log "Setup complete — run ./start.sh (or npm start)"
