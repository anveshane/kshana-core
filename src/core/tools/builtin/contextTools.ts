/**
 * Context tools - DEPRECATED
 *
 * These tools are deprecated. The framework now automatically injects context
 * based on content_type when using generate_content. Subagents can use
 * read_project() and read_file() for context discovery instead.
 *
 * Kept for backward compatibility during migration.
 */
import { createTool } from '../ToolRegistry.js';
import { contextStore } from '../../context/index.js';

/**
 * @deprecated Use generate_content with content_type instead - context is auto-injected
 */
export const storeContextTool = createTool(
  'store_context',
  '[DEPRECATED - Framework handles context automatically] Store content for reference. Consider using generate_content instead which auto-injects context.',
  {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The content to store',
      },
      label: {
        type: 'string',
        description: 'A descriptive label for this context',
      },
    },
    required: ['content', 'label'],
  },
  (args: Record<string, unknown>) => {
    const content = args['content'] as string;
    const label = args['label'] as string;

    if (!content || content.length === 0) {
      return { error: 'Content cannot be empty' };
    }

    const { variableName } = contextStore.store(content, label, { source: 'tool' });
    return {
      status: 'stored',
      context_ref: variableName,
      label,
      char_count: content.length,
      deprecation_notice: 'This tool is deprecated. Use generate_content with content_type instead - context is automatically injected.',
    };
  }
);

/**
 * @deprecated Use read_project() and read_file() for context discovery
 */
export const fetchContextTool = createTool(
  'fetch_context',
  '[DEPRECATED] Fetch stored context. Consider using read_project() and read_file() instead.',
  {
    type: 'object',
    properties: {
      context_ref: {
        type: 'string',
        description: 'The context variable name to fetch',
      },
    },
    required: ['context_ref'],
  },
  (args: Record<string, unknown>) => {
    const contextRef = args['context_ref'] as string;

    if (!contextRef) {
      return { error: 'context_ref is required' };
    }

    const result = contextStore.get(contextRef);
    if (!result) {
      return {
        error: `Context not found: ${contextRef}`,
        suggestion: 'Use read_project() to see available content, then read_file() to access it.',
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
 * @deprecated Use read_project() to see project state
 */
export const listContextsTool = createTool(
  'list_contexts',
  '[DEPRECATED] List stored contexts. Use read_project() instead to see project content.',
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
        context_ref: ctx.variableName,
        label: ctx.label,
        char_count: ctx.charCount,
        created_at: ctx.createdAt,
      })),
      deprecation_notice: 'This tool is deprecated. Use read_project() to see project content.',
    };
  }
);

/**
 * @deprecated No longer needed - framework manages context lifecycle
 */
export const deleteContextTool = createTool(
  'delete_context',
  '[DEPRECATED] Delete stored context. Framework manages context lifecycle automatically.',
  {
    type: 'object',
    properties: {
      context_ref: {
        type: 'string',
        description: 'The context variable name to delete',
      },
    },
    required: ['context_ref'],
  },
  (args: Record<string, unknown>) => {
    const contextRef = args['context_ref'] as string;

    if (!contextRef) {
      return { error: 'context_ref is required' };
    }

    const deleted = contextStore.delete(contextRef);
    if (!deleted) {
      return { error: `Context not found: ${contextRef}` };
    }

    return {
      status: 'deleted',
      context_ref: contextRef,
    };
  }
);

