const API_KEY = import.meta.env.VITE_OLLAMA_API_KEY || '';
const BASE_URL = import.meta.env.VITE_OLLAMA_BASE_URL || 'https://ollama.com';
const MODEL = import.meta.env.VITE_OLLAMA_MODEL || 'minimax-m2.7:cloud';
const VISION_MODEL = import.meta.env.VITE_OLLAMA_VISION_MODEL || 'gemma4:31b-cloud';
const VOICE_MODEL = import.meta.env.VITE_OLLAMA_VOICE_MODEL || 'minimax-m2.7:cloud';
// Same-origin proxy path in both dev and prod; server rewrites /ollama-api → ollama.com/api
const API_CHAT_URL = '/ollama-api/chat';

export interface AICardSuggestion {
  title: string;
  description: string;
  checklist: string[];
  labels: { name: string; color: string }[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  taskGroup?: string;
  taskOrder?: number;
}

async function chatCompletion(
  prompt: string,
  onChunk?: (partial: string) => void,
  retries = 2
): Promise<string> {
  const body = JSON.stringify({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a helpful project management assistant. You help break down tasks into actionable items for a Trello-like board. Always respond in valid JSON only, no markdown, no code blocks, no extra text. Do not use thinking tags.',
      },
      { role: 'user', content: prompt },
    ],
    stream: true,
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(API_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY ? { 'Authorization': `Bearer ${API_KEY}` } : {}),
        },
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status >= 500 && attempt < retries) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw new Error(`AI API error (${response.status}): ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            const token = parsed.message?.content ?? '';
            if (token) {
              fullContent += token;
              onChunk?.(fullContent);
            }
          } catch {
            // skip malformed lines
          }
        }
      }

      return fullContent;
    } catch (err) {
      if (attempt < retries && !(err instanceof Error && err.message.startsWith('AI API error'))) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error('AI request failed after retries');
}

export async function voiceChat(
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  onChunk?: (partial: string) => void
): Promise<string> {
  const body = JSON.stringify({
    model: VOICE_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a friendly voice assistant. Keep responses concise and conversational — ideally 1-3 sentences. Be natural and direct, as your responses will be read aloud.',
      },
      ...history,
      { role: 'user', content: message },
    ],
    stream: true,
  });

  const response = await fetch(API_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'Authorization': `Bearer ${API_KEY}` } : {}),
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Voice AI error (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const token = parsed.message?.content ?? '';
        if (token) {
          fullContent += token;
          onChunk?.(fullContent);
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  return fullContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export async function chatWithImage(
  prompt: string,
  imageBase64: string,
  onChunk?: (partial: string) => void
): Promise<string> {
  // Use a vision-capable model (e.g. gemma4) with native Ollama images field
  const body = JSON.stringify({
    model: VISION_MODEL,
    messages: [
      {
        role: 'user',
        content: prompt || 'What is in this image? Describe it in detail.',
        images: [imageBase64],
      },
    ],
    stream: true,
  });

  const response = await fetch(API_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'Authorization': `Bearer ${API_KEY}` } : {}),
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vision AI error (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const token = parsed.message?.content ?? '';
        if (token) {
          fullContent += token;
          onChunk?.(fullContent);
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  return fullContent;
}

function parseJSON(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  try { return JSON.parse(cleaned); } catch { /* fall through */ }

  const codeMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) return JSON.parse(codeMatch[1].trim());

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]); } catch { /* fall through */ }
  }

  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) return JSON.parse(objectMatch[0]);

  return JSON.parse(cleaned);
}

export async function generateCardFromDescription(
  description: string,
  existingLabels: { name: string; color: string }[] = [],
  onChunk?: (partial: string) => void
): Promise<AICardSuggestion> {
  const labelContext = existingLabels.length > 0
    ? `\nExisting labels on this board: ${existingLabels.map(l => `"${l.name}" (${l.color})`).join(', ')}. Reuse existing labels when they fit.`
    : '';

  const availableColors = ['#61BD4F', '#F2D600', '#FF9F1A', '#EB5A46', '#C377E0', '#0079BF', '#00C2E0', '#51E898', '#FF78CB', '#344563'];

  const prompt = `Given this simple task description: "${description}"
${labelContext}

Generate a structured task card with:
1. A clear, concise title (max 60 chars)
2. A detailed description explaining what needs to be done (2-4 sentences)
3. A checklist of 3-6 actionable sub-tasks to complete this task
4. 1-3 labels that categorize this task. For each label, provide a name and a color from: ${availableColors.join(', ')}
5. A priority: "critical", "high", "medium", or "low"

Respond ONLY with this exact JSON format, nothing else:
{"title": "Clear task title", "description": "Detailed description...", "checklist": ["Step 1", "Step 2", "Step 3"], "labels": [{"name": "Feature", "color": "#61BD4F"}], "priority": "medium"}`;

  const content = await chatCompletion(prompt, onChunk);
  const parsed = parseJSON(content) as AICardSuggestion;

  if (!parsed.title || !parsed.description || !Array.isArray(parsed.checklist)) {
    throw new Error('Invalid AI response format');
  }
  if (!Array.isArray(parsed.labels)) parsed.labels = [];
  return parsed;
}

export async function analyzeRequirements(
  requirement: string,
  existingLabels: { name: string; color: string }[] = [],
  onChunk?: (partial: string) => void
): Promise<AICardSuggestion[]> {
  const labelContext = existingLabels.length > 0
    ? `\nExisting labels on this board: ${existingLabels.map(l => `"${l.name}" (${l.color})`).join(', ')}. Reuse existing labels when they fit.`
    : '';

  const availableColors = ['#61BD4F', '#F2D600', '#FF9F1A', '#EB5A46', '#C377E0', '#0079BF', '#00C2E0', '#51E898', '#FF78CB', '#344563'];

  const prompt = `You are a project management assistant. Analyze the following requirement and break it down into individual tasks for a Trello board.

Requirement: "${requirement}"
${labelContext}

Break this down into 2-6 individual task cards. Tasks should be ordered by execution dependency (what must be done first). For each task provide:
1. A clear, concise title (max 60 chars)
2. A brief description (1-2 sentences)
3. A checklist of 2-4 actionable sub-tasks
4. 1-2 labels with a name and color from: ${availableColors.join(', ')}
5. A priority: "critical", "high", "medium", or "low" — based on importance and dependency order
6. A taskGroup: a short group name that groups related tasks together (e.g. "Auth System", "Database Setup")
7. A taskOrder: a number starting from 1 indicating execution order within the group (1 = do first, 2 = do second, etc.)

Respond ONLY with a JSON array, nothing else:
[{"title":"Task title","description":"Brief description","checklist":["Step 1","Step 2"],"labels":[{"name":"Feature","color":"#61BD4F"}],"priority":"high","taskGroup":"Group Name","taskOrder":1}]`;

  const content = await chatCompletion(prompt, onChunk);
  const parsed = parseJSON(content);

  if (!Array.isArray(parsed)) throw new Error('AI did not return an array of tasks');
  return (parsed as AICardSuggestion[]).filter(t => t.title && t.description);
}

export async function freeChat(
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  onChunk?: (partial: string) => void
): Promise<string> {
  const body = JSON.stringify({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a helpful brainstorming and project planning assistant. Help the user think through ideas, suggest approaches, and discuss solutions. Respond in clear, concise natural language. Do NOT respond in JSON.',
      },
      ...history,
      { role: 'user', content: message },
    ],
    stream: true,
  });

  const response = await fetch(API_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'Authorization': `Bearer ${API_KEY}` } : {}),
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API error (${response.status}): ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        const token = parsed.message?.content ?? '';
        if (token) {
          fullContent += token;
          onChunk?.(fullContent);
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  // Strip thinking tags if present
  return fullContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export async function generateDescriptionAndChecklist(
  title: string,
  onChunk?: (partial: string) => void
): Promise<{ description: string; checklist: string[] }> {
  const prompt = `Given this task card title: "${title}"

Generate:
1. A detailed description explaining what this task involves (2-4 sentences)
2. A checklist of 3-6 actionable sub-tasks

Respond ONLY with this exact JSON format, nothing else:
{"description": "Detailed description...", "checklist": ["Step 1", "Step 2", "Step 3"]}`;

  const content = await chatCompletion(prompt, onChunk);
  const parsed = parseJSON(content) as { description: string; checklist: string[] };

  if (!parsed.description || !Array.isArray(parsed.checklist)) {
    throw new Error('Invalid AI response format');
  }
  return parsed;
}
