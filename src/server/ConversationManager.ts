/**
 * ConversationManager - Manages agent sessions and orchestrates conversations.
 * Each WebSocket connection can have one active conversation session.
 */
import { v4 as uuidv4 } from 'uuid';
import { GenericAgent, type GenericAgentResult } from '../core/agent/index.js';
import { LLMClient, type LLMClientConfig } from '../core/llm/index.js';
import { createDefaultToolRegistry } from '../core/tools/index.js';
import { createVideoToolRegistry, VIDEO_CREATION_SYSTEM_PROMPT } from '../tasks/video/index.js';
import type { SessionState } from './types.js';
import type { ExpandableTodoItem } from '../core/todo/index.js';

type TaskType = 'generic' | 'video';

export interface ConversationManagerConfig {
  llmConfig: LLMClientConfig;
  sessionTimeoutMs?: number;  // Default: 30 minutes
  maxIterations?: number;     // Default: 50
  taskType?: TaskType;        // Default: 'generic'
}

export interface ConversationEvents {
  onProgress?: (sessionId: string, percentage: number, message: string) => void;
  onToolCall?: (sessionId: string, toolName: string, args: Record<string, unknown>, agentName?: string) => void;
  onToolResult?: (sessionId: string, toolName: string, result: unknown, agentName?: string) => void;
  onTodoUpdate?: (sessionId: string, todos: ExpandableTodoItem[]) => void;
  onAgentText?: (sessionId: string, text: string, isFinal: boolean) => void;
  onQuestion?: (sessionId: string, question: string, isConfirmation: boolean) => void;
  onAgentStatus?: (sessionId: string, status: string, agentName?: string) => void;
  /** Streaming text from agent's LLM output */
  onStreamingText?: (sessionId: string, chunk: string, done: boolean) => void;
  /** Tool streaming for sub-agent content generation */
  onToolStreaming?: (sessionId: string, toolCallId: string, chunk: string, done: boolean, agentName?: string, toolName?: string, reset?: boolean) => void;
}

interface ActiveSession {
  state: SessionState;
  agent: GenericAgent;
  abortController?: AbortController;
  initialized?: boolean;
}

export class ConversationManager {
  private sessions = new Map<string, ActiveSession>();
  private llmConfig: LLMClientConfig;
  private sessionTimeoutMs: number;
  private maxIterations: number;
  private taskType: TaskType;
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(config: ConversationManagerConfig) {
    this.llmConfig = config.llmConfig;
    this.sessionTimeoutMs = config.sessionTimeoutMs ?? 30 * 60 * 1000; // 30 minutes
    this.maxIterations = config.maxIterations ?? 50;
    this.taskType = config.taskType ?? 'generic';

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanupStaleSessions(), 60 * 1000);
  }

  /**
   * Create a new conversation session.
   */
  createSession(): SessionState {
    const sessionId = uuidv4();
    const now = Date.now();

    // Create agent with tools based on task type
    let registry;
    let customPrompt: string | undefined;
    let agentName: string;

    if (this.taskType === 'video') {
      registry = createVideoToolRegistry();
      customPrompt = VIDEO_CREATION_SYSTEM_PROMPT;
      agentName = 'kshana-video';
    } else {
      registry = createDefaultToolRegistry();
      agentName = 'kshana-ink';
    }

    const llm = new LLMClient(this.llmConfig);
    const agent = new GenericAgent(registry.getAll(), llm, {
      maxIterations: this.maxIterations,
      customPrompt,
      name: agentName,
    });

    const state: SessionState = {
      id: sessionId,
      createdAt: now,
      lastActivity: now,
      status: 'idle',
      taskHistory: [],
    };

    this.sessions.set(sessionId, { state, agent });

    return state;
  }

  /**
   * Get an existing session.
   */
  getSession(sessionId: string): SessionState | undefined {
    const session = this.sessions.get(sessionId);
    return session?.state;
  }

  /**
   * Check if a session exists.
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Run a task in a session.
   */
  async runTask(
    sessionId: string,
    task: string,
    events?: ConversationEvents
  ): Promise<GenericAgentResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.state.status === 'running') {
      throw new Error('Session already has a running task');
    }

    // Initialize agent if not already done (queries model context length)
    if (!session.initialized) {
      await session.agent.initialize();
      session.initialized = true;
    }

    // Update session state
    session.state.status = 'running';
    session.state.lastActivity = Date.now();
    session.state.taskHistory.push(task);

    // Create abort controller for cancellation
    session.abortController = new AbortController();

    // Set up event listeners
    this.setupEventListeners(sessionId, session.agent, events);

    try {
      const result = await session.agent.run(task);

      // Update session state based on result
      session.state.lastActivity = Date.now();
      if (result.status === 'waiting_for_user') {
        session.state.status = 'awaiting_input';
        if (events?.onQuestion && result.pendingQuestion) {
          events.onQuestion(sessionId, result.pendingQuestion, result.isConfirmation ?? false);
        }
      } else if (result.status === 'completed') {
        session.state.status = 'completed';
      } else if (result.status === 'error' || result.status === 'interrupted') {
        session.state.status = 'error';
      }

      return result;
    } catch (error) {
      session.state.status = 'error';
      session.state.lastActivity = Date.now();
      throw error;
    } finally {
      // Clean up event listeners
      session.agent.removeAllListeners();
      session.abortController = undefined;
    }
  }

  /**
   * Send a user response to continue a paused session.
   */
  async sendResponse(
    sessionId: string,
    response: string,
    events?: ConversationEvents
  ): Promise<GenericAgentResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.state.status !== 'awaiting_input') {
      throw new Error('Session is not awaiting input');
    }

    // Update session state
    session.state.status = 'running';
    session.state.lastActivity = Date.now();

    // Create abort controller for cancellation
    session.abortController = new AbortController();

    // Set up event listeners
    this.setupEventListeners(sessionId, session.agent, events);

    try {
      const result = await session.agent.run('', response);

      // Update session state based on result
      session.state.lastActivity = Date.now();
      if (result.status === 'waiting_for_user') {
        session.state.status = 'awaiting_input';
        if (events?.onQuestion && result.pendingQuestion) {
          events.onQuestion(sessionId, result.pendingQuestion, result.isConfirmation ?? false);
        }
      } else if (result.status === 'completed') {
        session.state.status = 'completed';
      } else if (result.status === 'error' || result.status === 'interrupted') {
        session.state.status = 'error';
      }

      return result;
    } catch (error) {
      session.state.status = 'error';
      session.state.lastActivity = Date.now();
      throw error;
    } finally {
      // Clean up event listeners
      session.agent.removeAllListeners();
      session.abortController = undefined;
    }
  }

  /**
   * Set up event listeners for agent events.
   */
  private setupEventListeners(
    sessionId: string,
    agent: GenericAgent,
    events?: ConversationEvents
  ): void {
    if (!events) return;

    if (events.onProgress) {
      agent.on('progress', (data) => {
        events.onProgress!(sessionId, data.percentage, data.message);
      });
    }

    if (events.onToolCall) {
      agent.on('tool_call', (data) => {
        events.onToolCall!(sessionId, data.toolName, data.arguments, data.agentName);
      });
    }

    if (events.onToolResult) {
      agent.on('tool_result', (data) => {
        events.onToolResult!(sessionId, data.toolName, data.result, data.agentName);
      });
    }

    if (events.onStreamingText) {
      agent.on('streaming_text', (data) => {
        events.onStreamingText!(sessionId, data.chunk, data.done);
      });
    }

    if (events.onToolStreaming) {
      agent.on('tool_streaming', (data) => {
        events.onToolStreaming!(sessionId, data.toolCallId, data.chunk, data.done, data.agentName, data.toolName, data.reset);
      });
    }

    if (events.onTodoUpdate) {
      agent.on('todo_update', (data) => {
        events.onTodoUpdate!(sessionId, data.todos);
      });
    }

    if (events.onAgentText) {
      agent.on('agent_text', (data) => {
        events.onAgentText!(sessionId, data.text, data.isFinal);
      });
    }

    if (events.onAgentStatus) {
      agent.on('agent_status', (data) => {
        events.onAgentStatus!(sessionId, data.status, data.agentName);
      });
    }

    if (events.onQuestion) {
      agent.on('question', (data) => {
        events.onQuestion!(sessionId, data.question, data.isConfirmation);
      });
    }
  }

  /**
   * Cancel a running task.
   */
  cancelTask(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    if (session.abortController) {
      session.abortController.abort();
      session.state.status = 'idle';
      session.state.lastActivity = Date.now();
      return true;
    }

    return false;
  }

  /**
   * Delete a session.
   */
  deleteSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Cancel any running task
      if (session.abortController) {
        session.abortController.abort();
      }
      // Clean up Remotion session resources (temp dirs, jobs) — fire and forget
      import('../services/remotion/index.js')
        .then(({ RemotionRenderer }) => RemotionRenderer.getInstance().cleanupSession(sessionId))
        .catch(() => { /* Remotion service may not be initialized */ });
      this.sessions.delete(sessionId);
      return true;
    }
    return false;
  }

  /**
   * Clean up stale sessions.
   */
  private cleanupStaleSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (now - session.state.lastActivity > this.sessionTimeoutMs) {
        this.deleteSession(sessionId);
      }
    }
  }

  /**
   * Get all active sessions.
   */
  getActiveSessions(): SessionState[] {
    return Array.from(this.sessions.values()).map((s) => s.state);
  }

  /**
   * Shutdown the manager.
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Cancel all running tasks and clear sessions
    for (const sessionId of this.sessions.keys()) {
      this.deleteSession(sessionId);
    }
  }
}
