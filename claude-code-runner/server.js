const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const { spawn } = require('child_process');

// node-pty for real PTY (interactive terminal)
let pty;
try {
  pty = require('node-pty');
  console.log('✅ node-pty loaded — interactive terminal mode enabled');
} catch (e) {
  console.error('❌ node-pty is REQUIRED for interactive mode. Install it:');
  console.error('   npm install node-pty');
  process.exit(1);
}

// ─── Config ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3456;
const API_KEY = process.env.API_KEY || null;

// Stall detection config
const STALL_TIMEOUT_MS = parseInt(process.env.STALL_TIMEOUT_MS || '45000');       // 45s idle before analysis
const STALL_MAX_RETRIES = parseInt(process.env.STALL_MAX_RETRIES || '5');         // max auto-responses per task
const STALL_ANTHROPIC_KEY = process.env.STALL_ANALYSIS_API_KEY || process.env.ANTHROPIC_API_KEY || '';
// Auto-pick provider: prefer ollama cloud if OLLAMA_AUTH_TOKEN is set, else anthropic if a key is set.
const STALL_ANALYSIS_PROVIDER = (process.env.STALL_ANALYSIS_PROVIDER
  || (process.env.OLLAMA_AUTH_TOKEN ? 'ollama' : (STALL_ANTHROPIC_KEY ? 'anthropic' : 'none'))).toLowerCase();
const STALL_ANALYSIS_MODEL = process.env.STALL_ANALYSIS_MODEL
  || (STALL_ANALYSIS_PROVIDER === 'ollama' ? 'minimax-m2.7:cloud' : 'claude-sonnet-4-20250514');
const STALL_DETECTION_ENABLED = process.env.STALL_DETECTION !== 'false';          // enabled by default
const STALL_CONTEXT_CHARS = 2000;

// Available models — configure via MODELS env var (comma-separated) or edit defaults here.
// Claude-native IDs (claude-*, opus/sonnet/haiku)  → `claude --model <id>`
// Gemini IDs (gemini-*)                            → `gemini -y -m <id>`
// Ollama IDs (everything else, e.g. `minimax-m2.7:cloud`)
//                                                  → `ollama launch claude --model <id> -- --dangerously-skip-permissions`
const DEFAULT_MODELS = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', group: 'Claude' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', group: 'Claude' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', group: 'Claude' },
  { id: 'opus', name: 'Opus (alias)', group: 'Claude' },
  { id: 'sonnet', name: 'Sonnet (alias)', group: 'Claude' },
  { id: 'haiku', name: 'Haiku (alias)', group: 'Claude' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (preview)', group: 'Gemini' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (preview)', group: 'Gemini' },
  { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite (preview)', group: 'Gemini' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', group: 'Gemini' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', group: 'Gemini' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', group: 'Gemini' },
  { id: 'minimax-m2.7:cloud', name: 'Minimax M2.7 Cloud', group: 'Ollama' },
  { id: 'qwen3.5:397b-cloud', name: 'Qwen 3.5 397B Cloud', group: 'Ollama' },
  { id: 'glm-5.1:cloud', name: 'GLM 5.1 Cloud', group: 'Ollama' },
];

function isClaudeNativeModel(id) {
  return /^claude-/i.test(id) || /^(opus|sonnet|haiku)$/i.test(id);
}

function isGeminiModel(id) {
  return /^gemini/i.test(id);
}

function providerFor(modelId) {
  if (!modelId) return 'claude';
  if (isGeminiModel(modelId)) return 'gemini';
  if (isClaudeNativeModel(modelId)) return 'claude';
  return 'ollama';
}

// Gemini tasks fall back to silence-based completion (no ❯ prompt to watch).
const GEMINI_IDLE_COMPLETION_MS = parseInt(process.env.GEMINI_IDLE_COMPLETION_MS || '15000');

// ─── Auto-memory config ─────────────────────────────────────────
// When a task finishes, summarize what happened via Ollama Cloud and persist it
// both as a markdown file under MEMORY_DIR/<namespace>/ and as a chunked entry
// in the ai-assistant RAG store (namespace-tagged). Disable with MEMORY_AUTO_SAVE=false.
const MEMORY_AUTO_SAVE = process.env.MEMORY_AUTO_SAVE !== 'false';
const MEMORY_DIR = process.env.MEMORY_DIR
  || path.resolve(__dirname, '..', 'ai-assistant', 'memory');
const MEMORY_SUMMARY_MODEL = process.env.MEMORY_SUMMARY_MODEL || 'minimax-m2.7:cloud';
const MEMORY_OUTPUT_CHARS = parseInt(process.env.MEMORY_OUTPUT_CHARS || '4000');

function loadModels() {
  const envModels = process.env.MODELS;
  if (envModels) {
    return envModels.split(',').map((m) => m.trim()).filter(Boolean).map((id) => ({ id, name: id }));
  }
  return DEFAULT_MODELS;
}

const availableModels = loadModels();
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());

// ─── AI-Assistant reverse proxy (RAG + chat backend) ──────────────────────────
// /assistant/* → ASSISTANT_URL/* (prefix stripped). Streams request + response.
const ASSISTANT_URL = process.env.ASSISTANT_URL || 'http://ai-assistant:3000';
app.use('/assistant', (req, res) => {
  const target = new URL(ASSISTANT_URL);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['accept-encoding'];

  const upstreamMod = target.protocol === 'https:' ? https : http;
  const upstream = upstreamMod.request(
    {
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: (target.pathname.replace(/\/$/, '') + req.url) || '/',
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    console.error('[assistant-proxy] error:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Assistant proxy failed: ' + err.message });
    else res.end();
  });
  req.pipe(upstream);
});

// ─── Ollama API reverse proxy (streams /ollama-api/* → OLLAMA_URL/api/*) ────────
// Default target is the in-compose `ollama` service. Override with OLLAMA_URL.
// Must be mounted BEFORE express.json() so request bodies stream through untouched.
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
app.use('/ollama-api', (req, res) => {
  const target = new URL(OLLAMA_URL);
  const targetPath = (target.pathname.replace(/\/$/, '') + '/api' + req.url) || '/api' + req.url;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['accept-encoding'];
  if (process.env.OLLAMA_AUTH_TOKEN) {
    headers['authorization'] = `Bearer ${process.env.OLLAMA_AUTH_TOKEN}`;
  }

  const upstreamMod = target.protocol === 'https:' ? https : http;
  const upstream = upstreamMod.request(
    {
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: targetPath,
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    console.error('[ollama-proxy] error:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Ollama proxy failed: ' + err.message });
    else res.end();
  });
  req.pipe(upstream);
});

app.use(express.json());

// Serve the merged trello-clone frontend (built Vite output) as the root app.
// The runner's own terminal UI is still reachable at /runner for debugging.
const TRELLO_DIST = path.join(__dirname, '..', 'trello-clone', 'dist');
app.use('/runner', express.static(path.join(__dirname, 'public')));
if (fs.existsSync(TRELLO_DIST)) {
  app.use(express.static(TRELLO_DIST));
} else {
  // Fallback to the runner UI if the trello build is missing (e.g. dev-only run)
  app.use(express.static(path.join(__dirname, 'public')));
}

// ─── API Key Authentication Middleware ─────────────────────────
function authMiddleware(req, res, next) {
  if (!API_KEY) return next(); // No key set — public access

  const bearer = req.headers.authorization;
  const xApiKey = req.headers['x-api-key'];

  const token = bearer?.startsWith('Bearer ') ? bearer.slice(7) : xApiKey;

  if (token === API_KEY) return next();
  return res.status(401).json({ error: 'Unauthorized: invalid or missing API key' });
}

app.use('/api', authMiddleware);

// ─── Task Store (in-memory) ────────────────────────────────────
const tasks = new Map();

class Task {
  constructor({ prompt, workingDir, callbackUrl, model, boardId, mode }) {
    this.id = uuidv4();
    this.prompt = prompt;
    this.workingDir = workingDir || process.cwd();
    this.callbackUrl = callbackUrl || null;
    this.model = model || null;
    this.boardId = boardId || null;
    this.mode = mode === 'loop' ? 'loop' : 'one-time';
    this.status = 'queued';
    this.awaitingSituation = null;
    this.awaitingQuestion = null;
    this.output = '';
    this.createdAt = new Date().toISOString();
    this.startedAt = null;
    this.finishedAt = null;
    this.exitCode = null;
    this.stallResponses = [];
    this.ptyProcess = null;
    this.subscribers = new Set();
  }

  toJSON() {
    return {
      id: this.id,
      prompt: this.prompt,
      workingDir: this.workingDir,
      callbackUrl: this.callbackUrl,
      model: this.model,
      boardId: this.boardId,
      mode: this.mode,
      status: this.status,
      output: this.output,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      exitCode: this.exitCode,
      stallResponses: this.stallResponses,
      awaitingSituation: this.awaitingSituation,
      awaitingQuestion: this.awaitingQuestion,
    };
  }

  toStatus() {
    // 'loop' and 'awaiting_user' tasks are intentionally kept alive, so they
    // are NOT considered done — only the terminal states are.
    const done = ['completed', 'failed', 'stopped'].includes(this.status);
    return {
      id: this.id,
      status: this.status,
      done,
      exitCode: this.exitCode,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
    };
  }

  toSummary() {
    return {
      id: this.id,
      prompt: this.prompt.substring(0, 100) + (this.prompt.length > 100 ? '...' : ''),
      status: this.status,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
    };
  }
}

// ─── Broadcast to task subscribers ─────────────────────────────
function broadcast(task, message) {
  const data = JSON.stringify(message);
  task.subscribers.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

// ─── Webhook notification ─────────────────────────────────────
function sendWebhook(task) {
  if (!task.callbackUrl) return;
  fetch(task.callbackUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task.toJSON()),
  }).catch((err) => {
    console.error(`[Task ${task.id}] Webhook failed:`, err.message);
  });
}

// ─── Notify status change (WebSocket + Webhook) ──────────────
function notifyStatusChange(task, extra = {}) {
  broadcast(task, { type: 'status', status: task.status, ...extra });
  sendWebhook(task);
}

// ─── Stall Detection & AI Auto-Response ─────────────────────────
let stallApiKeyWarned = false;

const STALL_SYSTEM_PROMPT = `You are analyzing terminal output from Claude Code CLI that has stopped producing output for a while.
Determine what Claude Code is waiting for and respond with ONLY a JSON object (no markdown, no explanation, no <think> tags):
{
  "situation": "brief description of what's happening (one short sentence)",
  "question": "if Claude is asking a question, restate it in plain English; otherwise empty string",
  "action": "press_enter" | "press_yes" | "press_no" | "type_text" | "send_instruction" | "ask_user" | "skip",
  "response": "the text to type (only for type_text or send_instruction actions, otherwise empty string)",
  "confidence": 0.0 to 1.0
}

Rules for choosing action:
- "press_yes" — Claude is asking a routine yes/no permission question where Yes is the obviously safe answer (e.g. "Allow me to read this file?", "Continue?", standard confirmations).
- "press_no" — Claude is asking a yes/no where No is clearly right (e.g. "Proceed with a destructive action?").
- "press_enter" — Claude is waiting for an acknowledgement / any-key-to-continue.
- "type_text" — Claude is asking which of several option values to pick and a safe default is obvious. Put the default in "response".
- "send_instruction" — Claude hit an error, is confused, or needs to be nudged back to the task. Put a short guiding instruction in "response". Always tell it to find and suggest solutions, not execute blindly.
- "ask_user" — IMPORTANT. Use this when Claude is asking something that only the human user can decide: a design choice, a product decision, a name/value the AI cannot guess safely, a destructive action, a credential or personal preference, or anything ambiguous. Put the restated question in "question" so the user UI can display it clearly. Do NOT type anything into the terminal — just flag it.
- "skip" — Claude looks like it is still thinking/streaming, or you cannot tell what's happening, or your confidence is below 0.4.

Safety:
- Never send passwords, secrets, credentials, or destructive shell commands.
- When in doubt between an automated response and ask_user, prefer ask_user — it is always safer to escalate to the human.`;

function buildStallUserMessage(recentOutput) {
  return `Claude Code has been idle with no output for ${STALL_TIMEOUT_MS / 1000} seconds. Here is the last terminal output:\n\n${recentOutput}`;
}

function parseStallJson(text) {
  // Strip <think>...</think> tags (minimax / qwen reasoning models)
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try { return JSON.parse(jsonMatch[0]); } catch { return null; }
}

async function analyzeStallViaAnthropic(taskId, recentOutput) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': STALL_ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: STALL_ANALYSIS_MODEL,
      max_tokens: 512,
      system: STALL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildStallUserMessage(recentOutput) }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[Task ${taskId}] Stall Anthropic error ${res.status}: ${errText}`);
    return null;
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function analyzeStallViaOllama(taskId, recentOutput) {
  const target = new URL(OLLAMA_URL);
  const apiPath = (target.pathname.replace(/\/$/, '') + '/api/chat') || '/api/chat';
  const endpoint = `${target.protocol}//${target.host}${apiPath}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.OLLAMA_AUTH_TOKEN ? { 'Authorization': `Bearer ${process.env.OLLAMA_AUTH_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      model: STALL_ANALYSIS_MODEL,
      stream: false,
      messages: [
        { role: 'system', content: STALL_SYSTEM_PROMPT },
        { role: 'user', content: buildStallUserMessage(recentOutput) },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[Task ${taskId}] Stall Ollama error ${res.status}: ${errText}`);
    return null;
  }
  const data = await res.json();
  return data.message?.content || '';
}

async function analyzeStall(taskId, recentOutput) {
  if (STALL_ANALYSIS_PROVIDER === 'none') {
    if (!stallApiKeyWarned) {
      console.log('[Stall] No OLLAMA_AUTH_TOKEN or ANTHROPIC_API_KEY set — stall analysis disabled');
      stallApiKeyWarned = true;
    }
    return null;
  }

  try {
    const text = STALL_ANALYSIS_PROVIDER === 'ollama'
      ? await analyzeStallViaOllama(taskId, recentOutput)
      : await analyzeStallViaAnthropic(taskId, recentOutput);
    if (!text) return null;

    const analysis = parseStallJson(text);
    if (!analysis) {
      console.error(`[Task ${taskId}] Stall analysis returned non-JSON: ${text.slice(0, 200)}`);
      return null;
    }

    if (typeof analysis.confidence === 'number' && analysis.confidence < 0.4) {
      console.log(`[Task ${taskId}] Stall analysis low confidence (${analysis.confidence}): ${analysis.situation}`);
      return { ...analysis, action: 'skip' };
    }

    return analysis;
  } catch (err) {
    console.error(`[Task ${taskId}] Stall analysis failed:`, err.message);
    return null;
  }
}

function executeStallResponse(ptyProcess, task, analysis) {
  switch (analysis.action) {
    case 'press_enter':
      ptyProcess.write('\r');
      break;
    case 'press_yes':
      ptyProcess.write('yes\r');
      break;
    case 'press_no':
      ptyProcess.write('no\r');
      break;
    case 'type_text':
    case 'send_instruction':
      if (analysis.response) {
        ptyProcess.write(analysis.response + '\r');
      }
      break;
    case 'ask_user':
      // Don't touch the PTY — escalate to the human via status + WS event.
      task.status = 'awaiting_user';
      task.awaitingSituation = analysis.situation || '';
      task.awaitingQuestion = analysis.question || analysis.situation || '';
      console.log(`[Task ${task.id}] Awaiting user input — ${task.awaitingQuestion}`);
      broadcast(task, {
        type: 'awaiting_user',
        taskId: task.id,
        boardId: task.boardId || null,
        situation: task.awaitingSituation,
        question: task.awaitingQuestion,
      });
      notifyStatusChange(task);
      // Record in stall history so the frontend task detail shows it too.
      if (!task.stallResponses) task.stallResponses = [];
      task.stallResponses.push({
        timestamp: new Date().toISOString(),
        situation: analysis.situation,
        question: analysis.question || null,
        action: 'ask_user',
        response: null,
        confidence: analysis.confidence,
      });
      return;
    case 'skip':
    default:
      return;
  }

  console.log(`[Task ${task.id}] Stall auto-response: "${analysis.situation}" -> ${analysis.action}${analysis.response ? ': ' + analysis.response : ''}`);

  // Record stall response history
  if (!task.stallResponses) task.stallResponses = [];
  task.stallResponses.push({
    timestamp: new Date().toISOString(),
    situation: analysis.situation,
    action: analysis.action,
    response: analysis.response || null,
    confidence: analysis.confidence,
  });

  // Notify frontend
  broadcast(task, {
    type: 'stall_response',
    situation: analysis.situation,
    action: analysis.action,
    response: analysis.response || null,
  });
}

// ─── Auto-memory: summarize finished tasks and persist ──────────
const MEMORY_SYSTEM_PROMPT = `You are a technical writer producing a concise memory note about an AI coding session that just finished.

Output valid markdown only — no prose before or after, no code fences, no <think> tags.

Fill in this exact template:

# <6-10 word title describing what was done>
**Goal:** <one sentence restating what the user asked for>
**Outcome:** <one sentence on what actually happened; mention success or failure>
**Key steps:**
- <bullet>
- <bullet>
- <bullet>
**Files:** <comma-separated list of files touched if visible in the output, else "n/a">

Rules:
- Base everything on the PROMPT and OUTPUT below. Do not invent details.
- Keep the whole note under ~200 words.
- If the task clearly failed, say so in Outcome and explain the cause in one bullet.`;

function stripAnsiStandalone(str) {
  return (str || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

function sanitizeNamespace(raw) {
  if (!raw) return 'default';
  const cleaned = String(raw).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
  return cleaned || 'default';
}

async function summarizeTaskViaOllama(task) {
  if (!process.env.OLLAMA_AUTH_TOKEN && !/localhost|127\.0\.0\.1/.test(OLLAMA_URL)) {
    // No credentials and not local — bail out, caller will fall back to raw
    return null;
  }

  const target = new URL(OLLAMA_URL);
  const apiPath = (target.pathname.replace(/\/$/, '') + '/api/chat') || '/api/chat';
  const endpoint = `${target.protocol}//${target.host}${apiPath}`;

  const cleanOutput = stripAnsiStandalone(task.output).slice(-MEMORY_OUTPUT_CHARS);
  const duration = task.finishedAt && task.startedAt
    ? Math.round((new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime()) / 1000)
    : null;

  const userContent = `PROMPT:
${task.prompt.slice(0, 2000)}

FINAL OUTPUT (tail):
${cleanOutput}

METADATA:
- exit code: ${task.exitCode}
- status: ${task.status}
- model: ${task.model || 'default'}
- provider: ${task.provider || 'unknown'}
- duration: ${duration != null ? duration + 's' : 'n/a'}`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.OLLAMA_AUTH_TOKEN ? { 'Authorization': `Bearer ${process.env.OLLAMA_AUTH_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        model: MEMORY_SUMMARY_MODEL,
        stream: false,
        messages: [
          { role: 'system', content: MEMORY_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      }),
    });
    if (!res.ok) {
      console.error(`[Memory ${task.id}] Ollama summary ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const raw = data.message?.content || '';
    return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || null;
  } catch (err) {
    console.error(`[Memory ${task.id}] Ollama summary failed:`, err.message);
    return null;
  }
}

function buildRawSummary(task) {
  const cleanOutput = stripAnsiStandalone(task.output).slice(-MEMORY_OUTPUT_CHARS);
  const duration = task.finishedAt && task.startedAt
    ? Math.round((new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime()) / 1000)
    : null;
  const title = task.prompt.split('\n')[0].slice(0, 80) || 'Task';
  return `# ${title}
**Goal:** ${task.prompt.slice(0, 300)}
**Outcome:** status=${task.status}, exit=${task.exitCode}${duration != null ? `, duration=${duration}s` : ''}
**Key steps:**
- (no LLM summary available — raw output tail below)
**Files:** n/a

## Raw output tail
\`\`\`
${cleanOutput}
\`\`\`
`;
}

async function saveTaskMemory(task) {
  if (!MEMORY_AUTO_SAVE) return;
  // Save completed and failed runs (both are useful history); only skip if
  // there's literally no output at all.
  if (!task.output || stripAnsiStandalone(task.output).trim().length < 20) return;

  const namespace = sanitizeNamespace(task.boardId);
  const summaryBody = (await summarizeTaskViaOllama(task)) || buildRawSummary(task);

  // Prepend a machine-readable header so searches can re-discover the context
  const header = `<!-- taskId: ${task.id} boardId: ${task.boardId || ''} namespace: ${namespace} model: ${task.model || ''} status: ${task.status} exit: ${task.exitCode} savedAt: ${new Date().toISOString()} -->\n`;
  const content = header + summaryBody;

  // 1. Filesystem mirror
  try {
    const dir = path.join(MEMORY_DIR, namespace);
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${task.createdAt.replace(/[:.]/g, '-')}_${task.id}.md`;
    fs.writeFileSync(path.join(dir, filename), content, 'utf8');
    console.log(`[Memory ${task.id}] Wrote ${path.join(namespace, filename)}`);
  } catch (err) {
    console.error(`[Memory ${task.id}] FS write failed:`, err.message);
  }

  // 2. RAG store — POST to ai-assistant via the configured ASSISTANT_URL
  try {
    const target = new URL(ASSISTANT_URL);
    const apiPath = (target.pathname.replace(/\/$/, '') + '/api/documents/split') || '/api/documents/split';
    const endpoint = `${target.protocol}//${target.host}${apiPath}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `task-${task.id}`,
        content,
        mode: 'chunk',
        chunkSize: 400,
        metadata: {
          namespace,
          boardId: task.boardId || '',
          taskId: task.id,
          source: 'runner',
          kind: 'task-summary',
          model: task.model || '',
          provider: task.provider || '',
          status: task.status,
          exitCode: String(task.exitCode),
          savedAt: new Date().toISOString(),
        },
      }),
    });
    if (!res.ok) {
      console.error(`[Memory ${task.id}] RAG store ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return;
    }
    const data = await res.json().catch(() => ({}));
    console.log(`[Memory ${task.id}] Indexed into RAG namespace="${namespace}" chunks=${data.totalChunks ?? '?'}`);
  } catch (err) {
    console.error(`[Memory ${task.id}] RAG store failed:`, err.message);
  }
}

// ─── Run Claude Code INTERACTIVELY via PTY ─────────────────────
// Spawns a real pseudo-terminal, starts claude in interactive mode,
// types the prompt, detects completion via ❯ idle prompt, then sends /exit.
function runTask(task) {
  task.status = 'running';
  task.startedAt = new Date().toISOString();
  notifyStatusChange(task, { startedAt: task.startedAt });

  const shell = os.platform() === 'win32'
    ? 'powershell.exe'
    : (process.env.SHELL || (fs.existsSync('/bin/zsh') ? '/bin/zsh' : '/bin/bash'));

  let ptyProcess;
  try {
    ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: task.workingDir,
      env: { ...process.env, FORCE_COLOR: '1' },
    });
  } catch (err) {
    console.error('Failed to spawn PTY:', err.message);
    task.status = 'failed';
    task.finishedAt = new Date().toISOString();
    task.output = `Error: Failed to spawn terminal: ${err.message}\n`;
    broadcast(task, { type: 'output', data: task.output });
    notifyStatusChange(task, { finishedAt: task.finishedAt });
    return;
  }

  task.ptyProcess = ptyProcess;

  // Track state for auto-handling prompts
  // NOTE: `promptScheduled` flips the moment we decide to send the task prompt;
  // `promptSent` only flips after the Enter has actually been written. The
  // completion detector keys off `promptSent` so it can never mis-fire on the
  // idle ❯ that's visible during Claude's first-run transition.
  let promptScheduled = false;
  let promptSent = false;
  let trustHandled = false;
  let themeHandled = false;
  let loginHandled = false;
  let claudeReady = false;
  let outputBuffer = '';
  let pollStarted = false;
  let pollAttempts = 0;
  const POLL_INTERVAL_MS = 500;
  const POLL_MAX_ATTEMPTS = 24; // ~12 seconds of polling before forcing send

  // Main UI signature — any of these strongly indicates we're past the
  // trust/theme/login gates and looking at the real Claude Code ready screen.
  // Verified empirically against claude-code v2.1.104 in a fresh folder.
  const MAIN_UI_SIGNATURE = /Tips\s*for\s*getting\s*started|bypass\s*permissions\s*on|Welcome\s*back|How\s*can\s*I\s*help|What\s*can\s*I\s*help|Type\s*your\s*message|╭─+\s*Claude\s*Code/i;

  // Unified helper: decide we're sending the task prompt, then (after
  // optional pre-delay for Claude to finish painting) actually type it + \r.
  // Idempotent — the first caller wins, later calls are no-ops.
  function schedulePromptWrite(source, preDelayMs = 0) {
    if (promptScheduled || exitSent) return;
    promptScheduled = true;
    outputBuffer = '';
    console.log(`[Task ${task.id}] ${source}: scheduling prompt write (preDelay=${preDelayMs}ms)`);
    setTimeout(() => {
      if (exitSent) return;
      try {
        ptyProcess.write(task.prompt);
      } catch { return; }
      setTimeout(() => {
        if (exitSent) return;
        try { ptyProcess.write('\r'); } catch { return; }
        promptSent = true;
        postPromptBuffer = '';
        console.log(`[Task ${task.id}] ${source}: auto-typed task prompt`);
      }, 300);
    }, preDelayMs);
  }

  // Active poll — scans outputBuffer every POLL_INTERVAL_MS for main UI
  // signature. This is the reliable path because it doesn't depend on new
  // onData arriving: Claude often paints the ready banner and then goes idle,
  // so a reactive regex would miss it entirely.
  function pollMainUi() {
    if (promptScheduled || exitSent) return;
    const clean = stripAnsi(outputBuffer);
    if (MAIN_UI_SIGNATURE.test(clean)) {
      console.log(`[Task ${task.id}] Main UI detected after ${pollAttempts} poll(s) — sending prompt`);
      schedulePromptWrite('Main UI poll', 400);
      return;
    }
    pollAttempts++;
    if (pollAttempts >= POLL_MAX_ATTEMPTS) {
      console.log(`[Task ${task.id}] Main UI not detected after ${pollAttempts} polls — firing fallback`);
      schedulePromptWrite('Main UI poll timeout', 0);
      return;
    }
    setTimeout(pollMainUi, POLL_INTERVAL_MS);
  }

  function startPollMainUi() {
    if (pollStarted) return;
    pollStarted = true;
    pollAttempts = 0;
    setTimeout(pollMainUi, POLL_INTERVAL_MS);
  }

  // Completion detection state
  let postPromptBuffer = '';
  let claudeWorking = false;
  let exitSent = false;
  let completionTimer = null;

  // Stall detection state
  let stallTimer = null;
  let stallRetryCount = 0;
  let lastOutputTime = Date.now();

  async function handleStall() {
    if (exitSent || !claudeWorking || stallRetryCount >= STALL_MAX_RETRIES) return;

    // Guard: if output arrived while the API call was pending, abort
    if (Date.now() - lastOutputTime < STALL_TIMEOUT_MS * 0.8) return;

    stallRetryCount++;
    console.log(`[Task ${task.id}] Stall detected (attempt ${stallRetryCount}/${STALL_MAX_RETRIES}) — analyzing...`);

    // Extract last portion of clean output
    const recentRaw = task.output.slice(-(STALL_CONTEXT_CHARS * 2));
    const recentClean = stripAnsi(recentRaw).slice(-STALL_CONTEXT_CHARS);

    const analysis = await analyzeStall(task.id, recentClean);

    // Re-check: output may have arrived during the API call
    if (exitSent) return;

    if (!analysis || analysis.action === 'skip') {
      console.log(`[Task ${task.id}] Stall analysis: no action taken`);
      // Re-arm with longer timeout
      if (stallRetryCount < STALL_MAX_RETRIES && !exitSent) {
        stallTimer = setTimeout(() => handleStall(), STALL_TIMEOUT_MS * 1.5);
      }
      return;
    }

    executeStallResponse(ptyProcess, task, analysis);
  }

  function armStallTimer() {
    if (!STALL_DETECTION_ENABLED || exitSent || stallRetryCount >= STALL_MAX_RETRIES) return;
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => handleStall(), STALL_TIMEOUT_MS);
  }

  function stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  }

  function triggerExit() {
    if (exitSent) return;
    // Tasks awaiting user input must never auto-exit — the user is mid-
    // conversation with Claude. The frontend will route their reply back
    // through the PTY and completion detection will re-arm later.
    if (task.status === 'awaiting_user') {
      console.log(`[Task ${task.id}] Skipping exit — task is awaiting user input`);
      return;
    }
    // Loop-mode tasks never exit automatically — they stay in the 'loop'
    // state after going idle so the user can keep sending follow-ups over
    // the WebSocket. Only an explicit stop or the PTY dying terminates them.
    if (task.mode === 'loop') {
      if (task.status !== 'loop') {
        task.status = 'loop';
        console.log(`[Task ${task.id}] Idle detected in loop mode — keeping PTY alive, status=loop`);
        notifyStatusChange(task);
      }
      return;
    }
    exitSent = true;
    if (task.provider === 'gemini') {
      // Gemini CLI: `/quit` is the only clean way out — do NOT follow up with a
      // shell `exit`, because if gemini hasn't finished shutting down yet the
      // `exit` is typed into gemini's prompt instead of the shell. Give gemini
      // a moment to quit on its own, then kill the PTY if it's still alive.
      console.log(`[Task ${task.id}] Task complete — sending /quit`);
      ptyProcess.write('/quit\r');
      setTimeout(() => {
        try { ptyProcess.kill(); } catch { /* already exited */ }
      }, 3000);
    } else {
      console.log(`[Task ${task.id}] Task complete — sending /exit`);
      ptyProcess.write('/exit\r');
      setTimeout(() => { ptyProcess.write('exit\r'); }, 2000);
    }
  }

  // Gemini CLI has no ❯ idle marker — fall back to silence-based completion.
  let geminiIdleTimer = null;
  function armGeminiIdleTimer() {
    if (task.provider !== 'gemini' || exitSent || !claudeWorking) return;
    if (geminiIdleTimer) clearTimeout(geminiIdleTimer);
    geminiIdleTimer = setTimeout(() => triggerExit(), GEMINI_IDLE_COMPLETION_MS);
  }

  // Stream ALL output to browser via WebSocket
  ptyProcess.onData((data) => {
    task.output += data;
    outputBuffer += data;
    broadcast(task, { type: 'output', data });

    // Reset idle/stall timers on any new output
    lastOutputTime = Date.now();
    if (claudeWorking && promptSent && !exitSent) {
      armStallTimer();
      armGeminiIdleTimer();
    }

    const cleanBuffer = stripAnsi(outputBuffer);

    // Auto-handle first-run "Choose the text style" (theme picker) — accept default (dark mode).
    // Match on multiple possible anchors since the first-paint can split across PTY chunks.
    const cleanNoSpace = cleanBuffer.replace(/\s+/g, '');
    if (
      !themeHandled &&
      (/Choose the text style|Dark mode|Light mode|color.?blind/i.test(cleanBuffer) ||
        /Choosethetextstyle|Darkmode|Lightmode/i.test(cleanNoSpace))
    ) {
      themeHandled = true;
      outputBuffer = '';
      setTimeout(() => {
        try { ptyProcess.write('\r'); } catch {}
        console.log(`[Task ${task.id}] Auto-accepted theme picker (default)`);
      }, 800);
      startPollMainUi();
      return;
    }

    // Auto-handle first-run login screen — pick "Use Claude Code with your API key" / default
    if (!loginHandled && /Log in with|API key|Anthropic Console|Select login method/i.test(cleanBuffer)) {
      loginHandled = true;
      outputBuffer = '';
      setTimeout(() => {
        try { ptyProcess.write('\r'); } catch {}
        console.log(`[Task ${task.id}] Auto-accepted login screen (default)`);
      }, 800);
      startPollMainUi();
      return;
    }

    // Auto-handle "Trust this folder" prompt — Claude Code v2.1+ paints the
    // dialog with a `❯ 1. Yes, I trust this folder` SelectInput. Enter
    // selects the highlighted Yes, which is correct.
    if (!trustHandled && /trust this folder|trust the files|Do you trust|Yes,\s*I\s*trust/i.test(cleanBuffer)) {
      trustHandled = true;
      outputBuffer = '';
      setTimeout(() => {
        try { ptyProcess.write('\r'); } catch {}
        console.log(`[Task ${task.id}] Auto-accepted "Trust folder" prompt`);
      }, 800);
      startPollMainUi();
      return;
    }

    // Wait for claudeReady before starting the main UI poll (if no first-run
    // handler fired to start it already).
    if (!claudeReady) return;
    startPollMainUi();

    // ── Completion detection ─────────────────────────────────────
    // After prompt is sent, watch for Claude to finish and return to idle ❯ prompt
    if (promptSent && !exitSent) {
      postPromptBuffer += data;
      const cleanPost = stripAnsi(postPromptBuffer);

      if (!claudeWorking) {
        // Claude starts working when substantial output accumulates (>300 chars)
        if (cleanPost.length > 300) {
          claudeWorking = true;
          postPromptBuffer = '';
          console.log(`[Task ${task.id}] Claude is working...`);
          armStallTimer();
        }
      } else {
        // Claude was working — look for the ❯ idle prompt returning
        if (/❯/.test(cleanPost)) {
          // Debounce: if no new output for 4 seconds after seeing ❯, run the
          // pre-exit idle check instead of exiting immediately.
          if (completionTimer) clearTimeout(completionTimer);
          completionTimer = setTimeout(() => maybeExitAfterIdle(), 4000);
        } else {
          // Still receiving output — reset to avoid premature trigger
          if (completionTimer) { clearTimeout(completionTimer); completionTimer = null; }
          postPromptBuffer = '';
        }
      }
    }
  });

  // Pre-exit idle check: called when the completion detector thinks the task
  // is done. Before actually firing `/exit` we ask the stall analyzer whether
  // Claude might be waiting on the user. If yes → ask_user (notify frontend,
  // keep session alive). If it's an actionable prompt → auto-answer. Only if
  // the analyzer explicitly says it's done (or is unavailable) do we exit.
  let idleCheckInFlight = false;
  async function maybeExitAfterIdle() {
    if (exitSent || idleCheckInFlight || task.status === 'awaiting_user') return;

    // If no analyzer configured, keep the legacy fast-exit behaviour.
    if (STALL_ANALYSIS_PROVIDER === 'none') {
      triggerExit();
      return;
    }

    idleCheckInFlight = true;
    try {
      console.log(`[Task ${task.id}] Idle detected — running pre-exit check`);
      const recentRaw = task.output.slice(-(STALL_CONTEXT_CHARS * 2));
      const recentClean = stripAnsi(recentRaw).slice(-STALL_CONTEXT_CHARS);
      const analysis = await analyzeStall(task.id, recentClean);

      // Bail out if the task was torn down during the API call
      if (exitSent || task.status === 'awaiting_user') return;

      if (!analysis || analysis.action === 'skip') {
        console.log(`[Task ${task.id}] Pre-exit: no pending question — exiting`);
        triggerExit();
        return;
      }

      // Actionable: auto-answer or escalate to user
      executeStallResponse(ptyProcess, task, analysis);

      // If we escalated, stop the completion loop entirely — the user will
      // either respond via xterm or stop the task. If we auto-answered, give
      // Claude another debounce window before re-checking.
      if (task.status === 'awaiting_user') return;
      if (completionTimer) clearTimeout(completionTimer);
      completionTimer = setTimeout(() => maybeExitAfterIdle(), STALL_TIMEOUT_MS);
    } finally {
      idleCheckInFlight = false;
    }
  }

  ptyProcess.onExit(({ exitCode }) => {
    if (completionTimer) clearTimeout(completionTimer);
    if (stallTimer) clearTimeout(stallTimer);
    if (geminiIdleTimer) clearTimeout(geminiIdleTimer);
    task.exitCode = exitCode;
    task.status = exitCode === 0 ? 'completed' : 'failed';
    task.finishedAt = new Date().toISOString();
    task.ptyProcess = null;
    console.log(`[Task ${task.id}] PTY exited with code ${exitCode} — status: ${task.status}`);
    notifyStatusChange(task, { exitCode, finishedAt: task.finishedAt });

    // Fire-and-forget: summarize + persist to memory (per-board namespace)
    saveTaskMemory(task).catch((err) => {
      console.error(`[Memory ${task.id}] save pipeline crashed:`, err.message);
    });
  });

  // Step 1: Wait for shell to be ready, then type the CLI command
  setTimeout(() => {
    // Whitelist model id (alphanumeric + dash + dot + underscore + colon) to block shell injection.
    const safeModel = task.model && /^[A-Za-z0-9._:-]+$/.test(task.model) ? task.model : null;
    task.provider = providerFor(safeModel);

    let claudeCmd;
    if (task.provider === 'gemini') {
      claudeCmd = `gemini -y -m ${safeModel}\r`;
    } else if (!safeModel) {
      claudeCmd = `claude --dangerously-skip-permissions\r`;
    } else if (task.provider === 'claude') {
      claudeCmd = `claude --dangerously-skip-permissions --model ${safeModel}\r`;
    } else {
      // Ollama-hosted model — wrap claude through ollama's launcher.
      claudeCmd = `ollama launch claude --model ${safeModel} -- --dangerously-skip-permissions\r`;
    }
    ptyProcess.write(claudeCmd);
    console.log(`[Task ${task.id}] Sent ${task.provider} command${safeModel ? ` (model=${safeModel})` : ''}`);

    // Mark claudeReady after a delay. DO NOT wipe outputBuffer here — if
    // Claude already painted the main UI (e.g. folder is already trusted),
    // the "Tips for getting started" text is already in the buffer and the
    // poll below relies on it to fire immediately. Wiping would strand the
    // task until the 15s fallback.
    setTimeout(() => {
      claudeReady = true;
      console.log(`[Task ${task.id}] Claude marked ready — starting main UI poll`);
      startPollMainUi();
    }, 3000);

    // Last-resort fallback: if no other path has sent the prompt by now,
    // force it. Reachable only on very slow machines where even the post-
    // first-run proactive timers couldn't finish.
    setTimeout(() => {
      schedulePromptWrite('15s fallback', 0);
    }, 15000);

  }, 1000);
}

// ─── Models API ───────────────────────────────────────────────
app.get('/api/models', (req, res) => {
  res.json(availableModels);
});

app.post('/api/models', (req, res) => {
  const { id, name, group } = req.body;
  if (!id || !id.trim()) {
    return res.status(400).json({ error: 'id is required' });
  }
  const modelId = id.trim();
  if (availableModels.find((m) => m.id === modelId)) {
    return res.status(409).json({ error: 'Model already exists' });
  }
  const model = { id: modelId, name: (name || modelId).trim(), group: group || null };
  availableModels.push(model);
  res.status(201).json(model);
});

app.delete('/api/models/:id', (req, res) => {
  const idx = availableModels.findIndex((m) => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Model not found' });
  availableModels.splice(idx, 1);
  res.json({ success: true });
});

// ─── Filesystem browser API ─────────────────────────────────────
// These endpoints let the Settings dialog in the web UI browse real
// directories on this host and create new ones (mkdir -p). The runner
// already has full FS access on this machine — the APIs below just expose
// a read-limited picker view to the browser.

function resolveSafePath(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('path is required');
  }
  const expanded = input.startsWith('~/') || input === '~'
    ? path.join(os.homedir(), input.slice(1).replace(/^\//, ''))
    : input;
  return path.resolve(expanded);
}

app.get('/api/fs/list', (req, res) => {
  try {
    const requested = typeof req.query.path === 'string' && req.query.path
      ? req.query.path
      : os.homedir();
    const showHidden = req.query.hidden === '1' || req.query.hidden === 'true';
    const target = resolveSafePath(requested);

    if (!fs.existsSync(target)) {
      return res.status(404).json({ error: 'Path does not exist', path: target });
    }
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Not a directory', path: target });
    }

    const entries = [];
    let items;
    try {
      items = fs.readdirSync(target, { withFileTypes: true });
    } catch (err) {
      return res.status(403).json({ error: `Cannot list: ${err.message}`, path: target });
    }
    for (const item of items) {
      if (!showHidden && item.name.startsWith('.')) continue;
      try {
        const sub = path.join(target, item.name);
        const s = fs.statSync(sub);
        if (s.isDirectory()) {
          entries.push({ name: item.name, isDir: true });
        }
      } catch { /* ignore per-entry permission errors */ }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    const parent = path.dirname(target);
    res.json({
      path: target,
      parent: parent !== target ? parent : null,
      home: os.homedir(),
      entries,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/fs/exists', (req, res) => {
  try {
    const target = resolveSafePath(req.query.path);
    const exists = fs.existsSync(target);
    const isDir = exists && fs.statSync(target).isDirectory();
    res.json({ path: target, exists, isDir });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/fs/mkdir', (req, res) => {
  try {
    const target = resolveSafePath(req.body && req.body.path);
    // Only allow mkdir under the user's home directory. Anywhere else is an
    // easy way for a rogue script to spam folders across the filesystem.
    const home = os.homedir();
    const homeWithSep = home.endsWith(path.sep) ? home : home + path.sep;
    if (target !== home && !target.startsWith(homeWithSep)) {
      return res.status(403).json({
        error: `For safety, new folders can only be created under your home directory (${home})`,
        path: target,
        home,
      });
    }
    fs.mkdirSync(target, { recursive: true });
    res.json({ path: target, created: true, exists: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Write arbitrary text content to a file (auto-creates parent dirs). Guarded
// to home-dir paths and to a 2MB content cap so the browser can't accidentally
// DoS the disk.
app.post('/api/fs/write', (req, res) => {
  try {
    const body = req.body || {};
    const target = resolveSafePath(body.path);
    const content = typeof body.content === 'string' ? body.content : '';
    const overwrite = body.overwrite !== false; // default true

    const home = os.homedir();
    const homeWithSep = home.endsWith(path.sep) ? home : home + path.sep;
    if (target !== home && !target.startsWith(homeWithSep)) {
      return res.status(403).json({
        error: `For safety, files can only be written under your home directory (${home})`,
        path: target,
        home,
      });
    }
    if (content.length > 2 * 1024 * 1024) {
      return res.status(413).json({ error: 'Content exceeds 2MB limit' });
    }
    if (!overwrite && fs.existsSync(target)) {
      return res.status(409).json({ error: 'File already exists', path: target });
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
    res.json({ path: target, bytes: Buffer.byteLength(content, 'utf8'), written: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Skill library ──────────────────────────────────────────────
// Bundled markdown files that users can preview and copy into their
// project's .claude/skills/ directory with one click. Files live in
// claude-code-runner/skills-library/*.md; the front-matter up top is
// parsed for title/description/tags.
const SKILLS_LIBRARY_DIR = path.join(__dirname, 'skills-library');

function parseSkillFrontmatter(raw) {
  // Accept an optional YAML-ish front-matter block: --- ... ---
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const meta = { title: '', description: '', tags: [] };
  let body = raw;
  if (match) {
    body = raw.slice(match[0].length);
    const block = match[1];
    for (const line of block.split('\n')) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (!kv) continue;
      const [, key, value] = kv;
      if (key === 'title') meta.title = value.trim();
      else if (key === 'description') meta.description = value.trim();
      else if (key === 'tags') {
        meta.tags = value
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((t) => t.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
      }
    }
  }
  return { meta, body };
}

function loadSkillLibrary() {
  if (!fs.existsSync(SKILLS_LIBRARY_DIR)) return [];
  const out = [];
  let files = [];
  try { files = fs.readdirSync(SKILLS_LIBRARY_DIR); } catch { return []; }
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const fullPath = path.join(SKILLS_LIBRARY_DIR, file);
    try {
      const raw = fs.readFileSync(fullPath, 'utf8');
      const { meta } = parseSkillFrontmatter(raw);
      out.push({
        name: file.replace(/\.md$/, ''),
        file,
        title: meta.title || file.replace(/\.md$/, ''),
        description: meta.description || '',
        tags: meta.tags,
        bytes: Buffer.byteLength(raw, 'utf8'),
      });
    } catch { /* skip malformed */ }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

app.get('/api/skills/library', (_req, res) => {
  res.json({ skills: loadSkillLibrary() });
});

app.get('/api/skills/library/:name', (req, res) => {
  const name = String(req.params.name || '').replace(/[^A-Za-z0-9._-]/g, '');
  if (!name) return res.status(400).json({ error: 'name required' });
  const fullPath = path.join(SKILLS_LIBRARY_DIR, name + '.md');
  if (!fullPath.startsWith(SKILLS_LIBRARY_DIR)) {
    return res.status(400).json({ error: 'invalid name' });
  }
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Skill not found' });
  }
  try {
    const raw = fs.readFileSync(fullPath, 'utf8');
    const { meta, body } = parseSkillFrontmatter(raw);
    res.json({ name, raw, body, meta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── REST API ──────────────────────────────────────────────────
app.post('/api/tasks', (req, res) => {
  try {
    const { prompt, workingDir, callbackUrl, model, boardId, mode } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const task = new Task({
      prompt: prompt.trim(),
      workingDir,
      callbackUrl,
      model: model || null,
      boardId: typeof boardId === 'string' && boardId.trim() ? boardId.trim() : null,
      mode: mode === 'loop' ? 'loop' : 'one-time',
    });
    tasks.set(task.id, task);
    runTask(task);
    res.status(201).json(task.toJSON());
  } catch (err) {
    console.error('Error creating task:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tasks', (req, res) => {
  const list = Array.from(tasks.values())
    .map((t) => t.toSummary())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(list);
});

app.get('/api/tasks/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task.toJSON());
});

app.get('/api/tasks/:id/status', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task.toStatus());
});

app.post('/api/tasks/:id/stop', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status !== 'running') {
    return res.status(400).json({ error: 'Task is not running' });
  }

  if (task.ptyProcess) {
    task.ptyProcess.kill();
  }

  task.status = 'stopped';
  task.finishedAt = new Date().toISOString();
  task.ptyProcess = null;
  notifyStatusChange(task, { finishedAt: task.finishedAt });
  res.json(task.toJSON());
});

app.delete('/api/tasks/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  if (task.ptyProcess) {
    task.ptyProcess.kill();
  }

  tasks.delete(task.id);
  res.json({ success: true });
});

// ─── WebSocket ─────────────────────────────────────────────────
wss.on('connection', (ws) => {
  let subscribedTask = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === 'subscribe' && msg.taskId) {
        if (subscribedTask) subscribedTask.subscribers.delete(ws);
        const task = tasks.get(msg.taskId);
        if (task) {
          subscribedTask = task;
          task.subscribers.add(ws);
          ws.send(JSON.stringify({ type: 'status', status: task.status }));
          if (task.output) {
            ws.send(JSON.stringify({ type: 'output', data: task.output }));
          }
        }
      }

      if (msg.type === 'unsubscribe') {
        if (subscribedTask) { subscribedTask.subscribers.delete(ws); subscribedTask = null; }
      }

      // Allow sending keyboard input to the terminal from the browser
      if (msg.type === 'input' && subscribedTask && subscribedTask.ptyProcess) {
        // If the task was waiting for the user, flip it back to running the
        // moment a keystroke arrives — the user is answering Claude's question.
        if (subscribedTask.status === 'awaiting_user') {
          subscribedTask.status = 'running';
          subscribedTask.awaitingSituation = null;
          subscribedTask.awaitingQuestion = null;
          console.log(`[Task ${subscribedTask.id}] User resumed from awaiting_user`);
          notifyStatusChange(subscribedTask);
        }
        subscribedTask.ptyProcess.write(msg.data);
      }

      // Resize PTY to match browser terminal size
      if (msg.type === 'resize' && subscribedTask && subscribedTask.ptyProcess) {
        const cols = Math.max(10, Math.min(500, msg.cols || 80));
        const rows = Math.max(2, Math.min(200, msg.rows || 24));
        try {
          subscribedTask.ptyProcess.resize(cols, rows);
        } catch (e) {}
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    if (subscribedTask) subscribedTask.subscribers.delete(ws);
  });
});

// ─── SPA fallback (trello-clone) ───────────────────────────────
// Any non-API GET that hasn't matched so far returns the trello index.html
// so React Router client-side routes resolve correctly.
app.get(/^(?!\/api\/|\/runner|\/ollama-api|\/assistant).*/, (req, res, next) => {
  if (req.method !== 'GET') return next();
  const indexFile = path.join(TRELLO_DIST, 'index.html');
  if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
  return next();
});

// ─── Start Server ──────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   🚀 Claude Code Runner — Interactive Terminal Mode      ║');
  console.log(`║   📡 http://localhost:${PORT}                               ║`);
  console.log('║   🌐 Remote: http://<your-ip>:' + PORT + '                          ║');
  console.log(`║   🔑 API Key: ${API_KEY ? 'enabled' : 'disabled (public access)'}                            ║`);
  console.log('║                                                           ║');
  console.log('║   API Endpoints:                                          ║');
  console.log('║   GET    /api/models          — List available models     ║');
  console.log('║   POST   /api/models          — Add a model              ║');
  console.log('║   DELETE /api/models/:id      — Remove a model           ║');
  console.log('║   POST   /api/tasks           — Create a task            ║');
  console.log('║   GET    /api/tasks           — List all tasks           ║');
  console.log('║   GET    /api/tasks/:id       — Get task details         ║');
  console.log('║   GET    /api/tasks/:id/status — Get task status         ║');
  console.log('║   POST   /api/tasks/:id/stop  — Stop a task             ║');
  console.log('║   DELETE /api/tasks/:id       — Delete a task            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log(`[Stall] detection=${STALL_DETECTION_ENABLED ? 'on' : 'off'} provider=${STALL_ANALYSIS_PROVIDER} model=${STALL_ANALYSIS_MODEL} timeout=${STALL_TIMEOUT_MS}ms`);
  console.log(`[Memory] auto-save=${MEMORY_AUTO_SAVE ? 'on' : 'off'} model=${MEMORY_SUMMARY_MODEL} dir=${MEMORY_DIR}`);
  console.log('');
});
