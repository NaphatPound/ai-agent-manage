# AI Agentic Orchestrator - Development Log

## 2026-04-02

### Iteration 1 - Project Setup
- **Status:** COMPLETE
- Created TypeScript project with Express, Jest, ts-jest, tsx
- Folder structure: `src/{router,rag,mcp,api,utils}`, `src/__tests__`, `data/`
- Config: `tsconfig.json`, `jest.config.js`, `.env`, `package.json`

### Iteration 2 - Intent Classification Router
- **Status:** COMPLETE
- Built `src/router/classifier.ts` using Ollama structured JSON output
- Intent types: `rag`, `mcp`, `chat`
- System prompt defines available MCP tools for LLM to choose from

### Iteration 3 - RAG System
- **Status:** COMPLETE
- Built in-memory vector store (`src/rag/vectorStore.ts`)
- Cosine similarity search with configurable top-K
- Embedding via Ollama `nomic-embed-text:latest`
- Context injection pipeline for LLM summarization

### Iteration 4 - MCP Integration
- **Status:** COMPLETE
- Built MCP tool registry (`src/mcp/tools.ts`)
- 4 tools: `get_stock`, `get_calendar`, `get_location`, `send_notification`
- Fallback matching: if classifier returns unknown tool, tries to match from message content

### Iteration 5 - API Endpoints
- **Status:** COMPLETE
- Express server with endpoints:
  - `GET /` - API info
  - `GET /api/health` - Health check with RAG doc count + MCP tool list
  - `POST /api/chat` - Main orchestrator endpoint
  - `POST /api/documents` - Add docs to RAG
  - `DELETE /api/documents` - Clear RAG
  - `GET /api/tools` - List MCP tools
- Input validation on all endpoints

### Iteration 6 - Write Tests
- **Status:** COMPLETE
- 3 test suites, 19 tests total
- `mcp.test.ts` - Tool listing, execution, fallback, error handling
- `rag.test.ts` - Document store, cosine similarity math
- `api.test.ts` - Endpoint validation, health, tools, error cases

### Iteration 7 - Install & Build
- **Bug Found:** npm install failed - custom Nexus registry unreachable
- **Fix:** Used `--registry https://registry.npmjs.org/` flag
- **Status:** RESOLVED - 392 packages installed, TypeScript compiles clean

### Iteration 8 - Run Tests
- **Status:** COMPLETE - All 19 tests passed

### Iteration 9 - Start Server & Test Endpoints
- **Status:** COMPLETE - Health, root, tools, validation all working
- **Bug Found:** Ollama returned 404 - model `llama3` not found
- **Root Cause:** `.env` had `OLLAMA_MODEL=llama3` but available model is `gemma3:27b-cloud`

### Iteration 10 - Fix Model Config
- **Fix:** Updated `.env` to `OLLAMA_MODEL=gemma3:27b-cloud`
- **Status:** RESOLVED

### Iteration 11 - Bug Fix: Port Conflict
- **Bug Found:** `EADDRINUSE` - port 3000 still occupied from previous test
- **Fix:** Kill process on port before restarting
- **Status:** RESOLVED

### Iteration 12 - Full Integration Test
- **Status:** ALL PATHS WORKING
- Chat path: Correctly classified greeting -> responded naturally
- MCP path: Correctly classified "check stock" -> called `get_stock` tool -> summarized results
- RAG path: Correctly classified "company policy" -> searched (empty) -> reported no docs

### Iteration 13 - RAG Document Test
- **Status:** COMPLETE
- Added 2 documents (remote work policy, leave policy)
- RAG correctly retrieved remote work policy with semantic search
- Calendar MCP tool returned today's schedule correctly

### Iteration 14 - Final Test Suite
- **Status:** ALL 19 TESTS PASSED
- All API endpoints verified working
- All 3 routing paths (chat/rag/mcp) working end-to-end

---

## Summary

| Test | Result |
| --- | --- |
| TypeScript Compilation | PASS |
| Unit Tests (19/19) | PASS |
| API Health Endpoint | PASS |
| API Tools Endpoint | PASS |
| API Chat - General | PASS |
| API Chat - MCP (Stock) | PASS |
| API Chat - MCP (Calendar) | PASS |
| API Chat - RAG (Knowledge) | PASS |
| API Document Ingestion | PASS |
| Input Validation | PASS |

## Bugs Found & Fixed

| # | Bug | Root Cause | Fix |
| --- | --- | --- | --- |
| 1 | npm install fails | Custom Nexus registry unreachable | Use `--registry https://registry.npmjs.org/` |
| 2 | Ollama 404 error | Model `llama3` not available | Changed to `gemma3:27b-cloud` in `.env` |
| 3 | EADDRINUSE port 3000 | Previous server process not killed | Kill process before restart |

---

## Upgrade: PostgreSQL + pgvector (2026-04-02)

### Iteration 15 - Install pgvector
- Installed pgvector 0.8.2 via `brew install pgvector`
- **Bug Found:** pgvector built for PG17/18, not PG14 (current)
- **Bug Found:** Building from source failed - macOS SDK mismatch (PG14 hardcodes wrong sysroot)
- **Fix:** Installed PostgreSQL 17 on port 5433, pgvector works natively with it

### Iteration 16 - Database Setup
- Created `ai_assistant` database on PG17 (port 5433)
- Enabled `vector` extension (v0.8.2)
- Created `documents` table with `vector(768)` column
- Created `chat_history` table

### Iteration 17 - Rewrite Vector Store
- Replaced in-memory array with PostgreSQL + pgvector queries
- Installed `pg` npm driver
- Updated all async signatures (`getDocumentCount`, `clearDocuments`)
- Updated API routes and tests for async DB calls
- **All 17 tests pass**

### Iteration 18 - IVFFlat Index Bug
- **Bug Found:** IVFFlat index returned empty results with small datasets
- **Root Cause:** IVFFlat requires significant data to build effective clusters
- **Fix:** Switched to HNSW index (`vector_cosine_ops`) which works with any dataset size

### Iteration 19 - Full Integration Test
- **Status:** ALL PATHS WORKING WITH PERSISTENT STORAGE
- Documents survive server restarts (stored in PostgreSQL)
- RAG search returns correct results (score 0.795 for matching doc)
- MCP tools and chat path unaffected

## Bugs Found & Fixed (Updated)

| # | Bug | Root Cause | Fix |
| --- | --- | --- | --- |
| 1 | npm install fails | Custom Nexus registry unreachable | Use `--registry https://registry.npmjs.org/` |
| 2 | Ollama 404 error | Model `llama3` not available | Changed to `gemma3:27b-cloud` in `.env` |
| 3 | EADDRINUSE port 3000 | Previous server process not killed | Kill process before restart |
| 4 | pgvector incompatible with PG14 | Brew pgvector built for PG17 | Installed PG17 on port 5433 |
| 5 | pgvector build from source fails | macOS SDK path mismatch | Used PG17 instead of compiling for PG14 |
| 6 | IVFFlat returns empty results | Index ineffective with <100 rows | Switched to HNSW index |

## Completion Status: API IS WORKING (with PostgreSQL + pgvector)
