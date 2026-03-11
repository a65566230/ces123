import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const cacheTools: Tool[] = [
  {
    name: 'get_cache_stats',
    description: `Return global cache statistics across all registered cache layers.

The payload includes:
- totalEntries
- totalSize
- totalSizeMB
- hitRate
- per-cache stats
- recommendations`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'smart_cache_cleanup',
    description: `Run coordinated cache cleanup across registered caches.

Cleanup order:
1. Remove expired data
2. Clean low-hit-rate caches
3. Clean the largest remaining caches if needed

Use targetSize to override the default cleanup goal.`,
    inputSchema: {
      type: 'object',
      properties: {
        targetSize: {
          type: 'number',
          description: 'Target cache size in bytes after cleanup.',
        },
      },
    },
  },
  {
    name: 'clear_all_caches',
    description: `Clear all registered caches and reset their in-memory state.

Warning:
- This is destructive.
- Prefer smart_cache_cleanup first when possible.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];
