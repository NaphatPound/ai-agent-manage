import dotenv from 'dotenv';
dotenv.config();

export const config = {
  ollama: {
    apiUrl: process.env.OLLAMA_API_URL || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'llama3',
    embeddingModel: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
  },
  database: {
    url: process.env.DATABASE_URL || 'postgresql://administrator@localhost:5433/ai_assistant',
  },
};
