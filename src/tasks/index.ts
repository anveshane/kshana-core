/**
 * Task module - provides task-specific configurations for the generic agent.
 *
 * The generic agent is domain-agnostic. Tasks inject:
 * - Custom system prompts (domain knowledge)
 * - Task-specific tools
 * - Tool categories (simple vs complex)
 *
 * This separation keeps the agent framework reusable while allowing
 * specialized behavior for different domains.
 */
import type { GenericAgent } from '../core/agent/index.js';
import type { LLMClientConfig } from '../core/llm/index.js';
import { createDefaultToolRegistry } from '../core/tools/index.js';
import { GenericAgent as GenericAgentClass } from '../core/agent/index.js';
import { LLMClient } from '../core/llm/index.js';
import { createVideoAgent } from './video/index.js';

// Re-export video task
export * from './video/index.js';

/**
 * Available task types.
 */
export type TaskType = 'generic' | 'video';

/**
 * Common configuration for all task types.
 */
export interface TaskConfig {
  llmConfig: LLMClientConfig;
  maxIterations?: number;
}

/**
 * Create an agent for the specified task type.
 *
 * @param taskType - The type of task ('generic' or 'video')
 * @param config - Configuration options
 * @returns Configured GenericAgent instance
 */
export function createAgentForTask(taskType: TaskType, config: TaskConfig): GenericAgent {
  switch (taskType) {
    case 'video': {
      return createVideoAgent(config);
    }

    case 'generic':
    default: {
      // Create a basic generic agent with default tools
      const registry = createDefaultToolRegistry();
      const llm = new LLMClient(config.llmConfig);
      return new GenericAgentClass(registry.getAll(), llm, {
        maxIterations: config.maxIterations ?? 100,
      });
    }
  }
}

/**
 * Get the list of available task types.
 */
export function getAvailableTaskTypes(): TaskType[] {
  return ['generic', 'video'];
}

/**
 * Get a description of a task type.
 */
export function getTaskDescription(taskType: TaskType): string {
  switch (taskType) {
    case 'video':
      return 'Video creation agent - transforms story ideas into AI-generated videos';
    case 'generic':
    default:
      return 'Generic agent - autonomous task completion with todo management';
  }
}
