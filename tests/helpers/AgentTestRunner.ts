/**
 * Agent Test Runner
 *
 * Main orchestration utility for agent tests.
 * Creates temporary workspaces, initializes agents, and captures state.
 */

import { GenericAgent } from '../../src/core/agent/GenericAgent.js';
import { createDefaultToolRegistry } from '../../src/core/tools/index.js';
import type { Message, ToolCall } from '../../src/core/llm/types.js';
import type { GenericProjectFile } from '../../src/core/templates/types.js';
import { TestContext } from './TestContext.js';
import { StateAssertions, StateSnapshot } from './StateAssertions.js';
import { MockLLMClient } from '../integration/MockLLMClient.js';

export interface AgentTestRunnerOptions {
  /** Template ID to use */
  templateId?: string;
  /** Custom workspace name */
  workspaceName?: string;
  /** Preserve workspace after test (for debugging) */
  preserveWorkspace?: boolean;
  /** Initial project file state */
  initialProject?: Partial<GenericProjectFile>;
}

// Use MockLLMClient for testing
export type MockLLM = MockLLMClient;

export interface AgentRunResult {
  /** Final agent status */
  status: 'waiting_for_user' | 'completed' | 'running' | 'interrupted';
  /** Messages in the conversation */
  messages: Message[];
  /** Tool calls made during execution */
  toolCalls: ToolCall[];
  /** Contexts stored in ContextStore */
  contexts: Array<{ variableName: string; label: string; content: string }>;
  /** Final project state */
  project: GenericProjectFile | null;
  /** Test context for file operations */
  testContext: TestContext;
}

/**
 * Test runner for GenericAgent scenarios.
 *
 * Provides a clean API for setting up and running agent tests:
 *
 * ```ts
 * const runner = new AgentTestRunner();
 * await runner.initialize();
 *
 * const result = await runner.run('User input here');
 *
 * // Verify state
 * await then(result)
 *   .expectStatus('waiting_for_user')
 *   .expectToolCalled('dispatch_agent', { task: 'create plot' })
 *   .verify();
 * ```
 */
export class AgentTestRunner {
  private testContext: TestContext;
  private mockLLM: MockLLMClient;
  private agent?: GenericAgent;
  private originalCwd: string;

  constructor(
    mockLLM: MockLLMClient,
    options: AgentTestRunnerOptions = {}
  ) {
    this.mockLLM = mockLLM;
    this.originalCwd = process.cwd();

    // Create test context
    this.testContext = new TestContext({
      name: options.workspaceName,
      preserve: options.preserveWorkspace,
    });

    // Initialize project structure if provided
    if (options.initialProject) {
      this.initializeProject(options.initialProject);
    }
  }

  /**
   * Initialize the agent.
   */
  async initialize(): Promise<void> {
    // Change to test workspace
    this.testContext.chdir();

    // Create project structure
    this.testContext.createProjectStructure();

    // Create tool registry
    const toolRegistry = createDefaultToolRegistry();
    const tools = toolRegistry.getAll();

    // Create agent
    this.agent = new GenericAgent(tools, this.mockLLM, {
      name: 'test-agent',
      isSubAgent: false,
    });

    // Initialize agent (queries model capabilities)
    await this.agent.initialize();
  }

  /**
   * Run the agent with user input.
   */
  async run(userInput: string): Promise<AgentRunResult> {
    if (!this.agent) {
      throw new Error('Agent not initialized. Call initialize() first.');
    }

    // Track messages and tool calls
    const messages: Message[] = [];
    const toolCalls: ToolCall[] = [];

    // Capture tool calls
    const originalEmit = this.agent.emit.bind(this.agent);
    this.agent.on('tool_call', (event: any) => {
      if (event.toolCall) {
        toolCalls.push(event.toolCall);
      }
    });

    // Run the agent
    try {
      const result = await this.agent.run(userInput);

      // Collect messages
      // Note: GenericAgent doesn't expose messages directly in result
      // We'll need to capture them through events or access internals

      return {
        status: result.status as 'waiting_for_user' | 'completed' | 'running' | 'interrupted',
        messages,
        toolCalls,
        contexts: this.captureContexts(),
        project: this.loadProject(),
        testContext: this.testContext,
      };
    } finally {
      // Restore original directory
      process.chdir(this.originalCwd);
    }
  }

  /**
   * Get the test context.
   */
  getTestContext(): TestContext {
    return this.testContext;
  }

  /**
   * Get the agent instance.
   */
  getAgent(): GenericAgent | undefined {
    return this.agent;
  }

  /**
   * Get the mock LLM.
   */
  getMockLLM(): MockLLMClient {
    return this.mockLLM;
  }

  /**
   * Initialize a project file in the test workspace.
   */
  private initializeProject(projectConfig: Partial<GenericProjectFile>): void {
    const projectPath = this.testContext.getProjectPath();
    const projectFile = require('path').join(projectPath, 'project.json');

    const defaultProject: GenericProjectFile = {
      version: '2.0',
      id: 'test-project',
      title: 'Test Project',
      templateId: 'narrative',
      templateVersion: '3.0.0',
      style: 'cinematic_realism',
      inputType: 'idea',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      currentPhase: 'concept',
      phases: {},
      artifacts: {},
      assets: [], // Add required assets property
      contextStore: {},
      ...projectConfig,
    };

    require('fs').writeFileSync(projectFile, JSON.stringify(defaultProject, null, 2));
  }

  /**
   * Load the project file from the test workspace.
   */
  private loadProject(): GenericProjectFile | null {
    try {
      const projectPath = this.testContext.getProjectPath();
      const projectFile = require('path').join(projectPath, 'project.json');

      if (!require('fs').existsSync(projectFile)) {
        return null;
      }

      const content = require('fs').readFileSync(projectFile, 'utf-8');
      return JSON.parse(content) as GenericProjectFile;
    } catch {
      return null;
    }
  }

  /**
   * Capture contexts from ContextStore.
   */
  private captureContexts(): Array<{ variableName: string; label: string; content: string }> {
    try {
      const contextStore = this.testContext.getContextStore();
      const activeVars = contextStore.getActiveVariables();

      return activeVars.map(({ variableName, label }) => {
        const stored = contextStore.get(variableName);
        return {
          variableName,
          label,
          content: stored?.content || '',
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Clean up the test workspace.
   */
  cleanup(): void {
    this.testContext.cleanup();
    process.chdir(this.originalCwd);
  }
}

/**
 * Helper function to create an AgentTestRunner.
 */
export function createAgentTestRunner(
  mockLLM: MockLLMClient,
  options?: AgentTestRunnerOptions
): AgentTestRunner {
  return new AgentTestRunner(mockLLM, options);
}

/**
 * Convert AgentRunResult to StateSnapshot for assertions.
 */
export function toStateSnapshot(result: AgentRunResult): StateSnapshot {
  return {
    status: result.status,
    messages: result.messages,
    toolCalls: result.toolCalls,
    contexts: result.contexts,
    project: result.project,
  };
}
