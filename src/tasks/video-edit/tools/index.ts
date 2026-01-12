/**
 * Video editing tools exports.
 */

// Ingest tools
export {
  importVideoTool,
  extractMetadataTool,
  generateThumbnailsTool,
  completeIngestTool,
  ingestTools,
} from './ingestTools.js';

// Script tools
export {
  detectScriptFormatTool,
  parseScriptTool,
  transcribeVideoTool,
  alignScriptToVideoTool,
  addUserHintTool,
  completeScriptParseTool,
  scriptTools,
} from './scriptTools.js';

// Analysis tools
export {
  identifyEnhancementOpportunitiesTool,
  extractFrameTool,
  completeAnalysisTool,
  analysisTools,
} from './analysisTools.js';

// Enhancement tools
export {
  suggestEnhancementTool,
  approveEnhancementTool,
  rejectEnhancementTool,
  regenerateEnhancementTool,
  listEnhancementsTool,
  getNextPendingEnhancementTool,
  completeEnhancementPlanTool,
  enhancementTools,
} from './enhancementTools.js';

// Combine all tools
import { ingestTools } from './ingestTools.js';
import { scriptTools } from './scriptTools.js';
import { analysisTools } from './analysisTools.js';
import { enhancementTools } from './enhancementTools.js';
import type { ToolDefinition } from '../../../core/llm/index.js';

/**
 * All video editing tools.
 */
export const allVideoEditTools: ToolDefinition[] = [
  ...ingestTools,
  ...scriptTools,
  ...analysisTools,
  ...enhancementTools,
];

/**
 * Get tools allowed for a specific phase.
 */
export function getToolsForPhase(phase: string): ToolDefinition[] {
  switch (phase) {
    case 'ingest':
      return ingestTools;
    case 'script_parse':
      return scriptTools;
    case 'analysis':
      return analysisTools;
    case 'enhancement_plan':
      return enhancementTools;
    // Additional phases will be added as they are implemented
    default:
      return [];
  }
}
