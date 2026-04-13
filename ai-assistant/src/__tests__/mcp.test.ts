import { executeMcpTool, listTools } from '../mcp';

describe('MCP Tools', () => {
  test('listTools returns all registered tools', () => {
    const tools = listTools();
    expect(tools.length).toBeGreaterThanOrEqual(4);
    const names = tools.map((t) => t.name);
    expect(names).toContain('get_stock');
    expect(names).toContain('get_calendar');
    expect(names).toContain('get_location');
    expect(names).toContain('send_notification');
  });

  test('executeMcpTool - get_stock returns data', async () => {
    const result = await executeMcpTool('get_stock', 'check stock levels');
    expect(result.success).toBe(true);
    expect(result.tool).toBe('get_stock');
    expect(result.data).toBeDefined();
  });

  test('executeMcpTool - get_calendar returns events', async () => {
    const result = await executeMcpTool('get_calendar', 'show my schedule');
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  test('executeMcpTool - get_location returns coordinates', async () => {
    const result = await executeMcpTool('get_location', 'find Bangkok on map');
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  test('executeMcpTool - send_notification succeeds', async () => {
    const result = await executeMcpTool('send_notification', 'send notification to team');
    expect(result.success).toBe(true);
  });

  test('executeMcpTool - unknown tool with fallback', async () => {
    const result = await executeMcpTool('unknown_tool', 'check stock');
    // Should fallback to get_stock since message contains "stock"
    expect(result.success).toBe(true);
    expect(result.tool).toBe('get_stock');
  });

  test('executeMcpTool - unknown tool without match returns error', async () => {
    const result = await executeMcpTool('unknown_tool', 'do something random xyz');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
