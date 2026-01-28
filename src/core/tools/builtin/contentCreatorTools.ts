/**
 * Tools available to content creator sub-agents.
 * These allow sub-agents to pull context from the project as needed.
 */
import type { ToolDefinition } from '../../llm/index.js';
import { loadProject } from '../../../tasks/video/workflow/ProjectManager.js';
import fs from 'fs';
import path from 'path';

/**
 * Read project structure tool - allows sub-agent to understand what content exists.
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
      // Return a simplified view of what content exists
      const summary: Record<string, unknown> = {
        style: project.style,
        currentPhase: project.currentPhase,
        story: project.content?.story ? { file: 'plans/story.md', exists: true } : null,
        plot: project.content?.plot ? { file: 'plans/plot.md', exists: true } : null,
        characters: Object.keys(project.characters || {}).map(name => ({
          name,
          file: `characters/${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.md`,
        })),
        settings: Object.keys(project.settings || {}).map(name => ({
          name,
          file: `settings/${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.md`,
        })),
      };
      return JSON.stringify(summary, null, 2);
    } catch (err) {
      return `Error reading project: ${String(err)}`;
    }
  },
};

/**
 * Read file tool - allows sub-agent to read specific files from the project.
 */
export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read a file from the project. Use paths from read_project output.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file relative to .kshana directory (e.g., "plans/story.md", "characters/alice.md")',
      },
    },
    required: ['path'],
  },
  handler: async (args: Record<string, unknown>) => {
    const filePath = args['path'] as string;
    if (!filePath) {
      return 'Error: path is required';
    }
    try {
      const projectDir = path.join(process.cwd(), '.kshana');
      const fullPath = path.join(projectDir, filePath);
      if (!fs.existsSync(fullPath)) {
        return `File not found: ${filePath}`;
      }
      const content = fs.readFileSync(fullPath, 'utf-8');
      return content;
    } catch (err) {
      return `Error reading file: ${String(err)}`;
    }
  },
};

/**
 * Get all content creator tools.
 */
export function getContentCreatorTools(): ToolDefinition[] {
  return [readProjectTool, readFileTool];
}
