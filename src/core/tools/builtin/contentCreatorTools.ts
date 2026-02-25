/**
 * Canonical read_file and read_project tool definitions.
 *
 * These are the SINGLE source of truth for file/project reading tools.
 * Used by: orchestrator (via registries), content creator sub-agents, context-gathering.
 * Do NOT define read_file or read_project anywhere else.
 */
import type { ToolDefinition } from '../../llm/index.js';
import { loadProject } from '../../../tasks/video/workflow/ProjectManager.js';
import fs from 'fs';
import path from 'path';

/**
 * Read project structure tool - understand what content exists.
 */
export const readProjectTool: ToolDefinition = {
  name: 'read_project',
  description: 'Read the project structure to understand what content exists (story, characters, settings, etc.)',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  handler: async () => {
    try {
      const project = loadProject();
      if (!project) {
        return 'No project found. The project has not been initialized yet.';
      }
      const summary: Record<string, unknown> = {
        style: project.style,
        currentPhase: project.currentPhase,
        story: project.content?.story ? { file: 'plans/story.md', exists: true } : null,
        plot: project.content?.plot ? { file: 'plans/plot.md', exists: true } : null,
        characters: (project.characters || []).map((char: { name: string }) => ({
          name: char.name,
          file: project.content?.characters?.itemFiles?.[char.name] ||
            `characters/${char.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.profile.md`,
        })),
        settings: (project.settings || []).map((setting: { name: string }) => ({
          name: setting.name,
          file: project.content?.settings?.itemFiles?.[setting.name] ||
            `settings/${setting.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.profile.md`,
        })),
        files: project.files || [],
      };
      return JSON.stringify(summary, null, 2);
    } catch (err) {
      return `Error reading project: ${String(err)}`;
    }
  },
};

/**
 * Normalize all quote-like characters to ASCII double quote for comparison.
 */
function normalizeQuotes(s: string): string {
  return s.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036\u00AB\u00BB"]/g, '"');
}

/**
 * Try multiple path variants to find a file that exists.
 * Handles shell escapes, smart quote ↔ ASCII quote differences,
 * and fuzzy directory segment matching.
 */
export function tryPathVariants(filePath: string): string | null {
  const toFull = (p: string) =>
    path.isAbsolute(p) ? p : path.join(process.cwd(), '.kshana', p);

  // 1. Try as-is
  const fullPath = toFull(filePath);
  if (fs.existsSync(fullPath)) return fullPath;

  // 2. Try cleaning terminal shell escapes (e.g., \, → , and \ → space)
  const cleaned = filePath.replace(/\\(.)/g, '$1');
  const cleanedFull = toFull(cleaned);
  if (cleanedFull !== fullPath && fs.existsSync(cleanedFull)) return cleanedFull;

  // 3. Try replacing ASCII quotes with Unicode smart quotes (paired left/right).
  //    macOS filenames from web downloads often use smart quotes (" ") but
  //    terminals and JSON produce ASCII quotes (").
  let isLeft = true;
  const smartQuoteVariant = cleaned.replace(/"/g, () => {
    const q = isLeft ? '\u201C' : '\u201D';
    isLeft = !isLeft;
    return q;
  });
  const smartFull = toFull(smartQuoteVariant);
  if (smartFull !== cleanedFull && fs.existsSync(smartFull)) return smartFull;

  // 4. Try the reverse: smart quotes → ASCII
  const asciiQuoteVariant = cleaned.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
  const asciiFull = toFull(asciiQuoteVariant);
  if (asciiFull !== cleanedFull && fs.existsSync(asciiFull)) return asciiFull;

  // 5. Fuzzy segment-by-segment resolution: walk path segments, matching each
  //    against actual directory entries with normalized quotes.
  //    This handles cases where both directory AND file names have smart quotes.
  const resolved = resolvePathFuzzy(cleanedFull);
  if (resolved) return resolved;

  return null;
}

/**
 * Resolve a path segment-by-segment, fuzzy-matching each component
 * against actual directory entries (normalizing quotes for comparison).
 */
function resolvePathFuzzy(fullPath: string): string | null {
  const segments = fullPath.split(path.sep);
  let current: string = path.sep; // start from root

  for (const segment of segments) {
    if (!segment) continue; // skip empty segments from leading /

    const exact = path.join(current, segment);
    if (fs.existsSync(exact)) {
      current = exact;
      continue;
    }

    // Fuzzy match: list parent and find a segment with matching normalized quotes
    try {
      if (!fs.existsSync(current)) return null;
      const entries = fs.readdirSync(current);
      const normalizedSegment = normalizeQuotes(segment);
      const match = entries.find(e => normalizeQuotes(e) === normalizedSegment);
      if (match) {
        current = path.join(current, match);
      } else {
        return null; // No match found for this segment
      }
    } catch {
      return null;
    }
  }

  return fs.existsSync(current) ? current : null;
}

/**
 * Read file tool - reads from project directory or any absolute path.
 *
 * This is the SINGLE read_file tool for the entire system.
 */
export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: `Read a file from the project or from an absolute path on the filesystem.

For project files: use relative paths like "characters/alice.md" (resolved under .kshana/).
For external files: use absolute paths like "/Users/alice/Documents/story.txt".

**IMPORTANT for project files**: ALWAYS call read_project or list_project_files FIRST to get actual file names.
NEVER guess file names like "0.md", "1.md" - files are named by content (e.g., "characters/alice.md").

If this returns "File not found", call read_project or list_project_files to see what files actually exist.`,
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'File path. Absolute paths (starting with /) read from the filesystem directly. Relative paths read from the .kshana project directory.',
      },
    },
    required: ['file_path'],
  },
  handler: async (args: Record<string, unknown>) => {
    // Accept both 'file_path' and 'path' for backward compatibility
    const filePath = (args['file_path'] ?? args['path']) as string;
    if (!filePath) {
      return { status: 'error', error: 'path is required' };
    }

    // For relative paths: reject numeric index guessing (common LLM mistake)
    if (!path.isAbsolute(filePath)) {
      // Security: prevent path traversal
      if (filePath.includes('..')) {
        return {
          status: 'error',
          error: 'Invalid file path. Use relative paths within .kshana directory or absolute paths for external files.',
        };
      }

      const numericIndexPattern = /^(characters|settings|scenes)\/\d+\.md$/;
      if (numericIndexPattern.test(filePath)) {
        return {
          status: 'error',
          error: `FORBIDDEN: You used a numeric index "${filePath}".`,
          instruction: 'You MUST call list_project_files FIRST to discover actual file names.',
        };
      }

      const bareNumericPattern = /^\d+\.md$/;
      if (bareNumericPattern.test(filePath)) {
        return {
          status: 'error',
          error: `FORBIDDEN: You used "${filePath}" - this is NOT a valid file path.`,
          instruction: 'You MUST call list_project_files to get actual file names. Files are named by content, not by index.',
        };
      }
    }

    try {
      const resolvedPath = tryPathVariants(filePath);

      if (!resolvedPath) {
        return {
          status: 'error',
          error: `File not found: ${filePath}`,
          hint: 'Use list_project_files to see available files and their exact paths.',
        };
      }

      const content = fs.readFileSync(resolvedPath, 'utf-8');
      return {
        status: 'success',
        file_path: filePath,
        content,
        length: content.length,
      };
    } catch (err) {
      return { status: 'error', error: `Error reading file: ${String(err)}` };
    }
  },
};

/**
 * Get all content creator tools (read_project + read_file).
 */
export function getContentCreatorTools(): ToolDefinition[] {
  return [readProjectTool, readFileTool];
}
