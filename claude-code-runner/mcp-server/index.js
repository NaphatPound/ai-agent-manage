import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ─── Config ────────────────────────────────────────────────
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3456";
// RAG base — points at the assistant via the merged gateway by default.
// Override with ASSISTANT_URL to hit it directly.
const RAG_BASE =
  process.env.ASSISTANT_URL || `${BACKEND_URL}/assistant`;

// ─── Helper: call the Claude Code Runner REST API ──────────
async function api(path, options = {}) {
  const url = `${BACKEND_URL}/api${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }

  return res.json();
}

// ─── Helper: poll until task finishes ──────────────────────
async function waitForTask(taskId, timeoutMs = 300000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = await api(`/tasks/${taskId}`);
    if (task.status === "completed" || task.status === "failed" || task.status === "stopped") {
      return task;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return await api(`/tasks/${taskId}`);
}

// ─── Helper: strip ANSI escape codes for clean text output ─
function stripAnsi(str) {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]/g,
    ""
  );
}

// ─── Create MCP Server ─────────────────────────────────────
const server = new McpServer({
  name: "claude-code-runner",
  version: "1.0.0",
});

// ─── Tool: run_claude_code ─────────────────────────────────
// Submit a prompt, wait for completion, return the output
server.tool(
  "run_claude_code",
  "Run a task using Claude Code CLI. Submits a prompt to the Claude Code Runner backend, waits for it to finish, and returns the terminal output.",
  {
    prompt: z.string().describe("The task prompt to send to Claude Code"),
    working_dir: z
      .string()
      .optional()
      .describe("Working directory for Claude Code to operate in (absolute path)"),
    wait: z
      .boolean()
      .optional()
      .default(true)
      .describe("Wait for the task to complete before returning (default: true)"),
    timeout_seconds: z
      .number()
      .optional()
      .default(300)
      .describe("Max seconds to wait for completion (default: 300)"),
  },
  async ({ prompt, working_dir, wait, timeout_seconds }) => {
    const task = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({ prompt, workingDir: working_dir }),
    });

    if (!wait) {
      return {
        content: [
          {
            type: "text",
            text: `Task created.\n\nTask ID: ${task.id}\nStatus: ${task.status}\nPrompt: ${task.prompt}\n\nUse get_task_status with this ID to check progress.`,
          },
        ],
      };
    }

    const result = await waitForTask(task.id, timeout_seconds * 1000);
    const cleanOutput = stripAnsi(result.output || "");

    return {
      content: [
        {
          type: "text",
          text: `Task ${result.status}.\n\nTask ID: ${result.id}\nStatus: ${result.status}\nExit Code: ${result.exitCode}\nStarted: ${result.startedAt}\nFinished: ${result.finishedAt}\n\n--- Output ---\n${cleanOutput}`,
        },
      ],
    };
  }
);

// ─── Tool: get_task_status ─────────────────────────────────
// Check the status and output of an existing task
server.tool(
  "get_task_status",
  "Get the current status and output of a Claude Code task by ID.",
  {
    task_id: z.string().describe("The task ID to check"),
  },
  async ({ task_id }) => {
    const task = await api(`/tasks/${task_id}`);
    const cleanOutput = stripAnsi(task.output || "");

    return {
      content: [
        {
          type: "text",
          text: `Task ID: ${task.id}\nStatus: ${task.status}\nPrompt: ${task.prompt}\nWorking Dir: ${task.workingDir}\nExit Code: ${task.exitCode}\nCreated: ${task.createdAt}\nStarted: ${task.startedAt}\nFinished: ${task.finishedAt}\n\n--- Output ---\n${cleanOutput}`,
        },
      ],
    };
  }
);

// ─── Tool: list_tasks ──────────────────────────────────────
// List all tasks with their status
server.tool(
  "list_tasks",
  "List all Claude Code tasks with their status and prompt summary.",
  {},
  async () => {
    const tasks = await api("/tasks");

    if (tasks.length === 0) {
      return {
        content: [{ type: "text", text: "No tasks found." }],
      };
    }

    const lines = tasks.map(
      (t) =>
        `- [${t.status.toUpperCase()}] ${t.id}\n  Prompt: ${t.prompt}\n  Created: ${t.createdAt}`
    );

    return {
      content: [
        {
          type: "text",
          text: `Found ${tasks.length} task(s):\n\n${lines.join("\n\n")}`,
        },
      ],
    };
  }
);

// ─── Tool: stop_task ───────────────────────────────────────
// Stop a running task
server.tool(
  "stop_task",
  "Stop a running Claude Code task by ID. Kills the PTY process.",
  {
    task_id: z.string().describe("The task ID to stop"),
  },
  async ({ task_id }) => {
    const task = await api(`/tasks/${task_id}/stop`, { method: "POST" });

    return {
      content: [
        {
          type: "text",
          text: `Task stopped.\n\nTask ID: ${task.id}\nStatus: ${task.status}\nFinished: ${task.finishedAt}`,
        },
      ],
    };
  }
);

// ─── Tool: send_input ──────────────────────────────────────
// Send keyboard input to a running task's terminal
server.tool(
  "send_input",
  "Send keyboard input to a running Claude Code task's terminal. Useful for answering prompts or interacting with Claude Code.",
  {
    task_id: z.string().describe("The task ID to send input to"),
    input: z.string().describe("The text input to send to the terminal"),
    press_enter: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether to press Enter after the input (default: true)"),
  },
  async ({ task_id, input, press_enter }) => {
    // Verify task exists and is running
    const task = await api(`/tasks/${task_id}`);
    if (task.status !== "running") {
      return {
        content: [
          {
            type: "text",
            text: `Cannot send input — task is not running (status: ${task.status}).`,
          },
        ],
      };
    }

    // Connect via WebSocket to send input
    const ws = await connectAndSendInput(task_id, input, press_enter);

    return {
      content: [
        {
          type: "text",
          text: `Input sent to task ${task_id}: "${input}"${press_enter ? " [Enter]" : ""}`,
        },
      ],
    };
  }
);

// ─── Helper: WebSocket input sender ────────────────────────
async function connectAndSendInput(taskId, input, pressEnter) {
  const wsUrl = BACKEND_URL.replace(/^http/, "ws");
  const { default: WebSocket } = await import("ws");

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket connection timeout"));
    }, 5000);

    ws.on("open", () => {
      // Subscribe to the task
      ws.send(JSON.stringify({ type: "subscribe", taskId }));

      // Send the input
      const data = pressEnter ? input + "\r" : input;
      ws.send(JSON.stringify({ type: "input", data }));

      // Close after a brief delay to ensure delivery
      setTimeout(() => {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }, 500);
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${err.message || "connection failed"}`));
    });
  });
}

// ─── Tool: delete_task ─────────────────────────────────────
server.tool(
  "delete_task",
  "Delete a Claude Code task by ID. Kills the process if running and removes the task from memory.",
  {
    task_id: z.string().describe("The task ID to delete"),
  },
  async ({ task_id }) => {
    await api(`/tasks/${task_id}`, { method: "DELETE" });

    return {
      content: [
        {
          type: "text",
          text: `Task ${task_id} deleted.`,
        },
      ],
    };
  }
);

// ─── RAG helpers ───────────────────────────────────────────
async function ragCall(path, options = {}) {
  const res = await fetch(`${RAG_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`RAG ${res.status}: ${body}`);
  }
  return res.json();
}

// ─── Tool: save_dev_log ────────────────────────────────────
// Persist a dev-time note / memory / decision into the RAG vector store
// so it can be recalled later by semantic search.
server.tool(
  "save_dev_log",
  "Save a development log entry, decision, insight, or memory into the RAG vector store. Use this during Claude Code sessions to capture context that should outlive the current conversation — e.g. bugfix rationale, architectural decisions, API quirks, TODOs, feature specs.",
  {
    id: z
      .string()
      .optional()
      .describe("Unique id for this entry — auto-generated if omitted"),
    title: z.string().describe("Short human-readable title"),
    content: z.string().describe("The log body — markdown is fine"),
    project: z
      .string()
      .optional()
      .describe("Project name this log belongs to (e.g. 'ai-agent-board')"),
    kind: z
      .enum(["log", "decision", "memory", "doc", "todo", "bug", "feature"])
      .optional()
      .default("log")
      .describe("Category for filtering later"),
    tags: z.array(z.string()).optional().describe("Free-form tags"),
  },
  async ({ id, title, content, project, kind, tags }) => {
    const docId = id || `${kind || "log"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const body = `# ${title}\n\n${content}`;
    const metadata = {
      title,
      project: project || "unknown",
      kind: kind || "log",
      tags: tags || [],
      source: "claude-code-runner",
      savedAt: new Date().toISOString(),
    };

    const result = await ragCall("/api/documents/split", {
      method: "POST",
      body: JSON.stringify({ id: docId, content: body, mode: "chunk", chunkSize: 400, metadata }),
    });

    return {
      content: [
        {
          type: "text",
          text: `Saved dev log "${title}" (id=${docId}) — ${result.parts || 0} chunks embedded.\nTotal docs in RAG: ${result.totalDocuments}`,
        },
      ],
    };
  }
);

// ─── Tool: search_dev_logs ─────────────────────────────────
server.tool(
  "search_dev_logs",
  "Semantic search over previously-saved dev logs, decisions, memories, and docs in the RAG store. Use this BEFORE starting new work to recall prior context on the same project / feature / bug.",
  {
    query: z.string().describe("Natural-language query"),
    top_k: z.number().optional().default(5).describe("How many results to return"),
  },
  async ({ query, top_k }) => {
    const result = await ragCall("/api/documents/search", {
      method: "POST",
      body: JSON.stringify({ query, topK: top_k }),
    });

    if (!result.results || result.results.length === 0) {
      return { content: [{ type: "text", text: `No matches for "${query}".` }] };
    }

    const lines = result.results.map(
      (r, i) =>
        `[${i + 1}] (${r.matchPercent}% match) ${r.id}\n${(r.content || "").slice(0, 400)}`
    );

    return {
      content: [
        {
          type: "text",
          text: `Top ${result.results.length} matches for "${query}":\n\n${lines.join("\n\n")}`,
        },
      ],
    };
  }
);

// ─── Tool: ask_dev_memory ──────────────────────────────────
// Ask the assistant's chat endpoint a question — it runs RAG retrieval
// + LLM synthesis internally and returns a grounded answer.
server.tool(
  "ask_dev_memory",
  "Ask the AI assistant a question about past development work. It performs RAG retrieval over the dev-log store and returns a grounded answer with sources. Use for questions like 'why did we switch to X?' or 'what did we decide about Y?'",
  {
    question: z.string().describe("Natural-language question"),
    model: z.string().optional().describe("Optional model override"),
  },
  async ({ question, model }) => {
    const result = await ragCall("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: question, history: [], model }),
    });
    const answer = result.answer || result.response || JSON.stringify(result);
    return { content: [{ type: "text", text: answer }] };
  }
);

// ─── Start ─────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Claude Code Runner MCP Server started (stdio)");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
