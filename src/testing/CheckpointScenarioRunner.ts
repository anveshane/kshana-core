/**
 * CheckpointScenarioRunner — run N turns from a checkpoint with a real LLM.
 *
 * Used in Layer 3 (Checkpoint Scenario Tests) to test specific scenarios
 * by resuming from a saved checkpoint rather than replaying the entire
 * conversation from scratch.
 */
import type {
  Message,
  LLMResponse,
  ToolCall,
} from '../core/llm/types.js';
import type { AgentCheckpoint } from './CheckpointManager.js';
import type { RecordableLLMClient } from './ConversationRecorder.js';

/**
 * A recorded turn during scenario execution.
 */
export interface ScenarioTurn {
  turnIndex: number;
  messages: Message[];
  response: LLMResponse;
  toolCalls: ToolCall[];
}

/**
 * Options for creating a scenario runner from a checkpoint.
 */
export interface ScenarioRunnerOptions {
  /** Maximum number of LLM turns before stopping. Default: 10 */
  maxTurns?: number;
  /** Tool names to stub (return success without executing). */
  toolStubs?: string[];
  /** Custom tool stub responses by name. */
  toolStubResponses?: Record<string, string>;
  /** Temperature override for the LLM. */
  temperature?: number;
}

/**
 * Predicate for runUntil — receives the latest turn, returns true to stop.
 */
export type TurnPredicate = (turn: ScenarioTurn) => boolean;

/**
 * Runs scenario tests from a checkpoint with a real (or mock) LLM client.
 *
 * Provides methods to:
 * - Run N turns from a checkpoint
 * - Run until a condition is met
 * - Inject user responses mid-conversation
 * - Inspect tool calls and messages
 */
export class CheckpointScenarioRunner {
  private llm: RecordableLLMClient;
  private messages: Message[];
  private turns: ScenarioTurn[] = [];
  private options: Required<ScenarioRunnerOptions>;
  private stopped = false;
  private checkpoint: AgentCheckpoint;

  private constructor(
    llm: RecordableLLMClient,
    checkpoint: AgentCheckpoint,
    options: ScenarioRunnerOptions
  ) {
    this.llm = llm;
    this.checkpoint = checkpoint;
    this.messages = structuredClone(checkpoint.messages);
    this.options = {
      maxTurns: options.maxTurns ?? 10,
      toolStubs: options.toolStubs ?? [],
      toolStubResponses: options.toolStubResponses ?? {},
      temperature: options.temperature ?? 0,
    };
  }

  /**
   * Create a scenario runner from a checkpoint.
   */
  static fromCheckpoint(
    checkpoint: AgentCheckpoint,
    llm: RecordableLLMClient,
    options: ScenarioRunnerOptions = {}
  ): CheckpointScenarioRunner {
    return new CheckpointScenarioRunner(llm, checkpoint, options);
  }

  /**
   * Run a specific number of LLM turns.
   */
  async runTurns(count: number): Promise<ScenarioTurn[]> {
    const newTurns: ScenarioTurn[] = [];

    for (let i = 0; i < count && !this.stopped; i++) {
      if (this.turns.length >= this.options.maxTurns) {
        this.stopped = true;
        break;
      }

      const turn = await this.executeTurn();
      if (!turn) break;
      newTurns.push(turn);

      // Process any tool calls with stubs
      await this.processToolCalls(turn);
    }

    return newTurns;
  }

  /**
   * Run turns until a predicate returns true or maxTurns is reached.
   */
  async runUntil(predicate: TurnPredicate): Promise<ScenarioTurn[]> {
    const newTurns: ScenarioTurn[] = [];

    while (!this.stopped && this.turns.length < this.options.maxTurns) {
      const turn = await this.executeTurn();
      if (!turn) break;
      newTurns.push(turn);

      await this.processToolCalls(turn);

      if (predicate(turn)) break;
    }

    return newTurns;
  }

  /**
   * Inject a user message into the conversation.
   */
  injectUserMessage(content: string): void {
    this.messages.push({ role: 'user', content });
  }

  /**
   * Get all turns executed so far.
   */
  getTurns(): ScenarioTurn[] {
    return this.turns;
  }

  /**
   * Get the full message history.
   */
  getMessages(): Message[] {
    return this.messages;
  }

  /**
   * Get the checkpoint this runner was created from.
   */
  getCheckpoint(): AgentCheckpoint {
    return this.checkpoint;
  }

  /**
   * Count how many times a specific tool was called across all turns.
   */
  getToolCallCount(toolName: string): number {
    return this.turns.reduce(
      (count, turn) => count + turn.toolCalls.filter(tc => tc.name === toolName).length,
      0
    );
  }

  /**
   * Get all calls to a specific tool.
   */
  getToolCalls(toolName: string): ToolCall[] {
    return this.turns.flatMap(turn => turn.toolCalls.filter(tc => tc.name === toolName));
  }

  /**
   * Get the last assistant message content.
   */
  getLastAssistantContent(): string | null {
    const last = [...this.messages].reverse().find(m => m.role === 'assistant');
    return last?.content ?? null;
  }

  /**
   * Check if the runner has stopped (maxTurns reached or no more responses).
   */
  isStopped(): boolean {
    return this.stopped;
  }

  // --- Private ---

  private async executeTurn(): Promise<ScenarioTurn | null> {
    try {
      const response = await this.llm.generate({
        messages: this.messages,
        temperature: this.options.temperature,
      });

      // Add assistant message to history
      const assistantMsg: Message = {
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      };
      this.messages.push(assistantMsg);

      const turn: ScenarioTurn = {
        turnIndex: this.turns.length,
        messages: structuredClone(this.messages),
        response,
        toolCalls: response.toolCalls,
      };

      this.turns.push(turn);
      return turn;
    } catch (error) {
      this.stopped = true;
      return null;
    }
  }

  private async processToolCalls(turn: ScenarioTurn): Promise<void> {
    for (const tc of turn.toolCalls) {
      if (this.options.toolStubs.includes(tc.name)) {
        const stubResponse =
          this.options.toolStubResponses[tc.name] ??
          JSON.stringify({ success: true, stub: true });

        this.messages.push({
          role: 'tool',
          content: stubResponse,
          toolCallId: tc.id,
          name: tc.name,
        });
      }
    }
  }
}
