import { getTool, listTools } from './tools';

export interface McpResult {
  tool: string;
  success: boolean;
  data: Record<string, unknown>;
  error?: string;
}

export async function executeMcpTool(toolName: string, userMessage: string): Promise<McpResult> {
  const tool = getTool(toolName);

  if (!tool) {
    // Try to find a matching tool from the message context
    const allTools = listTools();
    const fallback = allTools.find((t) =>
      userMessage.toLowerCase().includes(t.name.replace('get_', '').replace('send_', ''))
    );

    if (fallback) {
      const result = await fallback.execute({ query: userMessage });
      return { tool: fallback.name, success: true, data: result };
    }

    return {
      tool: toolName,
      success: false,
      data: {},
      error: `Tool "${toolName}" not found. Available tools: ${allTools.map((t) => t.name).join(', ')}`,
    };
  }

  try {
    const result = await tool.execute({ query: userMessage });
    return { tool: toolName, success: true, data: result };
  } catch (err) {
    return {
      tool: toolName,
      success: false,
      data: {},
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

export { listTools };
