/**
 * System prompts for the generic agent framework.
 * Reads prompts from JSON files in /prompts/ directory.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDefinition } from '../llm/index.js';

// Get project root (3 levels up from src/core/prompts/)
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', '..', '..', 'prompts');

/**
 * Prompt JSON schema
 */
interface PromptJson {
  name: string;
  description: string;
  version: string;
  content: string;
  metadata?: {
    sections?: string[];
    created_at?: string;
    source?: string;
  };
  extensions?: Record<string, string>;
}

/**
 * Load a prompt from JSON file.
 */
function loadPrompt(name: string): PromptJson {
  const filePath = join(PROMPTS_DIR, `${name}.json`);
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as PromptJson;
}

// Load prompts from JSON files
const basePrompt = loadPrompt('base');
const orchestratorPrompt = loadPrompt('orchestrator');
const subAgentPrompt = loadPrompt('subAgent');

// Export prompt content for backwards compatibility
export const GENERIC_AGENT_BASE_PROMPT = basePrompt.content;
export const GENERIC_AGENT_ORCHESTRATOR_SECTION = orchestratorPrompt.content;
export const GENERIC_AGENT_SUB_AGENT_SECTION = subAgentPrompt.content;

// Combined prompt for main agent (base + orchestrator)
export const GENERIC_AGENT_SYSTEM_PROMPT =
  GENERIC_AGENT_BASE_PROMPT + GENERIC_AGENT_ORCHESTRATOR_SECTION;

// Tool categories for prompt building
const COMPLEX_TOOLS = new Set(['generate_image', 'generate_video', 'edit_image']);

function isComplexTool(toolName: string): boolean {
  return COMPLEX_TOOLS.has(toolName);
}

/**
 * Build tool descriptions section for the system prompt.
 */
function buildToolDescriptions(tools: Map<string, ToolDefinition>): string {
  const lines = ['## Available Tools', ''];
  for (const [name, tool] of tools) {
    const category = isComplexTool(name) ? 'complex' : 'simple';
    lines.push(`- \`${name}\` (${category}): ${tool.description}`);
  }
  return lines.join('\n');
}

/**
 * Build the complete system message for an agent.
 *
 * @param isSubAgent - Whether this is a sub-agent
 * @param tools - Map of tool name to tool definition
 * @param customPrompt - Optional custom prompt to append (domain-specific)
 */
export function buildSystemMessage(
  isSubAgent: boolean,
  tools: Map<string, ToolDefinition>,
  customPrompt?: string
): string {
  let prompt: string;

  if (isSubAgent) {
    // Sub-agents get base + sub-agent section (no orchestrator)
    prompt = GENERIC_AGENT_BASE_PROMPT + '\n' + GENERIC_AGENT_SUB_AGENT_SECTION;
  } else {
    // Main agent gets base + orchestrator section
    prompt = GENERIC_AGENT_SYSTEM_PROMPT;
  }

  // Add tool descriptions
  prompt += '\n\n' + buildToolDescriptions(tools);

  // Add custom domain-specific prompt if provided
  if (customPrompt) {
    prompt += '\n\n' + customPrompt;
  }

  return prompt;
}

/**
 * Get prompt metadata (version, sections, etc.)
 */
export function getPromptMetadata(name: 'base' | 'orchestrator' | 'subAgent'): PromptJson {
  return loadPrompt(name);
}
