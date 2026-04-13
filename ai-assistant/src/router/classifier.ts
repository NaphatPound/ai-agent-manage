import { ollamaChat, OllamaChatMessage } from '../utils/ollama';

export type IntentType = 'rag' | 'mcp' | 'chat';

export interface ClassificationResult {
  intent: IntentType;
  reason: string;
  tool?: string;
}

const SYSTEM_PROMPT = `You are a Dispatcher AI. Analyze the user's message and classify the intent.
Respond ONLY with valid JSON in this exact format:
{"intent": "<rag|mcp|chat>", "reason": "<brief reason>", "tool": "<tool_name or null>"}

Intent types:
- "rag": User is asking for knowledge, information, documentation, or manual lookup.
- "mcp": User wants to perform an action: check stock, send email, get calendar, call an API, get map/location data.
- "chat": General conversation, greeting, or casual talk.

Available MCP tools:
- "get_stock": Check inventory/stock levels
- "get_calendar": Check calendar/schedule
- "get_location": Get map/location data
- "send_notification": Send email or notification

Always respond with valid JSON only. No extra text.`;

export async function classifyIntent(userMessage: string, model?: string): Promise<ClassificationResult> {
  const messages: OllamaChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];

  const response = await ollamaChat(messages, { format: 'json', model });

  try {
    const parsed = JSON.parse(response);
    return {
      intent: parsed.intent || 'chat',
      reason: parsed.reason || 'No reason provided',
      tool: parsed.tool || undefined,
    };
  } catch {
    return { intent: 'chat', reason: 'Failed to parse classification response' };
  }
}
