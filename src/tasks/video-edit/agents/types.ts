/**
 * Sub-agent types for the video editing orchestration system.
 */

import type { EditWorkflowPhase, VideoEditProjectFile } from '../workflow/types.js';

/**
 * Configuration for creating a domain-specific sub-agent.
 */
export interface SubAgentConfig {
  /** Unique identifier for this agent type */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** Domain-specific tools this agent can use (by name) */
  domainTools: string[];
  /** Custom system prompt for this agent */
  systemPrompt: string;
  /** Maximum iterations before stopping (default: 50) */
  maxIterations?: number;
  /** Workflow phases this agent handles */
  phases: EditWorkflowPhase[];
}

/**
 * Result from a sub-agent execution.
 */
export interface SubAgentResult {
  /** Whether the task completed successfully */
  success: boolean;
  /** Status of execution */
  status: 'completed' | 'error' | 'interrupted' | 'needs_user_input';
  /** Output message from the agent */
  output: string;
  /** Any error message */
  error?: string;
  /** Whether the project was modified */
  projectModified: boolean;
  /** Number of iterations used */
  iterations: number;
}

/**
 * Context passed from orchestrator to sub-agent.
 */
export interface SubAgentContext {
  /** Current project state (if exists) */
  projectSnapshot: VideoEditProjectFile | null;
  /** Current workflow phase */
  currentPhase: EditWorkflowPhase;
  /** Task description from orchestrator */
  task: string;
  /** Additional context from orchestrator (tool arguments, user info, etc.) */
  additionalContext?: string;
  /** Parent agent's tool call ID for event correlation */
  parentToolCallId?: string;
}

/**
 * Sub-agent types available in the system.
 */
export type SubAgentType = 'ingest' | 'script' | 'analysis' | 'enhancement';

/**
 * All available sub-agent types.
 */
export const SUB_AGENT_TYPES: SubAgentType[] = ['ingest', 'script', 'analysis', 'enhancement'];
