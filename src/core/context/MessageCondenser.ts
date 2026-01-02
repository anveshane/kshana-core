/**
 * Message condenser - automatically stores long content and replaces with references.
 *
 * Purpose: Keep message history manageable by replacing long content (>500 chars)
 * with context variable references. The original content is stored and can be
 * fetched when needed.
 */
import { contextStore } from './ContextStore.js';

/**
 * Threshold for considering content "long" and worth storing.
 */
export const LONG_CONTENT_THRESHOLD = 20000;

/**
 * Result of condensing content.
 */
export interface CondenseResult {
  condensed: string;       // The condensed text (with reference)
  wasCondensed: boolean;   // Whether condensing occurred
  variableName?: string;   // The variable name if stored (e.g., "$plan")
}

/**
 * Condense long content by storing it and returning a reference.
 *
 * @param content - The content to potentially condense
 * @param label - Label describing the content
 * @param options - Additional options
 * @returns Condensed result with reference or original content
 */
export function condenseContent(
  content: string,
  label: string,
  options: {
    source?: 'user_input' | 'tool' | 'manual';
    variableBaseName?: string;
    threshold?: number;
  } = {}
): CondenseResult {
  const threshold = options.threshold ?? LONG_CONTENT_THRESHOLD;

  if (content.length <= threshold) {
    return {
      condensed: content,
      wasCondensed: false,
    };
  }

  // Store the content
  const { variableName } = contextStore.store(content, label, {
    source: options.source ?? 'user_input',
    variableBaseName: options.variableBaseName ?? label,
  });

  // Create a condensed reference with clear instructions
  const preview = content.slice(0, 150).replace(/\n/g, ' ').trim();
  const condensed = `[STORED CONTENT: ${variableName}]
Length: ${content.length} chars

Preview: "${preview}..."

IMPORTANT: When dispatching sub-agents, include this in context_refs array.
Example: dispatch_content_agent(task="...", content_type="...", context_refs=["${variableName}", ...])`;

  return {
    condensed,
    wasCondensed: true,
    variableName,
  };
}

/**
 * Condense user input specifically.
 * Generates a descriptive variable name based on content analysis.
 */
export function condenseUserInput(content: string): CondenseResult {
  const label = generateContentLabel(content);
  const variableBaseName = generateVariableBaseName(content);

  return condenseContent(content, label, {
    source: 'user_input',
    variableBaseName,
  });
}

/**
 * Generate a descriptive variable base name from content.
 * Analyzes the content to create a meaningful identifier.
 */
export function generateVariableBaseName(content: string): string {
  const firstLine = content.split('\n')[0]?.trim().toLowerCase() ?? '';
  const contentLower = content.toLowerCase();

  // Check for chapter references
  const chapterMatch = firstLine.match(/chapter\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i);
  if (chapterMatch) {
    const num = chapterMatch[1];
    const numStr = isNaN(Number(num)) ? wordToNum(num as string) : num;
    return `chapter_${numStr}`;
  }

  // Check for scene references
  const sceneMatch = firstLine.match(/scene\s*(\d+|one|two|three|four|five)/i);
  if (sceneMatch) {
    const num = sceneMatch[1];
    const numStr = isNaN(Number(num)) ? wordToNum(num as string) : num;
    return `scene_${numStr}`;
  }

  // Check for act references
  const actMatch = firstLine.match(/act\s*(\d+|one|two|three|i{1,3})/i);
  if (actMatch) {
    return `act_${actMatch[1]}`;
  }

  // Check for story-related content
  if (contentLower.includes('once upon a time') || contentLower.includes('long ago')) {
    return 'story';
  }

  // Check for character descriptions
  if (firstLine.includes('character') || contentLower.slice(0, 200).includes('protagonist')) {
    return 'character_desc';
  }

  // Check for setting/location descriptions
  if (contentLower.slice(0, 200).includes('village') || contentLower.slice(0, 200).includes('town') ||
    contentLower.slice(0, 200).includes('city') || contentLower.slice(0, 200).includes('forest')) {
    // Try to extract location name
    const villageMatch = content.match(/(?:village|town|city)\s+(?:of\s+)?(\w+)/i);
    if (villageMatch?.[1]) {
      return `setting_${villageMatch[1].toLowerCase()}`;
    }
    return 'setting';
  }

  // Check for plot/outline
  if (firstLine.includes('plot') || firstLine.includes('outline') || firstLine.includes('synopsis')) {
    return 'plot';
  }

  // Extract a key noun from the first line as fallback
  const words = firstLine.replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 3);
  if (words.length > 0) {
    // Skip common words
    const skipWords = ['this', 'that', 'with', 'from', 'have', 'been', 'were', 'they', 'their', 'about', 'would', 'could', 'should', 'morning', 'evening'];
    const meaningfulWord = words.find(w => !skipWords.includes(w));
    if (meaningfulWord) {
      return meaningfulWord;
    }
  }

  // Default fallback
  return 'content';
}

/**
 * Convert word numbers to digits.
 */
function wordToNum(word: string): string {
  const words: Record<string, string> = {
    'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5',
    'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'ten': '10',
    'i': '1', 'ii': '2', 'iii': '3',
  };
  return words[word.toLowerCase()] ?? word;
}

/**
 * Generate a descriptive label based on content analysis.
 * Creates a human-readable label with content preview for context.
 * Used in system prompt to help agent understand what each stored context contains.
 */
export function generateContentLabel(content: string): string {
  const firstLine = content.split('\n')[0]?.trim() ?? '';
  const preview = firstLine.slice(0, 60);

  // Check for common patterns and add descriptive prefix
  if (/^chapter\s*\d/i.test(firstLine)) {
    return `Chapter: "${preview}${preview.length < firstLine.length ? '...' : ''}"`;
  }
  if (/^scene\s*\d/i.test(firstLine)) {
    return `Scene: "${preview}${preview.length < firstLine.length ? '...' : ''}"`;
  }
  if (/^act\s*(\d|i{1,3})/i.test(firstLine)) {
    return `Act: "${preview}${preview.length < firstLine.length ? '...' : ''}"`;
  }
  if (content.toLowerCase().slice(0, 200).includes('once upon a time')) {
    return `Story narrative: "${preview}${preview.length < firstLine.length ? '...' : ''}"`;
  }
  if (firstLine.toLowerCase().includes('character')) {
    return `Character description: "${preview}${preview.length < firstLine.length ? '...' : ''}"`;
  }
  if (content.toLowerCase().slice(0, 200).includes('protagonist')) {
    return `Character content: "${preview}${preview.length < firstLine.length ? '...' : ''}"`;
  }

  // Default: use quoted preview for context
  if (preview.length > 5) {
    return `"${preview}${preview.length < firstLine.length ? '...' : ''}"`;
  }

  return 'User-provided content';
}

/**
 * Check if content should be condensed based on length.
 */
export function shouldCondense(content: string, threshold: number = LONG_CONTENT_THRESHOLD): boolean {
  return content.length > threshold;
}

/**
 * Generate a variable-style project title from content.
 * Extracts meaningful words from the first line, removes common prefixes,
 * and joins with underscores.
 *
 * Examples:
 * - "Chapter 1: Shocking Discoveries" → "shocking_discoveries"
 * - "The Adventures of Tom" → "adventures_tom"
 * - "Once upon a time in a village" → "once_upon_time_village"
 */
export function generateProjectTitle(content: string): string {
  const firstLine = content.split('\n')[0]?.trim() ?? '';

  // Remove common prefixes like "Chapter 1:", "Scene 2:", etc.
  let title = firstLine
    .replace(/^(chapter|scene|act)\s*\d*:?\s*/i, '')
    .trim();

  // Remove leading "The " for cleaner titles
  title = title.replace(/^the\s+/i, '');

  // Extract meaningful words (3+ chars, not common stop words)
  const stopWords = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
    'her', 'was', 'one', 'our', 'out', 'has', 'his', 'how', 'its', 'may',
    'who', 'did', 'get', 'now', 'old', 'see', 'way', 'new', 'been', 'more',
    'when', 'will', 'with', 'from', 'this', 'that', 'they', 'have', 'been',
    'were', 'said', 'each', 'than', 'them', 'then', 'into', 'some', 'very',
  ]);

  const words = title
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 4); // Take first 4 meaningful words

  if (words.length === 0) {
    return 'untitled_project';
  }

  return words.join('_');
}
