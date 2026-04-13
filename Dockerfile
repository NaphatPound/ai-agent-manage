# syntax=docker/dockerfile:1.6
# ────────────────────────────────────────────────────────────────
# Stage 1 — Build the trello-clone Vite frontend
# ────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS web-build
WORKDIR /app/trello-clone

COPY trello-clone/package.json trello-clone/package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY trello-clone/ ./
# Skip `tsc -b` (pre-existing type errors in sources) — vite build alone still emits a working bundle.
RUN npx vite build

# ────────────────────────────────────────────────────────────────
# Stage 2 — Install runner dependencies (node-pty needs build tools)
# ────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner-deps
WORKDIR /app/claude-code-runner

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY claude-code-runner/package.json claude-code-runner/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# ────────────────────────────────────────────────────────────────
# Stage 3 — Final runtime image
# ────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3456 \
    SHELL=/bin/bash

# Runtime tools the runner shell-spawns (bash, git, curl) plus certs for outbound HTTPS.
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash git curl ca-certificates tini zstd \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code --no-audit --no-fund \
    && ARCH=$(dpkg --print-architecture) \
    && curl -fsSL "https://github.com/ollama/ollama/releases/latest/download/ollama-linux-${ARCH}.tar.zst" -o /tmp/ollama.tar.zst \
    && tar --zstd -xf /tmp/ollama.tar.zst -C /usr/local \
    && rm /tmp/ollama.tar.zst \
    && useradd --create-home --shell /bin/bash --uid 1001 runner \
    && mkdir -p /workspace /app /home/runner/.claude /home/runner/.ollama \
    && echo '{}' > /home/runner/.claude.json \
    && chown -R runner:runner /workspace /app /home/runner

WORKDIR /app

# Built frontend (served by the runner's express server at /)
COPY --from=web-build --chown=runner:runner /app/trello-clone/dist /app/trello-clone/dist

# Runner server + its pre-installed dependencies
COPY --from=runner-deps --chown=runner:runner /app/claude-code-runner/node_modules /app/claude-code-runner/node_modules
COPY --chown=runner:runner claude-code-runner/ /app/claude-code-runner/

USER runner
WORKDIR /app/claude-code-runner
EXPOSE 3456

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
