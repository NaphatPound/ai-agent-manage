const RUNNER_BASE = import.meta.env.DEV
  ? '/claude-runner'
  : (import.meta.env.VITE_CLAUDE_RUNNER_URL ?? '');
const RUNNER_API_KEY = import.meta.env.VITE_CLAUDE_RUNNER_API_KEY || '';

// WebSocket URL derived from runner base — same-origin in production
const RUNNER_WS_URL = import.meta.env.DEV
  ? `ws://${window.location.hostname}:3456`
  : (import.meta.env.VITE_CLAUDE_RUNNER_URL
      ? import.meta.env.VITE_CLAUDE_RUNNER_URL.replace(/^http/, 'ws')
      : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`);

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (RUNNER_API_KEY) headers['Authorization'] = `Bearer ${RUNNER_API_KEY}`;
  return headers;
}

export interface RunnerModel {
  id: string;
  name: string;
  group?: string;
}

export interface RunnerTask {
  id: string;
  prompt: string;
  workingDir: string;
  callbackUrl?: string;
  model?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped';
  output: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
}

export interface RunnerTaskStatus {
  id: string;
  status: string;
  done: boolean;
  exitCode: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunnerTaskSummary {
  id: string;
  prompt: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped';
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

// ─── REST API ────────────────────────────────────────────────

export async function listModels(): Promise<RunnerModel[]> {
  const res = await fetch(`${RUNNER_BASE}/api/models`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to list models: ${res.status}`);
  return res.json();
}

export async function createRunnerTask(
  prompt: string,
  workingDir?: string,
  callbackUrl?: string,
  model?: string,
  boardId?: string
): Promise<RunnerTask> {
  const body: Record<string, string> = { prompt };
  if (workingDir) body.workingDir = workingDir;
  if (callbackUrl) body.callbackUrl = callbackUrl;
  if (model) body.model = model;
  if (boardId) body.boardId = boardId;

  const res = await fetch(`${RUNNER_BASE}/api/tasks`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to create runner task: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function listRunnerTasks(): Promise<RunnerTaskSummary[]> {
  const res = await fetch(`${RUNNER_BASE}/api/tasks`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to list tasks: ${res.status}`);
  return res.json();
}

export async function getRunnerTaskStatus(taskId: string): Promise<RunnerTaskStatus> {
  const res = await fetch(`${RUNNER_BASE}/api/tasks/${taskId}/status`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to get task status: ${res.status}`);
  return res.json();
}

export async function getRunnerTask(taskId: string): Promise<RunnerTask> {
  const res = await fetch(`${RUNNER_BASE}/api/tasks/${taskId}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to get task: ${res.status}`);
  return res.json();
}

export async function stopRunnerTask(taskId: string): Promise<RunnerTask> {
  const res = await fetch(`${RUNNER_BASE}/api/tasks/${taskId}/stop`, {
    method: 'POST',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to stop task: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function deleteRunnerTask(taskId: string): Promise<void> {
  const res = await fetch(`${RUNNER_BASE}/api/tasks/${taskId}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to delete task: ${res.status}`);
}

// ─── WebSocket ───────────────────────────────────────────────

export type WsMessage =
  | { type: 'output'; data: string }
  | { type: 'status'; status: string; startedAt?: string; finishedAt?: string; exitCode?: number };

export interface RunnerWebSocket {
  subscribe: (taskId: string) => void;
  unsubscribe: () => void;
  sendInput: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
  onMessage: (handler: (msg: WsMessage) => void) => void;
  onClose: (handler: () => void) => void;
  isConnected: () => boolean;
}

export function connectRunnerWs(): RunnerWebSocket {
  let ws: WebSocket | null = null;
  let messageHandler: ((msg: WsMessage) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let currentTaskId: string | null = null;

  function connect() {
    ws = new WebSocket(RUNNER_WS_URL);

    ws.onopen = () => {
      if (currentTaskId) {
        ws?.send(JSON.stringify({ type: 'subscribe', taskId: currentTaskId }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        messageHandler?.(msg);
      } catch { /* ignore malformed */ }
    };

    ws.onclose = () => {
      closeHandler?.();
      // Auto-reconnect if we have a subscribed task
      if (currentTaskId) {
        reconnectTimer = setTimeout(connect, 2000);
      }
    };

    ws.onerror = () => ws?.close();
  }

  connect();

  return {
    subscribe(taskId: string) {
      currentTaskId = taskId;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'subscribe', taskId }));
      }
    },
    unsubscribe() {
      currentTaskId = null;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'unsubscribe' }));
      }
    },
    sendInput(data: string) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    },
    resize(cols: number, rows: number) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    },
    close() {
      currentTaskId = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      ws = null;
    },
    onMessage(handler: (msg: WsMessage) => void) {
      messageHandler = handler;
    },
    onClose(handler: () => void) {
      closeHandler = handler;
    },
    isConnected() {
      return ws?.readyState === WebSocket.OPEN;
    },
  };
}

// ─── Utilities ───────────────────────────────────────────────

export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '');
}

export function getRunnerBaseUrl(): string {
  return RUNNER_BASE;
}
