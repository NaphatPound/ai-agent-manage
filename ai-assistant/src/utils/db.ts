import { Pool } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.database.url,
});

export async function initDatabase(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      embedding vector(768),
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // HNSW index for cosine similarity (works better than IVFFlat with small datasets)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS documents_embedding_hnsw_idx
    ON documents USING hnsw (embedding vector_cosine_ops);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_history (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}
