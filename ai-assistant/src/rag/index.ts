import { searchDocuments, addDocument, getDocumentCount, clearDocuments, SearchResult } from './vectorStore';

export interface RagSearchResult {
  context: string;
  sources: SearchResult[];
}

export async function ragSearch(query: string, namespace?: string, topK: number = 3): Promise<RagSearchResult> {
  const results = await searchDocuments(query, topK, namespace);

  if (results.length === 0) {
    return {
      context: 'No relevant documents found in the knowledge base.',
      sources: [],
    };
  }

  // Keep sources the model actually sees (score > 0.5) so the sources pane
  // matches the grounded answer.
  const relevant = results.filter((r) => r.score > 0.5);
  const context = relevant.length
    ? relevant.map((r, i) => `[${i + 1}] (score: ${r.score.toFixed(3)})\n${r.content}`).join('\n\n')
    : 'No sufficiently relevant documents found.';

  return { context, sources: relevant };
}

export { addDocument, getDocumentCount, clearDocuments };
export type { SearchResult };
