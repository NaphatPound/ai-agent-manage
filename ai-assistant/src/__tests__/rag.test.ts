import { cosineSimilarity } from '../rag/vectorStore';

// Cosine similarity is pure math - no DB needed
describe('Cosine Similarity', () => {
  test('identical vectors return 1', () => {
    const a = [1, 0, 0];
    const b = [1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1);
  });

  test('orthogonal vectors return 0', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0);
  });

  test('opposite vectors return -1', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1);
  });

  test('different length vectors return 0', () => {
    const a = [1, 0];
    const b = [1, 0, 0];
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});
