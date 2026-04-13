import { ollamaChat, OllamaChatMessage } from '../utils/ollama';
import { addDocument } from '../rag/vectorStore';
import { pool } from '../utils/db';

// === SENTENCE SPLITTING ===

export function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation, keeping Thai and English
  const raw = text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?\u0E2F\u0E30])\s+|(?<=\n)\s*/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 10); // Skip very short fragments

  return raw;
}

export function splitChunks(text: string, maxChunkSize: number = 200, overlap: number = 30): string[] {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return [text];

  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChunkSize && current.length > 0) {
      chunks.push(current.trim());
      // Overlap: keep last N chars for context continuity
      const overlapText = current.slice(-overlap);
      current = overlapText + ' ' + sentence;
    } else {
      current += (current ? ' ' : '') + sentence;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

export interface ChunkResult {
  parentId: string;
  chunks: { id: string; content: string }[];
  totalChunks: number;
}

export async function splitAndStore(
  docId: string,
  content: string,
  mode: 'sentence' | 'chunk' = 'chunk',
  chunkSize: number = 200,
  extraMetadata?: Record<string, string>
): Promise<ChunkResult> {
  const parts = mode === 'sentence' ? splitSentences(content) : splitChunks(content, chunkSize);

  // Store the parent document reference
  const storedChunks: { id: string; content: string }[] = [];

  for (let i = 0; i < parts.length; i++) {
    const chunkId = `${docId}_chunk_${i + 1}`;
    const metadata: Record<string, string> = {
      ...(extraMetadata || {}),
      parent_id: docId,
      chunk_index: String(i + 1),
      total_chunks: String(parts.length),
    };
    await addDocument(chunkId, parts[i], metadata);
    storedChunks.push({ id: chunkId, content: parts[i] });
  }

  return {
    parentId: docId,
    chunks: storedChunks,
    totalChunks: storedChunks.length,
  };
}

// === AI Q&A GENERATION ===

export interface QAPair {
  question: string;
  answer: string;
}

export interface QAResult {
  parentId: string;
  pairs: { id: string; question: string; answer: string }[];
  totalPairs: number;
}

const QA_SYSTEM_PROMPT = `You are an expert at analyzing documents and creating question-answer pairs for a knowledge base.

Given a document, generate comprehensive Q&A pairs that cover the key information.

Rules:
- Generate 3-8 Q&A pairs depending on document length and complexity
- Questions should be natural, like how a real person would ask
- Answers should be concise but complete, based ONLY on the document content
- Cover different aspects: facts, definitions, procedures, conditions, exceptions
- Include both simple factual questions and more detailed ones
- Generate questions in the same language as the document

Respond ONLY with valid JSON object in this exact format:
{"pairs": [{"question": "...", "answer": "..."}, ...]}

Do not include any text outside the JSON object.`;

export async function generateQA(content: string): Promise<QAPair[]> {
  const messages: OllamaChatMessage[] = [
    { role: 'system', content: QA_SYSTEM_PROMPT },
    { role: 'user', content: `Analyze this document and generate Q&A pairs:\n\n${content}` },
  ];

  const rawResponse = await ollamaChat(messages, { format: 'json' });

  // Strip markdown code fences if present
  const response = rawResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  try {
    let parsed = JSON.parse(response);
    // Handle both array and {pairs: [...]} formats
    if (!Array.isArray(parsed)) {
      parsed = parsed.pairs || parsed.questions || parsed.qa || [];
    }
    return parsed.filter(
      (p: any) => p.question && p.answer && typeof p.question === 'string' && typeof p.answer === 'string'
    );
  } catch {
    return [];
  }
}

export async function generateAndStoreQA(docId: string, content: string): Promise<QAResult> {
  const pairs = await generateQA(content);
  const stored: { id: string; question: string; answer: string }[] = [];

  for (let i = 0; i < pairs.length; i++) {
    const qaId = `${docId}_qa_${i + 1}`;
    // Store as "Q: question\nA: answer" for better semantic matching
    const qaContent = `Q: ${pairs[i].question}\nA: ${pairs[i].answer}`;
    await addDocument(qaId, qaContent, {
      parent_id: docId,
      type: 'qa',
      question: pairs[i].question,
      answer: pairs[i].answer,
    });
    stored.push({ id: qaId, question: pairs[i].question, answer: pairs[i].answer });
  }

  return {
    parentId: docId,
    pairs: stored,
    totalPairs: stored.length,
  };
}
