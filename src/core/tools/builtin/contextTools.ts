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

    const { variableName } = contextStore.store(content, label, { source: 'tool' });
    return {
      status: 'stored',
      context_ref: variableName,
      label,
      char_count: content.length,
      message: `Context stored as ${variableName}. Pass context_ref="${variableName}" to dispatch tools instead of inline context to preserve the original content.`,
    };
  }
);

/**
 * Fetch stored context by variable name.
 */
export const fetchContextTool = createTool(
  'fetch_context',
  'Fetch stored context by variable name. Use this to retrieve full content passed from parent agent via context_ref. This ensures you receive the original, unmodified content.',
  {
    type: 'object',
    properties: {
      context_ref: {
        type: 'string',
        description: 'The context variable name to fetch (e.g., "$plan", "$chapter_1")',
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
        context_ref: ctx.variableName,
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
  'Delete a stored context by variable name. Use this to clean up contexts that are no longer needed.',
  {
    type: 'object',
    properties: {
      context_ref: {
        type: 'string',
        description: 'The context variable name to delete (e.g., "$plan", "$chapter_1")',
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

/**
 * Configuration for what context is relevant to each content type.
 */
interface ContentTypeContextConfig {
  required: string[];    // Label patterns that must be present
  optional: string[];    // Label patterns that are nice to have
}

/**
 * Maps content types to relevant context patterns (matched against labels).
 * These patterns are case-insensitive and partial match against labels.
 */
const CONTENT_TYPE_CONTEXT_CONFIG: Record<string, ContentTypeContextConfig> = {
  plot: {
    required: ['original', 'input', 'story idea', 'user'],
    optional: [],
  },
  story: {
    required: ['original', 'input', 'plot'],
    optional: ['user'],
  },
  character: {
    // Priority order: look for full story/chapter content first
    required: ['full_story', 'full story', 'story', 'chapter', 'narrative'],
    optional: ['plot', 'original'],
  },
  setting: {
    // Priority order: look for full story/chapter content first
    required: ['full_story', 'full story', 'story', 'chapter', 'narrative'],
    optional: ['plot', 'original'],
  },
  scene: {
    required: ['full_story', 'story', 'chapter'],
    optional: ['character', 'setting', 'plot'],
  },
  narration: {
    required: ['story', 'scene'],
    optional: ['character', 'setting'],
  },
};

/**
 * Fetch context by searching label text.
 */
export const fetchContextByLabelTool = createTool(
  'fetch_context_by_label',
  'Search for and fetch context by label text. Use this to find context when you don\'t know the exact variable name. Returns all matching contexts.',
  {
    type: 'object',
    properties: {
      label_pattern: {
        type: 'string',
        description: 'Text to search for in context labels (case-insensitive). Examples: "story", "chapter 1", "plot"',
      },
      fetch_all: {
        type: 'boolean',
        description: 'If true, fetch all matches. If false, fetch only the first match. Default: true',
      },
    },
    required: ['label_pattern'],
  },
  (args: Record<string, unknown>) => {
    const labelPattern = args['label_pattern'] as string;
    const fetchAll = args['fetch_all'] !== false; // default to true

    if (!labelPattern) {
      return {
        error: 'label_pattern is required',
      };
    }

    const matches = contextStore.searchByLabelWithContent(labelPattern);

    if (matches.length === 0) {
      // List available contexts to help the agent
      const available = contextStore.list();
      return {
        status: 'no_matches',
        pattern: labelPattern,
        available_contexts: available.map(ctx => ({
          context_ref: ctx.variableName,
          label: ctx.label,
          char_count: ctx.charCount,
        })),
        suggestion: 'No contexts match this pattern. See available_contexts for what\'s stored.',
      };
    }

    const resultsToReturn = fetchAll ? matches : [matches[0]!];

    return {
      status: 'found',
      pattern: labelPattern,
      match_count: matches.length,
      returned_count: resultsToReturn.length,
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
 * Get relevant context for a specific content creation task.
 * Automatically determines what context is needed based on content type.
 */
export const getRelevantContextTool = createTool(
  'get_relevant_context',
  `Automatically fetch context relevant to your content creation task. Use this BEFORE generating any content to ensure you have all necessary context.

This tool knows what context each content type needs:
- character: Looks for story/chapter content to extract character details
- setting: Looks for story/chapter content to extract setting details
- scene: Looks for story, characters, and settings
- plot: Looks for original user input
- story: Looks for plot and original input
- narration: Looks for story and scenes

The tool searches by label patterns, so variable name mismatches don't matter.`,
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
        description: 'Optional: Name of the specific item being created (e.g., character name). Helps filter out irrelevant context.',
      },
    },
    required: ['content_type'],
  },
  (args: Record<string, unknown>) => {
    const contentType = args['content_type'] as string;
    const itemName = args['item_name'] as string | undefined;

    if (!contentType) {
      return {
        error: 'content_type is required',
      };
    }

    const config = CONTENT_TYPE_CONTEXT_CONFIG[contentType];
    if (!config) {
      return {
        error: `Unknown content_type: ${contentType}`,
        valid_types: Object.keys(CONTENT_TYPE_CONTEXT_CONFIG),
      };
    }

    // Collect all available contexts
    const allContexts = contextStore.list();
    if (allContexts.length === 0) {
      return {
        status: 'no_context_available',
        content_type: contentType,
        message: 'No context has been stored yet. The parent agent should store context before dispatching content creation.',
      };
    }

    // Find matching contexts using label patterns
    const foundContexts: Array<{
      variableName: string;
      label: string;
      charCount: number;
      content: string;
      isRequired: boolean;
    }> = [];
    const matchedPatterns: string[] = [];
    const missingRequired: string[] = [];

    // Search for required contexts
    for (const pattern of config.required) {
      const matches = contextStore.searchByLabelWithContent(pattern);
      if (matches.length > 0) {
        matchedPatterns.push(pattern);
        for (const match of matches) {
          // Avoid duplicates
          if (!foundContexts.some(c => c.variableName === match.variableName)) {
            foundContexts.push({
              variableName: match.variableName,
              label: match.label,
              charCount: match.charCount,
              content: match.content,
              isRequired: true,
            });
          }
        }
      } else {
        missingRequired.push(pattern);
      }
    }

    // Search for optional contexts
    for (const pattern of config.optional) {
      const matches = contextStore.searchByLabelWithContent(pattern);
      for (const match of matches) {
        // Avoid duplicates
        if (!foundContexts.some(c => c.variableName === match.variableName)) {
          foundContexts.push({
            variableName: match.variableName,
            label: match.label,
            charCount: match.charCount,
            content: match.content,
            isRequired: false,
          });
        }
      }
    }

    // Build recommendation message
    let recommendation = '';
    if (foundContexts.length === 0) {
      recommendation = `No relevant context found for ${contentType} creation. Available contexts: ${allContexts.map(c => `${c.variableName} (${c.label})`).join(', ')}`;
    } else {
      const requiredFound = foundContexts.filter(c => c.isRequired);
      const optionalFound = foundContexts.filter(c => !c.isRequired);
      recommendation = `Found ${requiredFound.length} required and ${optionalFound.length} optional contexts for ${contentType} creation.`;
      if (missingRequired.length > 0) {
        recommendation += ` Warning: Could not find contexts matching these required patterns: ${missingRequired.join(', ')}.`;
      }
      if (itemName) {
        recommendation += ` Creating: ${itemName}.`;
      }
    }

    return {
      status: foundContexts.length > 0 ? 'found' : 'no_relevant_context',
      content_type: contentType,
      item_name: itemName,
      context_count: foundContexts.length,
      total_chars: foundContexts.reduce((sum, c) => sum + c.charCount, 0),
      recommendation,
      contexts: foundContexts.map(ctx => ({
        context_ref: ctx.variableName,
        label: ctx.label,
        char_count: ctx.charCount,
        is_required: ctx.isRequired,
        content: ctx.content,
      })),
      // Also list all available contexts for transparency
      all_available: allContexts.map(ctx => ({
        context_ref: ctx.variableName,
        label: ctx.label,
        char_count: ctx.charCount,
      })),
    };
  }
);
