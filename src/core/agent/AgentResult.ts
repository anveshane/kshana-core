/**
 * Agent result types.
 */
import type { ExpandableTodoItem } from '../todo/index.js';

/**
 * Status of an agent run.
 */
export type AgentStatus = 'completed' | 'error' | 'interrupted' | 'waiting_for_user';

/**
 * Result from a GenericAgent run.
 */
export interface GenericAgentResult {
  status: AgentStatus;
  output: string;
  todos: ExpandableTodoItem[];
  error?: string;
  pendingQuestion?: string;
  isConfirmation?: boolean;
}

/**
 * Configuration for creating an agent.
 */
export interface AgentConfig {
  isSubAgent?: boolean;
  maxIterations?: number;
  name?: string;
  customPrompt?: string;
}
