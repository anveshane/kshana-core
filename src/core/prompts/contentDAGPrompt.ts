/**
 * Prompt builder for ContentDAGExecutor.
 *
 * Builds system + user prompts for deterministic content generation.
 * System prompt: content-dag.md + optional skill content.
 * User prompt: duration section + preloaded context + instruction.
 */
import { loadMarkdown } from './loader.js';

export interface ContentDAGPromptOptions {
  contentType: string;
  instruction: string;
  preloadedContext: string;
  durationSection?: string;
  skillContent?: string;
}

export function buildContentDAGPrompts(opts: ContentDAGPromptOptions): { system: string; user: string } {
  const basePrompt = loadMarkdown('subagents/content-dag.md');

  // System: base prompt + skill content
  const systemParts: string[] = [basePrompt];
  if (opts.skillContent) {
    systemParts.push(`\n## Content-Type Skills\n\n${opts.skillContent}`);
  }
  const system = systemParts.join('\n');

  // User: duration + context + instruction
  const userParts: string[] = [];
  if (opts.durationSection) {
    userParts.push(opts.durationSection);
  }
  userParts.push(opts.preloadedContext);
  userParts.push(`\nInstruction: ${opts.instruction}`);
  const user = userParts.join('\n\n');

  return { system, user };
}
