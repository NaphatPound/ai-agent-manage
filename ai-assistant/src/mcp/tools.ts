export interface McpTool {
  name: string;
  description: string;
  execute: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

// Mock tool implementations (replace with real API calls)
const tools: Map<string, McpTool> = new Map();

// Tool: Get Stock/Inventory
tools.set('get_stock', {
  name: 'get_stock',
  description: 'Check inventory/stock levels for products',
  execute: async (params) => {
    // Mock data - replace with real API
    return {
      success: true,
      data: {
        product: params.product || 'all',
        items: [
          { name: 'Widget A', quantity: 150, warehouse: 'Bangkok' },
          { name: 'Widget B', quantity: 42, warehouse: 'Bangkok' },
          { name: 'Gadget X', quantity: 0, warehouse: 'Chiang Mai' },
        ],
        timestamp: new Date().toISOString(),
      },
    };
  },
});

// Tool: Get Calendar
tools.set('get_calendar', {
  name: 'get_calendar',
  description: 'Check calendar and schedule events',
  execute: async () => {
    return {
      success: true,
      data: {
        events: [
          { title: 'Team Standup', time: '09:00', duration: '30min' },
          { title: 'Sprint Review', time: '14:00', duration: '1hr' },
          { title: 'Deploy to Production', time: '16:00', duration: '2hr' },
        ],
        date: new Date().toISOString().split('T')[0],
      },
    };
  },
});

// Tool: Get Location
tools.set('get_location', {
  name: 'get_location',
  description: 'Get map/location data for a place',
  execute: async (params) => {
    return {
      success: true,
      data: {
        query: params.place || 'Bangkok',
        lat: 13.7563,
        lng: 100.5018,
        address: 'Bangkok, Thailand',
        nearby: ['Central World', 'Siam Paragon', 'MBK Center'],
      },
    };
  },
});

// Tool: Send Notification
tools.set('send_notification', {
  name: 'send_notification',
  description: 'Send email or notification',
  execute: async (params) => {
    return {
      success: true,
      data: {
        message: `Notification sent to ${params.recipient || 'default'}`,
        content: params.content || 'No content provided',
        sentAt: new Date().toISOString(),
      },
    };
  },
});

export function getTool(name: string): McpTool | undefined {
  return tools.get(name);
}

export function listTools(): McpTool[] {
  return Array.from(tools.values());
}
