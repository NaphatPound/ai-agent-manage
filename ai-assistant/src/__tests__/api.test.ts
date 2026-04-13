import express from 'express';
import request from 'supertest';
import apiRoutes from '../api/routes';
import { pool } from '../utils/db';

const app = express();
app.use(express.json());
app.use('/api', apiRoutes);

afterAll(async () => {
  await pool.end();
});

describe('API Endpoints', () => {
  test('GET /api/health returns status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.mcpTools).toBeDefined();
    expect(Array.isArray(res.body.mcpTools)).toBe(true);
  });

  test('GET /api/tools returns tool list', async () => {
    const res = await request(app).get('/api/tools');
    expect(res.status).toBe(200);
    expect(res.body.tools).toBeDefined();
    expect(res.body.tools.length).toBeGreaterThanOrEqual(4);
  });

  test('POST /api/chat without message returns 400', async () => {
    const res = await request(app).post('/api/chat').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('POST /api/chat with non-string message returns 400', async () => {
    const res = await request(app).post('/api/chat').send({ message: 123 });
    expect(res.status).toBe(400);
  });

  test('POST /api/documents without required fields returns 400', async () => {
    const res = await request(app).post('/api/documents').send({});
    expect(res.status).toBe(400);
  });

  test('DELETE /api/documents clears documents', async () => {
    const res = await request(app).delete('/api/documents');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
