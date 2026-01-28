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

/**
 * @deprecated Use read_project() and read_file() instead
 */
export const fetchContextByLabelTool = createTool(
  'fetch_context_by_label',
  '[DEPRECATED] Search context by label. Use read_project() and read_file() instead.',
  {
    type: 'object',
    properties: {
      label_pattern: {
        type: 'string',
        description: 'Text to search for in context labels',
      },
      fetch_all: {
        type: 'boolean',
        description: 'If true, fetch all matches. Default: true',
      },
    },
    required: ['label_pattern'],
  },
  (args: Record<string, unknown>) => {
    const labelPattern = args['label_pattern'] as string;
    const fetchAll = args['fetch_all'] !== false;

    if (!labelPattern) {
      return { error: 'label_pattern is required' };
    }

    const matches = contextStore.searchByLabelWithContent(labelPattern);

    if (matches.length === 0) {
      return {
        status: 'no_matches',
        pattern: labelPattern,
        suggestion: 'Use read_project() to see available content, then read_file() to access it.',
      };
    }

    const resultsToReturn = fetchAll ? matches : [matches[0]!];

    return {
      status: 'found',
      pattern: labelPattern,
      match_count: matches.length,
      matches: resultsToReturn.map(ctx => ({
        context_ref: ctx.variableName,
        label: ctx.label,
        char_count: ctx.charCount,
        content: ctx.content,
      })),
    };
  }
);

/**
 * @deprecated Use generate_content with content_type - context is auto-injected
 */
export const getRelevantContextTool = createTool(
  'get_relevant_context',
  '[DEPRECATED] Get context for content creation. Use generate_content(content_type) instead - context is automatically injected based on content type.',
  {
    type: 'object',
    properties: {
      content_type: {
        type: 'string',
        enum: ['plot', 'story', 'character', 'setting', 'scene', 'narration'],
        description: 'The type of content you are creating',
      },
      item_name: {
        type: 'string',
        description: 'Optional: Name of the specific item being created',
      },
    },
    required: ['content_type'],
  },
  () => {
    return {
      status: 'deprecated',
      message: 'This tool is deprecated. Use generate_content(content_type) instead - the framework automatically injects the required context based on content type.',
      suggestion: 'Call generate_content(content_type: "character", name: "Daniel") and the framework will inject $original_input, $plot, $story automatically.',
    };
  }
);
