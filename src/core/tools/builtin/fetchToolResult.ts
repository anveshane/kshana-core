/**
 * fetch_tool_result tool - Retrieve full details of a stored tool result.
 */

import { createTool } from '../ToolRegistry.js';
import { toolResultStore } from '../../context/index.js';

export const fetchToolResultTool = createTool(
  'fetch_tool_result',
  'Retrieve the full output of a previously executed tool call using its reference ID (e.g., "$tool_result_12"). Use this when a tool result summary is insufficient.',
  {
    type: 'object',
    properties: {
      ref_id: {
        type: 'string',
        description: 'Reference ID for the stored tool result, e.g. "$tool_result_1"',
      },
    },
    required: ['ref_id'],
  },
  (args: Record<string, unknown>) => {
    const refId = args['ref_id'] as string | undefined;
    if (!refId) {
      return { error: 'ref_id is required' };
    }

    const stored = toolResultStore.get(refId);
    if (!stored) {
      return {
        error: `Tool result not found: ${refId}`,
        suggestion: 'The reference may be incorrect or expired (cleanup).',
      };
    }

    // Best-effort parse back to JSON.
    let parsed: unknown = stored.result;
    try {
      parsed = JSON.parse(stored.result);
    } catch {
      // Keep raw string
    }

    return {
      ref_id: stored.refId,
      tool_name: stored.toolName,
      summary: stored.summary,
      result: parsed,
      char_count: stored.charCount,
      created_at: stored.createdAt,
    };
  }
);
