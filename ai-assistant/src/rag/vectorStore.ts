import { ollamaEmbed } from '../utils/ollama';
import { pool } from '../utils/db';

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function addDocument(id: string, content: string, metadata?: Record<string, string>): Promise<void> {
  const embedding = await ollamaEmbed(content);
  const embeddingStr = `[${embedding.join(',')}]`;

  await pool.query(
    `INSERT INTO documents (id, content, embedding, metadata)
     VALUES ($1, $2, $3::vector, $4)
     ON CONFLICT (id) DO UPDATE SET content = $2, embedding = $3::vector, metadata = $4`,
    [id, content, embeddingStr, JSON.stringify(metadata || {})]
  );
}

export interface DocumentWithEmbedding {
  id: string;
  content: string;
  embedding: number[];
  created_at: string;
}

export async function getAllDocumentsWithEmbeddings(): Promise<DocumentWithEmbedding[]> {
  const result = await pool.query(
    `SELECT id, content, embedding::text, created_at FROM documents ORDER BY created_at`
  );

  return result.rows.map((row) => ({
    id: row.id,
    content: row.content,
    embedding: row.embedding
      .replace('[', '')
      .replace(']', '')
      .split(',')
      .map(Number),
    created_at: row.created_at,
  }));
}

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  metadata: Record<string, string>;
}

export async function searchDocuments(
  query: string,
  topK: number = 3,
  namespace?: string
): Promise<SearchResult[]> {
  const count = await getDocumentCount();
  if (count === 0) return [];

  const queryEmbedding = await ollamaEmbed(query);
  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  const result = namespace
    ? await pool.query(
        `SELECT id, content, metadata, 1 - (embedding <=> $1::vector) AS score
         FROM documents
         WHERE metadata->>'namespace' = $2
         ORDER BY embedding <=> $1::vector
         LIMIT $3`,
        [embeddingStr, namespace, topK]
      )
    : await pool.query(
        `SELECT id, content, metadata, 1 - (embedding <=> $1::vector) AS score
         FROM documents
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        [embeddingStr, topK]
      );

  return result.rows.map((row) => ({
    id: row.id,
    content: row.content,
    score: parseFloat(row.score),
    metadata: row.metadata || {},
  }));
}

export interface NamespaceStat {
  namespace: string;
  count: number;
}

export async function listNamespaces(): Promise<NamespaceStat[]> {
  const result = await pool.query(
    `SELECT metadata->>'namespace' AS namespace, COUNT(*)::int AS count
     FROM documents
     WHERE metadata ? 'namespace'
     GROUP BY metadata->>'namespace'
     ORDER BY count DESC, namespace ASC`
  );
  return result.rows.map((r) => ({ namespace: r.namespace, count: r.count }));
}

export async function getDocumentCount(): Promise<number> {
  const result = await pool.query('SELECT COUNT(*) FROM documents');
  return parseInt(result.rows[0].count, 10);
}

export async function clearDocuments(): Promise<void> {
  await pool.query('DELETE FROM documents');
}
