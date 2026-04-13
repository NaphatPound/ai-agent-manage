import { classifyIntent, ClassificationResult, IntentType } from './classifier';
import { ragSearch, SearchResult } from '../rag';
import { executeMcpTool } from '../mcp';
import { ollamaChat, OllamaChatMessage } from '../utils/ollama';

export interface OrchestratorResult {
  classification: ClassificationResult;
  response: string;
  path: IntentType;
  model: string;
  namespace?: string;
  sources?: SearchResult[];
}

export async function orchestrate(
  userMessage: string,
  chatHistory: OllamaChatMessage[] = [],
  model?: string,
  namespace?: string
): Promise<OrchestratorResult> {
  // When the caller pins a namespace, they are explicitly asking memory —
  // skip the intent classifier and go straight to RAG so we don't bounce
  // into free-chat when the classifier is unsure.
  const forceRag = typeof namespace === 'string' && namespace.trim().length > 0;

  const classification: ClassificationResult = forceRag
    ? { intent: 'rag', reason: `namespace=${namespace}` }
    : await classifyIntent(userMessage, model);

  let response: string;
  let sources: SearchResult[] | undefined;

  switch (classification.intent) {
    case 'rag': {
      const { context, sources: ragSources } = await ragSearch(userMessage, namespace);
      sources = ragSources;
      const messages: OllamaChatMessage[] = [
        {
          role: 'system',
          content: `You are a helpful AI assistant. Use the following context to answer the user's question. If the context doesn't contain relevant information, say so honestly.${namespace ? `\n\nYou are answering questions scoped to memory namespace "${namespace}".` : ''}\n\nContext:\n${context}`,
        },
        ...chatHistory,
        { role: 'user', content: userMessage },
      ];
      response = await ollamaChat(messages, { model });
      break;
    }

    case 'mcp': {
      const toolResult = await executeMcpTool(classification.tool || '', userMessage);
      const messages: OllamaChatMessage[] = [
        {
          role: 'system',
          content: `You are a helpful AI assistant. The user requested an action and here is the result from the tool "${classification.tool}":\n\n${JSON.stringify(toolResult, null, 2)}\n\nSummarize this result in a natural, helpful way.`,
        },
        ...chatHistory,
        { role: 'user', content: userMessage },
      ];
      response = await ollamaChat(messages, { model });
      break;
    }

    case 'chat':
    default: {
      const messages: OllamaChatMessage[] = [
        {
          role: 'system',
          content: 'You are a friendly and helpful AI assistant. Respond naturally to the user.',
        },
        ...chatHistory,
        { role: 'user', content: userMessage },
      ];
      response = await ollamaChat(messages, { model });
      break;
    }
  }

  return {
    classification,
    response,
    path: classification.intent,
    model: model || 'default',
    namespace: namespace || undefined,
    sources,
  };
}
