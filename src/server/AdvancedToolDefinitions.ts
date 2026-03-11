import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const advancedTools: Tool[] = [
  {
    name: 'network_enable',
    description: `Enable network monitoring for captured HTTP requests and responses.

Important:
- Enable monitoring before navigating if you want the initial page requests.
- You can also use page_navigate(enableNetworkMonitoring=true) to enable it automatically.

Recommended sequence:
1. network_enable()
2. page_navigate("https://example.com")
3. network_get_requests()`,
    inputSchema: {
      type: 'object',
      properties: {
        enableExceptions: {
          type: 'boolean',
          description: 'Also enable exception monitoring.',
          default: true,
        },
      },
    },
  },
  {
    name: 'network_disable',
    description: 'Disable network monitoring.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'network_get_status',
    description: 'Get the current network monitoring state, including listener counts and captured totals.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'network_get_requests',
    description: `Return captured network requests with optional filtering.

Large results may return a summary plus detailId.

Returned fields include:
- requestId
- url
- method
- headers
- postData
- timestamp
- type

Tips:
- Use the URL filter to narrow results.
- Keep the limit small when exploring large pages.
- Use network_get_response_body(requestId) to inspect a response body.`,
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Substring filter applied to request URLs.',
        },
        method: {
          type: 'string',
          description: 'HTTP method filter such as GET or POST.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of requests to return.',
          default: 50,
        },
      },
    },
  },
  {
    name: 'network_get_response_body',
    description: 'Get the response body for a specific request. Large bodies can be summarized to avoid context overflow.',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: {
          type: 'string',
          description: 'Request ID returned by network_get_requests.',
        },
        maxSize: {
          type: 'number',
          description: 'Maximum body size in bytes before summary mode is preferred.',
          default: 100000,
        },
        returnSummary: {
          type: 'boolean',
          description: 'Return only a summary and preview instead of the full body.',
          default: false,
        },
      },
      required: ['requestId'],
    },
  },
  {
    name: 'network_get_stats',
    description: 'Get aggregate request and response statistics grouped by method, status, and resource type.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'performance_get_metrics',
    description: 'Get performance metrics such as Web Vitals and optional timeline data.',
    inputSchema: {
      type: 'object',
      properties: {
        includeTimeline: {
          type: 'boolean',
          description: 'Include detailed timeline information.',
          default: false,
        },
      },
    },
  },
  {
    name: 'performance_start_coverage',
    description: 'Start JavaScript and CSS coverage collection.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'performance_stop_coverage',
    description: 'Stop coverage collection and return the gathered result.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'performance_take_heap_snapshot',
    description: 'Capture a heap snapshot for memory analysis.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'console_get_exceptions',
    description: 'Return captured runtime exceptions with optional URL filtering.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Substring filter applied to exception URLs.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of exceptions to return.',
          default: 50,
        },
      },
    },
  },
  {
    name: 'console_inject_script_monitor',
    description: 'Inject a dynamic script monitor that watches newly added script tags.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'console_inject_xhr_interceptor',
    description: 'Inject an XHR interceptor for AJAX request observation.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'console_inject_fetch_interceptor',
    description: 'Inject a Fetch interceptor for runtime request observation.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'console_inject_function_tracer',
    description: 'Inject a function tracer that observes calls to a specific runtime function.',
    inputSchema: {
      type: 'object',
      properties: {
        functionName: {
          type: 'string',
          description: 'Fully qualified function name, for example window.someFunction.',
        },
      },
      required: ['functionName'],
    },
  },
];
