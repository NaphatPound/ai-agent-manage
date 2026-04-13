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
  constructor({ prompt, workingDir, callbackUrl, model }) {
    this.id = uuidv4();
    this.prompt = prompt;
    this.workingDir = workingDir || process.cwd();
    this.callbackUrl = callbackUrl || null;
    this.model = model || null;
    this.status = 'queued';
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
      status: this.status,
      output: this.output,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      exitCode: this.exitCode,
      stallResponses: this.stallResponses,
    };
  }

  toStatus() {
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
  "situation": "brief description of what's happening",
  "action": "press_enter" | "press_yes" | "press_no" | "type_text" | "send_instruction" | "skip",
  "response": "the text to type (only for type_text or send_instruction actions, otherwise empty string)",
  "confidence": 0.0 to 1.0
}

Rules:
- If Claude is asking a yes/no question about proceeding, use "press_yes"
- If Claude is asking for permission or confirmation, use "press_yes"
- If Claude hit an error and is stuck, use "send_instruction" to tell it to try a different approach — suggest a solution, do NOT tell it to execute blindly
- If Claude is asking which option to choose, use "type_text" with the most reasonable default
- If Claude is waiting for user input/prompt, use "send_instruction" to tell it to continue with the current task
- If the output looks like Claude is still actively working (streaming, thinking), use "skip"
- If you cannot determine what's happening, use "skip"
- If confidence is below 0.4, use "skip"
- Never send passwords, secrets, or destructive commands
- For send_instruction: always instruct Claude to FIND and SUGGEST solutions, not execute directly`;

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
  let promptSent = false;
  let trustHandled = false;
  let themeHandled = false;
  let loginHandled = false;
  let claudeReady = false;
  let outputBuffer = '';

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
        ptyProcess.write('\r');
        console.log(`[Task ${task.id}] Auto-accepted theme picker (default)`);
      }, 800);
      return;
    }

    // Auto-handle first-run login screen — pick "Use Claude Code with your API key" / default
    if (!loginHandled && /Log in with|API key|Anthropic Console|Select login method/i.test(cleanBuffer)) {
      loginHandled = true;
      outputBuffer = '';
      setTimeout(() => {
        ptyProcess.write('\r');
        console.log(`[Task ${task.id}] Auto-accepted login screen (default)`);
      }, 800);
      return;
    }

    // Auto-handle "Trust this folder" prompt — always active
    if (!trustHandled && /trust this folder|trust the files|Do you trust/i.test(cleanBuffer)) {
      trustHandled = true;
      outputBuffer = '';
      setTimeout(() => {
        ptyProcess.write('\r');
        console.log(`[Task ${task.id}] Auto-accepted "Trust folder" prompt`);
      }, 800);
      return;
    }

    // Wait for claudeReady before detecting other prompts
    if (!claudeReady) return;

    // Auto-send the task prompt once the CLI is ready (Claude or Gemini)
    if (!promptSent && /Tips|bypass permissions|What can I help|How can I help|Type your message|YOLO mode/i.test(cleanBuffer)) {
      promptSent = true;
      outputBuffer = '';
      setTimeout(() => {
        ptyProcess.write(task.prompt);
        setTimeout(() => {
          ptyProcess.write('\r');
          console.log(`[Task ${task.id}] Auto-typed and sent task prompt`);
        }, 300);
      }, 1000);
      return;
    }

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
          // Debounce: if no new output for 4 seconds after seeing ❯, consider done
          if (completionTimer) clearTimeout(completionTimer);
          completionTimer = setTimeout(() => triggerExit(), 4000);
        } else {
          // Still receiving output — reset to avoid premature trigger
          if (completionTimer) { clearTimeout(completionTimer); completionTimer = null; }
          postPromptBuffer = '';
        }
      }
    }
  });

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

    // Start watching for Claude prompts after a delay
    setTimeout(() => {
      claudeReady = true;
      outputBuffer = '';
      console.log(`[Task ${task.id}] Now watching for Claude ready prompt...`);
    }, 3000);

    // Fallback: if prompt detection doesn't trigger, send after timeout
    setTimeout(() => {
      if (!promptSent) {
        promptSent = true;
        ptyProcess.write(task.prompt);
        setTimeout(() => {
          ptyProcess.write('\r');
          console.log(`[Task ${task.id}] Fallback: auto-typed task prompt after timeout`);
        }, 300);
      }
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

// ─── REST API ──────────────────────────────────────────────────
app.post('/api/tasks', (req, res) => {
  try {
    const { prompt, workingDir, callbackUrl, model } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const task = new Task({ prompt: prompt.trim(), workingDir, callbackUrl, model: model || null });
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
  console.log('');
});
