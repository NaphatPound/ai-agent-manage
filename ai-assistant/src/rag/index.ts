import { searchDocuments, addDocument, getDocumentCount, clearDocuments } from './vectorStore';

export async function ragSearch(query: string): Promise<string> {
  const results = await searchDocuments(query, 3);

  if (results.length === 0) {
    return 'No relevant documents found in the knowledge base.';
  }

  const context = results
    .filter((r) => r.score > 0.5)
    .map((r, i) => `[${i + 1}] (score: ${r.score.toFixed(3)})\n${r.content}`)
    .join('\n\n');

  return context || 'No sufficiently relevant documents found.';
}

export { addDocument, getDocumentCount, clearDocuments };
