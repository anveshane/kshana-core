/**
 * Task tool - launches specialized subagents.
 * Handled specially by GenericAgent (no handler here).
 */
import { createTool } from '../ToolRegistry.js';

export const taskTool = createTool(
  'Task',
  `Launch a new agent to handle complex, multi-step tasks autonomously.

The Task tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
- general-purpose: General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you. (Tools: *)
- statusline-setup: Use this agent to configure the user's Claude Code status line setting. (Tools: Read, Edit)
- Explore: Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions. (Tools: All tools)
- Plan: Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs. (Tools: All tools)

When using the Task tool, you must specify a subagent_type parameter to select which agent type to use.`,
  {
    type: 'object',
    properties: {
      subagent_type: {
        type: 'string',
        description: 'Which agent type to use (e.g., "Explore", "Plan", "general-purpose")',
      },
      task: {
        type: 'string',
        description: 'Detailed task description for the subagent',
      },
      run_in_background: {
        type: 'boolean',
        description: 'If true, run agent in background and return a task_id',
      },
      resume: {
        type: 'string',
        description: 'Resume a previously started agent by id',
      },
    },
    required: ['subagent_type', 'task'],
  }
  // No handler - handled by GenericAgent
);


