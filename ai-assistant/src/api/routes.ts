import { Router, Request, Response } from 'express';
import { orchestrate } from '../router';
import { addDocument, getDocumentCount, clearDocuments } from '../rag';
import { getAllDocumentsWithEmbeddings, searchDocuments } from '../rag/vectorStore';
import { splitAndStore, generateAndStoreQA, splitSentences, splitChunks } from '../rag/processor';
import { listTools } from '../mcp';
import { config } from '../utils/config';

const router = Router();

// Health check
router.get('/health', async (_req: Request, res: Response) => {
  const docCount = await getDocumentCount();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    documentsInRAG: docCount,
    mcpTools: listTools().map((t) => t.name),
  });
});

// List available models with friendly labels
router.get('/models', async (_req: Request, res: Response) => {
  try {
    const ollamaRes = await fetch(`${config.ollama.apiUrl}/api/tags`);
    const data = (await ollamaRes.json()) as { models: any[] };

    // Map models to friendly profiles
    const modelProfiles: Record<string, { label: string; description: string; icon: string; speed: string }> = {
      'gemma3:27b-cloud': { label: 'Fast', description: 'Gemma 3 27B - Quick responses, good for everyday tasks', icon: '&#x26A1;', speed: 'fast' },
      'qwen3.5:397b-cloud': { label: 'Pro', description: 'Qwen 3.5 397B - Most capable, best quality answers', icon: '&#x1F48E;', speed: 'slow' },
      'qwen3.5:cloud': { label: 'Pro', description: 'Qwen 3.5 397B - Most capable, best quality answers', icon: '&#x1F48E;', speed: 'slow' },
      'qwen3-coder-next:cloud': { label: 'Coder', description: 'Qwen 3 Coder 80B - Specialized for code and technical tasks', icon: '&#x1F4BB;', speed: 'medium' },
      'minimax-m2.7:cloud': { label: 'Creative', description: 'MiniMax M2.7 - Great for creative and multimodal tasks', icon: '&#x1F3A8;', speed: 'medium' },
      'kimi-k2.5:cloud': { label: 'Balanced', description: 'Kimi K2.5 - Good balance of speed and quality', icon: '&#x2696;', speed: 'medium' },
      'glm-4.7:cloud': { label: 'GLM', description: 'GLM 4.7 - General purpose assistant', icon: '&#x1F916;', speed: 'medium' },
    };

    const chatModels = data.models
      .filter((m) => m.name !== 'nomic-embed-text:latest') // exclude embedding model
      .map((m) => {
        const profile = modelProfiles[m.name];
        return {
          id: m.name,
          label: profile?.label || m.name.split(':')[0],
          description: profile?.description || `${m.details?.family || 'Unknown'} - ${m.details?.parameter_size || 'Unknown size'}`,
          icon: profile?.icon || '&#x1F916;',
          speed: profile?.speed || 'medium',
          family: m.details?.family || '',
          parameterSize: m.details?.parameter_size || '',
          isDefault: m.name === config.ollama.model,
        };
      });

    res.json({ models: chatModels, default: config.ollama.model });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: errorMessage });
  }
});

// Main chat endpoint
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, history, model } = req.body;

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required and must be a string' });
      return;
    }

    const result = await orchestrate(message, history || [], model || undefined);

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: errorMessage });
  }
});

// Add document to RAG
router.post('/documents', async (req: Request, res: Response) => {
  try {
    const { id, content, metadata } = req.body;

    if (!id || !content) {
      res.status(400).json({ error: 'id and content are required' });
      return;
    }

    await addDocument(id, content, metadata);

    res.json({
      success: true,
      message: `Document "${id}" added successfully`,
      totalDocuments: await getDocumentCount(),
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: errorMessage });
  }
});

// Clear all RAG documents
router.delete('/documents', async (_req: Request, res: Response) => {
  await clearDocuments();
  res.json({ success: true, message: 'All documents cleared' });
});

// Split document into chunks and add to vector DB
router.post('/documents/split', async (req: Request, res: Response) => {
  try {
    const { id, content, mode, chunkSize } = req.body;

    if (!id || !content) {
      res.status(400).json({ error: 'id and content are required' });
      return;
    }

    const result = await splitAndStore(id, content, mode || 'chunk', chunkSize || 200);

    res.json({
      success: true,
      ...result,
      totalDocuments: await getDocumentCount(),
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: errorMessage });
  }
});

// Preview sentence/chunk splitting without storing
router.post('/documents/split/preview', (req: Request, res: Response) => {
  const { content, mode, chunkSize } = req.body;

  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  const parts = mode === 'sentence' ? splitSentences(content) : splitChunks(content, chunkSize || 200);

  res.json({
    mode: mode || 'chunk',
    parts: parts.map((p, i) => ({ index: i + 1, content: p, length: p.length })),
    totalParts: parts.length,
  });
});

// AI generate Q&A from document and add to vector DB
router.post('/documents/generate-qa', async (req: Request, res: Response) => {
  try {
    const { id, content } = req.body;

    if (!id || !content) {
      res.status(400).json({ error: 'id and content are required' });
      return;
    }

    const result = await generateAndStoreQA(id, content);

    res.json({
      success: true,
      ...result,
      totalDocuments: await getDocumentCount(),
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: errorMessage });
  }
});

// List all documents with 2D projected coordinates for visualization
router.get('/documents/vectors', async (_req: Request, res: Response) => {
  try {
    const docs = await getAllDocumentsWithEmbeddings();
    const projected = projectTo2D(docs.map((d) => d.embedding));

    const result = docs.map((doc, i) => ({
      id: doc.id,
      content: doc.content,
      x: projected[i]?.[0] || 0,
      y: projected[i]?.[1] || 0,
      created_at: doc.created_at,
    }));

    res.json({ documents: result, total: result.length });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: errorMessage });
  }
});

// Search documents with similarity scores
router.post('/documents/search', async (req: Request, res: Response) => {
  try {
    const { query, topK } = req.body;

    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'query is required and must be a string' });
      return;
    }

    const results = await searchDocuments(query, topK || 10);

    res.json({
      query,
      results: results.map((r) => ({
        ...r,
        matchPercent: Math.round(r.score * 100),
      })),
      total: results.length,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ success: false, error: errorMessage });
  }
});

// List MCP tools
router.get('/tools', (_req: Request, res: Response) => {
  const tools = listTools().map((t) => ({
    name: t.name,
    description: t.description,
  }));
  res.json({ tools });
});

// Simple PCA: project high-dimensional embeddings to 2D
function projectTo2D(embeddings: number[][]): number[][] {
  if (embeddings.length === 0) return [];
  if (embeddings.length === 1) return [[0, 0]];

  const dim = embeddings[0].length;
  const n = embeddings.length;

  // Compute mean
  const mean = new Array(dim).fill(0);
  for (const emb of embeddings) {
    for (let j = 0; j < dim; j++) mean[j] += emb[j];
  }
  for (let j = 0; j < dim; j++) mean[j] /= n;

  // Center data
  const centered = embeddings.map((emb) => emb.map((v, j) => v - mean[j]));

  // Power iteration to find top 2 principal components
  const pc1 = powerIteration(centered, dim);
  // Deflate
  const deflated = centered.map((row) => {
    const dot = row.reduce((s, v, j) => s + v * pc1[j], 0);
    return row.map((v, j) => v - dot * pc1[j]);
  });
  const pc2 = powerIteration(deflated, dim);

  // Project
  return centered.map((row) => [
    row.reduce((s, v, j) => s + v * pc1[j], 0),
    row.reduce((s, v, j) => s + v * pc2[j], 0),
  ]);
}

function powerIteration(data: number[][], dim: number): number[] {
  let vec = Array.from({ length: dim }, () => Math.random() - 0.5);
  let norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  vec = vec.map((v) => v / norm);

  for (let iter = 0; iter < 50; iter++) {
    const newVec = new Array(dim).fill(0);
    for (const row of data) {
      const dot = row.reduce((s, v, j) => s + v * vec[j], 0);
      for (let j = 0; j < dim; j++) newVec[j] += dot * row[j];
    }
    norm = Math.sqrt(newVec.reduce((s, v) => s + v * v, 0));
    if (norm === 0) break;
    vec = newVec.map((v) => v / norm);
  }
  return vec;
}

export default router;
