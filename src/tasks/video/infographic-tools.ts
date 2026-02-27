/**
 * Infographic generation tools for animated overlay graphics.
 * Uses Remotion to generate WebM (VP9 + alpha) infographic clips.
 *
 * Extracted from the monolithic tools.ts to keep concerns separated.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { nanoid } from 'nanoid';
import { createTool } from '../../core/tools/index.js';
import type { ToolDefinition } from '../../core/llm/index.js';
import { LLMClient, getLLMConfig } from '../../core/llm/index.js';
import { loadRemotionSkillsForInfographicType } from '../../core/prompts/loader.js';
import { getPhaseLogger } from '../../utils/phaseLogger.js';
import { RemotionRenderer } from '../../services/remotion/index.js';
import {
  parseInfographicPlacements,
  type ParsedInfographicPlacement,
} from './workflow/infographicPlacementsParser.js';
import {
  expandInfographicPlacementPrompt,
  type ExpandInfographicContext,
} from './workflow/infographicPromptExpander.js';
import { runRemotionAgent, type ComponentCodeItem } from './remotionAgent.js';
import { PROJECT_DIR } from './workflow/index.js';

const logger = getPhaseLogger();

// =============================================================================
// Code Sanitization Utilities
// =============================================================================

/**
 * Sanitize LLM-generated component code.
 * Fixes common issues: SVG refs, easing names, mismatched quotes.
 */
export function sanitizeGeneratedComponentCode(componentCode: string): string {
  const defsSectionPattern = /<defs[\s\S]*?<\/defs>/g;
  const idPattern = /\bid=["']([A-Za-z_][\w:-]*)["']/g;
  const svgIds = new Set<string>();

  for (const defsSection of componentCode.match(defsSectionPattern) ?? []) {
    let idMatch: RegExpExecArray | null;
    while ((idMatch = idPattern.exec(defsSection)) !== null) {
      if (idMatch[1]) svgIds.add(idMatch[1]);
    }
  }

  let sanitized = componentCode;

  if (svgIds.size > 0) {
    const attrPattern = /\b(fill|stroke|filter|clipPath|mask)=\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
    sanitized = sanitized.replace(attrPattern, (_m, attr: string, refName: string) => {
      if (!svgIds.has(refName)) return `${attr}={${refName}}`;
      return `${attr}="url(#${refName})"`;
    });
  }

  // Guard against unsupported easing names
  sanitized = sanitized
    .replace(/\bEasing\.quart\b/g, 'Easing.quad')
    .replace(/\bEasing\.quint\b/g, 'Easing.quad');

  // Fix mismatched quotes in JSX/TSX attributes
  sanitized = sanitized.replace(
    /(\w+)=(["'])([^"']*?)(['"])/g,
    (match, attr, openQuote, value, closeQuote) => {
      if (openQuote !== closeQuote) {
        logger.warn('remotion', 'sanitize', `Fixed mismatched quotes: ${attr}=${openQuote}...${openQuote}`);
        return `${attr}=${openQuote}${value}${openQuote}`;
      }
      return match;
    }
  );

  // Warn on CSS animation pitfalls
  if (/(animation\s*:|transition\s*:|@keyframes)/i.test(sanitized)) {
    logger.warn('remotion', 'sanitize', 'CSS animations/transitions detected in component code');
  }

  return sanitized;
}

/**
 * Validate basic syntax of generated component code before writing to file.
 */
export function validateComponentSyntax(code: string): { valid: boolean; error?: string } {
  const issues: string[] = [];

  const openTags = (code.match(/<\w+[^/>]*>/g) ?? []).filter(tag => !tag.endsWith('/>')).length;
  const closeTags = (code.match(/<\/\w+>/g) ?? []).length;

  const tagDifference = Math.abs(openTags - closeTags);
  if (tagDifference > 2) {
    issues.push(`Potential tag mismatch: ${openTags} opening tags, ${closeTags} closing tags`);
  }

  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) {
      continue;
    }
    const doubleQuotes = (line.match(/(?<!\\)"/g) ?? []).length;
    const singleQuotes = (line.match(/(?<!\\)'/g) ?? []).length;
    if (doubleQuotes % 2 !== 0 && !line.includes('`')) {
      issues.push(`Line ${i + 1}: Unmatched double quotes`);
    }
    if (singleQuotes % 2 !== 0 && !line.includes('`')) {
      issues.push(`Line ${i + 1}: Unmatched single quotes`);
    }
  }

  return issues.length > 0
    ? { valid: false, error: issues.join('; ') }
    : { valid: true };
}

// =============================================================================
// Generate All Infographics Tool
// =============================================================================

/**
 * Create the generate_all_infographics tool.
 * Orchestrates the full pipeline: parse → expand → generate → sanitize → render.
 */
export function createGenerateAllInfographicsTool(sessionId?: string): ToolDefinition {
  return createTool(
    'generate_all_infographics',
    `Generate animated infographic overlays for all placements defined in infographic-placements.md.

Pipeline:
1. Parse infographic-placements.md for placement definitions
2. Optionally expand prompts with LLM for richer Remotion instructions
3. Load type-specific Remotion skills per placement
4. Generate TSX component code via Remotion sub-agent
5. Sanitize and validate generated code
6. Submit to Remotion renderer service → returns job ID

Use wait_for_job with the returned job ID to check completion.

ONLY available in documentary template projects.`,
    {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to infographic-placements.md (default: plans/infographic-placements.md)',
        },
        expand_prompts: {
          type: 'boolean',
          description: 'Whether to expand prompts via LLM (default: true)',
        },
      },
      required: [],
    },
    async (args) => {
      const filePath = (args['file_path'] as string) || 'plans/infographic-placements.md';
      const expandPrompts = args['expand_prompts'] !== false;
      const effectiveSessionId = sessionId || `cli-${nanoid(6)}`;

      // 1. Read and parse placements
      const fullPath = path.join(process.cwd(), PROJECT_DIR, filePath);
      if (!fs.existsSync(fullPath)) {
        return {
          status: 'error',
          error: `Infographic placements file not found: ${fullPath}`,
          suggestion: 'Create the infographic-placements.md file first using the infographic_placement artifact type.',
        };
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const placements = parseInfographicPlacements(content);
      if (placements.length === 0) {
        return {
          status: 'error',
          error: 'No valid placements found in infographic-placements.md',
          suggestion: 'Ensure the file contains lines matching: "- Placement N: startTime-endTime | type=... | prompt"',
        };
      }

      logger.info('remotion', 'generate', `Parsed ${placements.length} infographic placement(s)`);

      // 2. Optionally expand prompts
      let expandedPlacements = placements;
      if (expandPrompts) {
        expandedPlacements = await expandAllPrompts(placements);
      }

      // 3. Generate component code per placement
      const llmConfig = getLLMConfig();
      const llm = new LLMClient(llmConfig);
      const componentCodes = new Map<number, string>();
      const errors: Array<{ placementNumber: number; error: string }> = [];

      for (const placement of expandedPlacements) {
        try {
          // Load skills for this type
          const skillSelection = loadRemotionSkillsForInfographicType(
            placement.infographicType,
            placement.prompt,
          );
          logger.info('remotion', 'skills', `Placement ${placement.placementNumber}: loaded ${skillSelection.selectedRules.length} rules, ${skillSelection.selectedExamples.length} examples`);

          // Generate component via sub-agent
          const result = await runRemotionAgent(llm, [placement], {
            skillsContent: skillSelection.content,
          });

          const item = result.placements[0];
          if (!item) {
            throw new Error('No component code returned');
          }

          // Sanitize and validate
          const sanitizedCode = sanitizeGeneratedComponentCode(item.componentCode);
          const validation = validateComponentSyntax(sanitizedCode);
          if (!validation.valid) {
            logger.warn('remotion', 'validate', `Placement ${placement.placementNumber} syntax issues: ${validation.error}`);
          }

          componentCodes.set(placement.placementNumber, sanitizedCode);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('remotion', 'generate', `Failed to generate placement ${placement.placementNumber}: ${msg}`);
          errors.push({ placementNumber: placement.placementNumber, error: msg });
        }
      }

      if (componentCodes.size === 0) {
        return {
          status: 'error',
          error: 'All placements failed to generate',
          errors,
        };
      }

      // 4. Check Remotion project setup
      const remotionDir = path.resolve(process.cwd(), 'remotion-infographics');
      if (!fs.existsSync(path.join(remotionDir, 'package.json'))) {
        return {
          status: 'error',
          error: 'remotion-infographics/package.json not found. The Remotion project must be set up first.',
        };
      }

      // 5. Submit to renderer
      const outputDir = path.join(process.cwd(), PROJECT_DIR, 'assets', 'infographics');
      fs.mkdirSync(outputDir, { recursive: true });

      const renderer = RemotionRenderer.getInstance();
      const jobId = await renderer.render({
        sessionId: effectiveSessionId,
        placements: expandedPlacements.filter((p) => componentCodes.has(p.placementNumber)),
        componentCodes,
        outputDir,
      });

      logger.info('remotion', 'submit', `Render job submitted: ${jobId}`, {
        totalPlacements: placements.length,
        generatedComponents: componentCodes.size,
        failedGenerations: errors.length,
      });

      return {
        status: 'submitted',
        job_id: jobId,
        total_placements: placements.length,
        generated_components: componentCodes.size,
        failed_generations: errors.length,
        errors: errors.length > 0 ? errors : undefined,
        message: `Infographic render job submitted. Use wait_for_job("${jobId}") to check status.`,
      };
    }
  );
}

/**
 * Expand prompts for all placements using LLM.
 */
async function expandAllPrompts(
  placements: ParsedInfographicPlacement[],
): Promise<ParsedInfographicPlacement[]> {
  const expanded: ParsedInfographicPlacement[] = [];

  for (const placement of placements) {
    const ctx: ExpandInfographicContext = {
      transcriptSegment: '',
      contentPlan: '',
    };

    const result = await expandInfographicPlacementPrompt(placement, ctx);
    if (result && 'prompt' in result) {
      logger.info('remotion', 'expand', `Placement ${placement.placementNumber} prompt expanded`, {
        originalLength: placement.prompt.length,
        expandedLength: result.prompt.length,
      });
      expanded.push({
        ...placement,
        prompt: result.prompt,
        data: result.data ?? placement.data,
      });
    } else {
      // Use original on failure
      expanded.push(placement);
    }
  }

  return expanded;
}

/**
 * Get infographic-specific tools.
 */
export function getInfographicTools(sessionId?: string): ToolDefinition[] {
  return [
    createGenerateAllInfographicsTool(sessionId),
  ];
}

/**
 * Complex tools that require user confirmation.
 */
export const INFOGRAPHIC_COMPLEX_TOOLS = new Set([
  'generate_all_infographics',
]);
