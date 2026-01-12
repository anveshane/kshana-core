/**
 * Sub-agent module exports for video editing workflow.
 */

// Types
export * from './types.js';

// Shared tools
export { createReadProjectTool, createUpdateProjectTool, getSharedTools } from './sharedTools.js';

// Sub-agent factory
export { SubAgentFactory } from './SubAgentFactory.js';

// Orchestrator tools
export { createSubAgentWrapperTools } from './orchestratorTools.js';

// Prompts
export {
  ORCHESTRATOR_PROMPT,
  INGEST_AGENT_PROMPT,
  SCRIPT_AGENT_PROMPT,
  ANALYSIS_AGENT_PROMPT,
  ENHANCEMENT_AGENT_PROMPT,
} from './prompts/index.js';
