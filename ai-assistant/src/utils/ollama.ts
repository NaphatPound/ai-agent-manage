import { config } from './config';

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatResponse {
  message: { role: string; content: string };
  done: boolean;
}

export interface OllamaEmbeddingResponse {
  embedding: number[];
}

export async function ollamaChat(
  messages: OllamaChatMessage[],
  options?: { model?: string; format?: 'json' }
): Promise<string> {
  const res = await fetch(`${config.ollama.apiUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options?.model || config.ollama.model,
      messages,
      stream: false,
      ...(options?.format && { format: options.format }),
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama chat failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as OllamaChatResponse;
  return data.message.content;
}

export async function ollamaEmbed(text: string): Promise<number[]> {
  const res = await fetch(`${config.ollama.apiUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollama.embeddingModel,
      prompt: text,
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama embedding failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as OllamaEmbeddingResponse;
  return data.embedding;
}
