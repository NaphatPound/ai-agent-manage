import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './utils/config';
import apiRoutes from './api/routes';
import { initDatabase } from './utils/db';

const app = express();

app.use(cors());
app.use(express.json());

// API routes
app.use('/api', apiRoutes);

// Serve frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// API info fallback
app.get('/api-info', (_req, res) => {
  res.json({
    name: 'AI Agentic Orchestrator',
    version: '1.0.0',
    endpoints: {
      health: 'GET /api/health',
      chat: 'POST /api/chat',
      documents: 'POST /api/documents',
      tools: 'GET /api/tools',
    },
  });
});

async function start() {
  await initDatabase();
  console.log('Database connected (PostgreSQL + pgvector)');

  app.listen(config.server.port, () => {
    console.log(`AI Orchestrator running on http://localhost:${config.server.port}`);
    console.log(`Ollama API: ${config.ollama.apiUrl}`);
    console.log(`Model: ${config.ollama.model}`);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});

export default app;
