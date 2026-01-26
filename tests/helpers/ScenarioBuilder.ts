/**
 * Scenario Builder
 *
 * Given-When-Then test builder for agent scenarios.
 * Provides a fluent API for setting up and running test scenarios.
 */

import { MockLLMBuilder } from './MockLLMBuilder.js';
import { AgentTestRunner, toStateSnapshot } from './AgentTestRunner.js';
import type { LLMClient } from '../../src/core/llm/index.js';
import type { GenericProjectFile } from '../../src/core/templates/types.js';
import { StateAssertions } from './StateAssertions.js';
import { then } from './StateAssertions.js';
import { FixtureLoader } from './FixtureLoader.js';
import { MockLLMClient } from '../integration/MockLLMClient.js';

export interface ScenarioConfig {
  /** Template ID to use (default: 'narrative') */
  templateId?: string;
  /** Initial user input */
  input?: string;
  /** Initial project state */
  initialProject?: Partial<GenericProjectFile>;
  /** Initial contexts in ContextStore */
  initialContexts?: Array<{ variableName: string; label: string; content: string }>;
  /** Workspace name (for debugging) */
  workspaceName?: string;
  /** Preserve workspace after test */
  preserveWorkspace?: boolean;
}

export interface ScenarioResult {
  /** Execution result */
  result: any;
  /** State snapshot for assertions */
  state: any;
  /** Assertions helper */
  thenVerify: () => StateAssertions;
  /** Test context */
  testContext: any;
}

/**
 * Given-When-Then scenario builder.
 *
 * Usage:
 *
 * ```ts
 * await ScenarioBuilder.given()
 *   .withTemplate('narrative')
 *   .withInput('Jan is a blacksmith...')
 *   .when()
 *   .agentReceivesInput()
 *   .then()
 *   .expectStatus('waiting_for_user')
 *   .expectToolCalled('dispatch_agent', { task: 'create plot' })
 *   .verify();
 * ```
 */
export class ScenarioBuilder {
  private config: ScenarioConfig = {};
  private mockLLMBuilder = new MockLLMBuilder();
  private runner?: any;
  private mockLLM?: MockLLMClient; // Use MockLLMClient instead of LLMClient

  /**
   * Start building a scenario.
   */
  static given(): ScenarioBuilder {
    return new ScenarioBuilder();
  }

  /**
   * Set the template ID.
   */
  withTemplate(templateId: string): this {
    this.config.templateId = templateId;
    return this;
  }

  /**
   * Set the user input.
   */
  withInput(input: string): this {
    this.config.input = input;
    return this;
  }

  /**
   * Load input from a fixture file.
   */
  withInputFixture(fixturePath: string): this {
    const input = FixtureLoader.load(fixturePath);
    this.config.input = input;
    return this;
  }

  /**
   * Set initial project state.
   */
  withInitialProject(project: Partial<GenericProjectFile>): this {
    this.config.initialProject = project;
    return this;
  }

  /**
   * Add initial contexts to ContextStore.
   */
  withInitialContexts(contexts: Array<{ variableName: string; label: string; content: string }>): this {
    this.config.initialContexts = [...(this.config.initialContexts || []), ...contexts];
    return this;
  }

  /**
   * Set workspace name (useful for debugging).
   */
  withWorkspaceName(name: string): this {
    this.config.workspaceName = name;
    return this;
  }

  /**
   * Preserve workspace after test (for debugging).
   */
  withPreservedWorkspace(): this {
    this.config.preserveWorkspace = true;
    return this;
  }

  /**
   * Configure mock LLM responses.
   */
  withMockLLM(configure: (builder: MockLLMBuilder) => void): this {
    configure(this.mockLLMBuilder);
    return this;
  }

  /**
   * Build the scenario and get ready to execute.
   */
  async build(): Promise<ScenarioBuilder> {
    // Build mock LLM
    this.mockLLM = this.mockLLMBuilder.build();

    // Create test runner
    const { AgentTestRunner } = await import('./AgentTestRunner.js');
    this.runner = new AgentTestRunner(this.mockLLM, {
      templateId: this.config.templateId,
      workspaceName: this.config.workspaceName,
      preserveWorkspace: this.config.preserveWorkspace,
      initialProject: this.config.initialProject,
    });

    // Initialize runner
    await this.runner.initialize();

    // Set up initial contexts
    if (this.config.initialContexts) {
      const contextStore = this.runner.getTestContext().getContextStore();
      for (const ctx of this.config.initialContexts) {
        contextStore.store(ctx.content, ctx.label, {
          source: 'manual',
          variableBaseName: ctx.variableName.replace(/^\$/, ''),
        });
      }
    }

    return this;
  }

  /**
   * Execute the scenario (when clause).
   */
  async when(): Promise<ScenarioResult> {
    if (!this.runner) {
      await this.build();
    }

    if (!this.config.input) {
      throw new Error('No input specified. Use withInput() or withInputFixture()');
    }

    // Run the agent
    const result = await this.runner.run(this.config.input);
    const state = toStateSnapshot(result);

    return {
      result,
      state,
      thenVerify: () => then(state),
      testContext: this.runner?.getTestContext(),
    };
  }

  /**
   * Execute a custom action (for advanced scenarios).
   */
  async whenAction(action: (runner: any) => Promise<any>): Promise<ScenarioResult> {
    if (!this.runner) {
      await this.build();
    }

    const result = await action(this.runner);
    const state = toStateSnapshot(result);

    return {
      result,
      state,
      thenVerify: () => then(state),
      testContext: this.runner?.getTestContext(),
    };
  }

  /**
   * Clean up resources.
   */
  cleanup(): void {
    if (this.runner) {
      this.runner.cleanup();
    }
  }

  /**
   * Get the mock LLM (for advanced configuration).
   */
  getMockLLM(): LLMClient | undefined {
    return this.mockLLM;
  }

  /**
   * Get the test runner.
   */
  getRunner(): any {
    return this.runner;
  }
}

/**
 * Helper function to create a scenario.
 */
export function createScenario(): ScenarioBuilder {
  return ScenarioBuilder.given();
}

/**
 * Given clause - start building a scenario.
 */
export function given(): ScenarioBuilder {
  return ScenarioBuilder.given();
}
