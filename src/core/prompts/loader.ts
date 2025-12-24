/**
 * Markdown prompt loader with lightweight templating.
 *
 * Template syntax (subset, Claude-SDK style):
 * - {{var}}: string interpolation
 * - {{#if var}} ... {{/if}}: conditional block
 * - {{#each list}} ... {{/each}}: loop over array of objects
 *
 * Notes:
 * - This intentionally avoids bringing in external deps (no runtime install).
 * - Designed for system prompt and tool description composition from separate .md files.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', '..', '..', 'prompts');

const templateCache = new Map<string, string>();

export type PromptContext = Record<string, unknown>;

export function loadMarkdown(relativePathFromPromptsDir: string): string {
  const filePath = join(PROMPTS_DIR, relativePathFromPromptsDir);
  if (!existsSync(filePath)) {
    throw new Error(`Prompt file not found: ${filePath}`);
  }
  const cached = templateCache.get(filePath);
  if (cached !== undefined) return cached;
  const content = readFileSync(filePath, 'utf-8');
  templateCache.set(filePath, content);
  return content;
}

function getPathValue(context: PromptContext, path: string): unknown {
  // Support dotted paths: a.b.c
  const parts = path.split('.').map(p => p.trim()).filter(Boolean);
  let cur: unknown = context;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function renderInterpolations(template: string, context: PromptContext): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key) => {
    const v = getPathValue(context, String(key));
    if (v === undefined || v === null) return '';
    return String(v);
  });
}

function renderIfBlocks(template: string, context: PromptContext): string {
  return template.replace(/\{\{#if\s+([a-zA-Z0-9_.-]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, key, body) => {
    const v = getPathValue(context, String(key));
    return v ? String(body) : '';
  });
}

function renderEachBlocks(template: string, context: PromptContext): string {
  return template.replace(/\{\{#each\s+([a-zA-Z0-9_.-]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g, (_m, key, body) => {
    const v = getPathValue(context, String(key));
    if (!Array.isArray(v)) return '';
    return v
      .map(item => {
        const itemCtx: PromptContext =
          item && typeof item === 'object'
            ? { ...context, ...(item as Record<string, unknown>) }
            : { ...context, this: item };
        // Allow nested substitutions inside loop body
        return renderTemplate(String(body), itemCtx);
      })
      .join('');
  });
}

export function renderTemplate(template: string, context: PromptContext): string {
  // Order matters: render blocks first, then interpolations
  let out = template;
  out = renderEachBlocks(out, context);
  out = renderIfBlocks(out, context);
  out = renderInterpolations(out, context);
  return out;
}

export function loadAndRenderMarkdown(relativePathFromPromptsDir: string, context: PromptContext): string {
  const template = loadMarkdown(relativePathFromPromptsDir);
  return renderTemplate(template, context);
}

export function clearPromptTemplateCache(): void {
  templateCache.clear();
}


