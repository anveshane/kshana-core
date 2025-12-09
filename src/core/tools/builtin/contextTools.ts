/**
 * Context tools for storing and fetching large content by reference.
 *
 * Purpose: Prevent context drift when passing long content (narratives, chapters)
 * to child agents via dispatch tools. Instead of inline context that gets
 * summarized, agents store by reference and child agents fetch the original.
 */
import { createTool } from '../ToolRegistry.js';
import { contextStore } from '../../context/index.js';

/**
 * Store long content for reference by child agents.
 */
export const storeContextTool = createTool(
  'store_context',
  'Store long content for reference by child agents. Use this when passing large amounts of content (narratives, chapters, detailed specifications >500 chars) to dispatch tools. Returns a context_ref ID to pass to dispatch_agent/dispatch_content_agent instead of inline context.',
  {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The full content to store (narratives, chapters, user stories, etc.)',
      },
      label: {
        type: 'string',
        description: 'A descriptive label for this context (e.g., "Chapter 1 narrative", "User story input", "Character descriptions")',
      },
    },
    required: ['content', 'label'],
  },
  (args: Record<string, unknown>) => {
    const content = args['content'] as string;
    const label = args['label'] as string;

    if (!content || content.length === 0) {
      return {
        error: 'Content cannot be empty',
      };
    }

    const { id, variableName } = contextStore.store(content, label, { source: 'tool' });
    return {
      status: 'stored',
      context_ref: id,
      variable_name: variableName,
      label,
      char_count: content.length,
      message: `Context stored as ${variableName}. Pass context_ref="${id}" to dispatch tools instead of inline context to preserve the original content.`,
    };
  }
);

/**
 * Fetch stored context by reference ID.
 */
export const fetchContextTool = createTool(
  'fetch_context',
  'Fetch stored context by reference ID. Use this to retrieve full content passed from parent agent via context_ref. This ensures you receive the original, unmodified content.',
  {
    type: 'object',
    properties: {
      context_ref: {
        type: 'string',
        description: 'The context reference ID to fetch (e.g., "ctx_abc123")',
      },
    },
    required: ['context_ref'],
  },
  (args: Record<string, unknown>) => {
    const contextRef = args['context_ref'] as string;

    if (!contextRef) {
      return {
        error: 'context_ref is required',
      };
    }

    const result = contextStore.get(contextRef);
    if (!result) {
      return {
        error: `Context not found: ${contextRef}`,
        suggestion: 'The context may have been deleted or expired. Check that the context_ref is correct.',
      };
    }

    return {
      status: 'fetched',
      content: result.content,
      label: result.label,
      char_count: result.content.length,
    };
  }
);

/**
 * List all stored contexts (metadata only).
 */
export const listContextsTool = createTool(
  'list_contexts',
  'List all stored contexts with their metadata. Does not return content, only IDs, labels, and timestamps.',
  {
    type: 'object',
    properties: {},
    required: [],
  },
  () => {
    const contexts = contextStore.list();
    return {
      status: 'success',
      count: contexts.length,
      contexts: contexts.map(ctx => ({
        context_ref: ctx.id,
        variable_name: ctx.variableName,
        label: ctx.label,
        char_count: ctx.charCount,
        created_at: ctx.createdAt,
      })),
    };
  }
);

/**
 * Delete a stored context.
 */
export const deleteContextTool = createTool(
  'delete_context',
  'Delete a stored context by reference ID. Use this to clean up contexts that are no longer needed.',
  {
    type: 'object',
    properties: {
      context_ref: {
        type: 'string',
        description: 'The context reference ID to delete',
      },
    },
    required: ['context_ref'],
  },
  (args: Record<string, unknown>) => {
    const contextRef = args['context_ref'] as string;

    if (!contextRef) {
      return {
        error: 'context_ref is required',
      };
    }

    const deleted = contextStore.delete(contextRef);
    if (!deleted) {
      return {
        error: `Context not found: ${contextRef}`,
      };
    }

    return {
      status: 'deleted',
      context_ref: contextRef,
      message: `Context ${contextRef} has been deleted.`,
    };
  }
);
