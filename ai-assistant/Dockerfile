# syntax=docker/dockerfile:1.6
# ───────────────────────────────────────────────
# Build stage — TypeScript → JavaScript
# ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# ───────────────────────────────────────────────
# Runtime — slim image with prod deps only
# ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund \
    && apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist ./dist
COPY public ./public

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
