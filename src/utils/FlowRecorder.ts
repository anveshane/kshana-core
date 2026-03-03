/**
 * FlowRecorder - Records actual agent execution flows for comparison with expected flows.
 *
 * Singleton pattern: One active recording session at a time.
 * Tracks tool calls, results, and sub-agent nesting.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ActualFlow, ActualStep } from './flowTypes.js';
import { getProjectDir } from '../tasks/video/workflow/ProjectManager.js';

const FLOW_VERSION = '1.0';

export class FlowRecorder {
  private sessionId: string;
  private triggerInput: string;
  private scenario?: string;
  private startTime: string;
  private steps: ActualStep[] = [];
  private stepCounter = 0;

  // Stack for tracking parent context during sub-agent execution
  private stepStack: ActualStep[] = [];

  // Map of active tool calls (by toolCallId) for tracking start/end
  private activeSteps: Map<string, ActualStep> = new Map();

  // Singleton instance
  private static instance: FlowRecorder | null = null;

  private constructor(triggerInput: string, scenario?: string) {
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.triggerInput = triggerInput;
    this.scenario = scenario;
    this.startTime = new Date().toISOString();
  }

  /**
   * Start a new recording session.
   * If a session is already active, it will be ended first.
   */
  static startSession(triggerInput: string, scenario?: string): FlowRecorder {
    // End any existing session
    if (FlowRecorder.instance) {
      FlowRecorder.endSession();
    }

    FlowRecorder.instance = new FlowRecorder(triggerInput, scenario);
    return FlowRecorder.instance;
  }

  /**
   * Get the current active session (if any).
   */
  static getSession(): FlowRecorder | null {
    return FlowRecorder.instance;
  }

  /**
   * End the current session and save the flow.
   * Returns the completed ActualFlow.
   */
  static endSession(): ActualFlow | null {
    if (!FlowRecorder.instance) {
      return null;
    }

    const session = FlowRecorder.instance;
    const flow = session.buildFlow('completed');
    session.save();

    FlowRecorder.instance = null;
    return flow;
  }

  /**
   * Called when a tool execution starts.
   */
  onToolStart(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
    agentName: string
  ): void {
    this.stepCounter++;

    // Determine step ID based on nesting
    const parentStep = this.stepStack.length > 0
      ? this.stepStack[this.stepStack.length - 1]
      : null;

    let stepId: string;
    if (parentStep) {
      // Nested under a parent - count sub-steps
      const subStepCount = (parentStep.subSteps?.length ?? 0) + 1;
      stepId = `${parentStep.stepId}.${subStepCount}`;
    } else {
      // Top-level step
      const topLevelCount = this.steps.length + 1;
      stepId = `${topLevelCount}`;
    }

    const step: ActualStep = {
      stepId,
      agent: agentName,
      tool: toolName,
      toolCallId,
      arguments: this.truncateArgs(args),
      isError: false,
      startTime: new Date().toISOString(),
    };

    // Store in active map
    this.activeSteps.set(toolCallId, step);

    // Add to appropriate place in tree
    if (parentStep) {
      if (!parentStep.subSteps) {
        parentStep.subSteps = [];
      }
      parentStep.subSteps.push(step);
    } else {
      this.steps.push(step);
    }
  }

  /**
   * Called when a tool execution completes.
   */
  onToolComplete(
    toolCallId: string,
    result: unknown,
    isError: boolean
  ): void {
    const step = this.activeSteps.get(toolCallId);
    if (!step) {
      // Tool call not tracked (possibly from before session started)
      return;
    }

    step.endTime = new Date().toISOString();
    step.durationMs = new Date(step.endTime).getTime() - new Date(step.startTime).getTime();
    step.result = this.truncateResult(result);
    step.isError = isError;

    // Remove from active map
    this.activeSteps.delete(toolCallId);
  }

  /**
   * Called when entering a sub-agent context.
   * The parentToolCallId is the tool call that spawned this sub-agent.
   */
  enterSubAgent(agentName: string, parentToolCallId: string): void {
    const parentStep = this.activeSteps.get(parentToolCallId);
    if (parentStep) {
      this.stepStack.push(parentStep);
    }
  }

  /**
   * Called when exiting a sub-agent context.
   */
  exitSubAgent(): void {
    this.stepStack.pop();
  }

  /**
   * Save the current flow to disk.
   */
  save(): void {
    const flow = this.buildFlow(this.activeSteps.size > 0 ? 'running' : 'completed');

    // Ensure directory exists
    const flowDir = path.join(getProjectDir(), 'flows', 'actual');
    if (!fs.existsSync(flowDir)) {
      fs.mkdirSync(flowDir, { recursive: true });
    }

    // Generate filename with timestamp
    const timestamp = this.startTime.replace(/[:.]/g, '-');
    const filename = `session_${timestamp}.json`;
    const filepath = path.join(flowDir, filename);

    fs.writeFileSync(filepath, JSON.stringify(flow, null, 2), 'utf-8');
  }

  /**
   * Build the ActualFlow object from current state.
   */
  private buildFlow(status: 'running' | 'completed' | 'error'): ActualFlow {
    return {
      version: FLOW_VERSION,
      sessionId: this.sessionId,
      scenario: this.scenario,
      startTime: this.startTime,
      endTime: status !== 'running' ? new Date().toISOString() : undefined,
      status,
      triggerInput: this.triggerInput,
      steps: this.steps,
    };
  }

  /**
   * Truncate large argument values to prevent bloated logs.
   */
  private truncateArgs(args: Record<string, unknown>): Record<string, unknown> {
    const truncated: Record<string, unknown> = {};
    const MAX_STRING_LENGTH = 500;

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
        truncated[key] = value.substring(0, MAX_STRING_LENGTH) + `... [truncated, ${value.length} chars total]`;
      } else if (typeof value === 'object' && value !== null) {
        const stringified = JSON.stringify(value);
        if (stringified.length > MAX_STRING_LENGTH) {
          truncated[key] = `[Object, ${stringified.length} chars]`;
        } else {
          truncated[key] = value;
        }
      } else {
        truncated[key] = value;
      }
    }

    return truncated;
  }

  /**
   * Truncate large results to prevent bloated logs.
   */
  private truncateResult(result: unknown): unknown {
    const MAX_RESULT_LENGTH = 1000;

    if (result === null || result === undefined) {
      return result;
    }

    if (typeof result === 'string') {
      if (result.length > MAX_RESULT_LENGTH) {
        return result.substring(0, MAX_RESULT_LENGTH) + `... [truncated, ${result.length} chars total]`;
      }
      return result;
    }

    if (typeof result === 'object') {
      const stringified = JSON.stringify(result);
      if (stringified.length > MAX_RESULT_LENGTH) {
        // Return a summary instead
        const keys = Object.keys(result as Record<string, unknown>);
        return {
          _truncated: true,
          _originalLength: stringified.length,
          _keys: keys.slice(0, 10),
          _keyCount: keys.length,
        };
      }
      return result;
    }

    return result;
  }
}
