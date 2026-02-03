/**
 * ConversationManager - Manages agent sessions and orchestrates conversations.
 * Each WebSocket connection can have one active conversation session.
 */
import { v4 as uuidv4 } from 'uuid';
import { GenericAgent, type GenericAgentResult } from '../core/agent/index.js';
import { LLMClient, type LLMClientConfig } from '../core/llm/index.js';
import { createDefaultToolRegistry } from '../core/tools/index.js';
import { createVideoToolRegistry, VIDEO_CREATION_SYSTEM_PROMPT, createWorkflowVideoAgent, setCurrentProjectBasePath } from '../tasks/video/index.js';
import type { SessionState } from './types.js';
import type { ExpandableTodoItem } from '../core/todo/index.js';
import { assetEventEmitter, type AssetAddedEvent } from './assetEventEmitter.js';

type TaskType = 'generic' | 'video';

export interface ConversationManagerConfig {
  llmConfig: LLMClientConfig;
  sessionTimeoutMs?: number;  // Default: 30 minutes
  maxIterations?: number;     // Default: 50
  taskType?: TaskType;        // Default: 'generic'
}

export interface ConversationEvents {
  onProgress?: (sessionId: string, percentage: number, message: string) => void;
  onToolCall?: (sessionId: string, toolName: string, args: Record<string, unknown>) => void;
  onToolResult?: (sessionId: string, toolName: string, result: unknown) => void;
  onTodoUpdate?: (sessionId: string, todos: ExpandableTodoItem[]) => void;
  onAgentText?: (sessionId: string, text: string, isFinal: boolean) => void;
  onQuestion?: (sessionId: string, question: string, isConfirmation: boolean) => void;
  onAgentStatus?: (sessionId: string, status: string, agentName?: string) => void;
  onAssetAdded?: (sessionId: string, assetId: string, assetType: string, path: string, version: number, placementNumber?: number, sceneNumber?: number) => void;
}

interface ActiveSession {
  state: SessionState;
  agent: GenericAgent;
  abortController?: AbortController;
  initialized?: boolean;
  basePath?: string; // Store basePath for video tasks to save original input
  assetEventHandler?: (event: AssetAddedEvent) => void;
  currentEvents?: ConversationEvents; // Store current events for asset handler
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
   * @param basePath - Optional base path for the project directory (used for video tasks)
   */
  async createSession(basePath?: string): Promise<SessionState> {
    const sessionId = uuidv4();
    const now = Date.now();

    console.log('[ConversationManager] Creating session:', {
      sessionId,
      taskType: this.taskType,
      basePath,
      hasBasePath: !!basePath,
    });

    // Create agent with tools based on task type
    let agent: GenericAgent;

    if (this.taskType === 'video') {
      // For video tasks, use createWorkflowVideoAgent to ensure proper project path handling
      if (basePath) {
        console.log('[ConversationManager] Using createWorkflowVideoAgent with basePath:', basePath);
        agent = await createWorkflowVideoAgent({
          llmConfig: this.llmConfig,
          maxIterations: this.maxIterations,
          originalInput: '',
          basePath,
        });
      } else {
        console.log('[ConversationManager] No basePath provided, using fallback GenericAgent');
        // Fallback to generic agent creation if no basePath provided
        const registry = createVideoToolRegistry();
        const llm = new LLMClient(this.llmConfig);
        agent = new GenericAgent(registry.getAll(), llm, {
          maxIterations: this.maxIterations,
          customPrompt: VIDEO_CREATION_SYSTEM_PROMPT,
          name: 'kshana-video',
        });
      }
    } else {
      const registry = createDefaultToolRegistry();
      const llm = new LLMClient(this.llmConfig);
      agent = new GenericAgent(registry.getAll(), llm, {
        maxIterations: this.maxIterations,
        name: 'kshana-ink',
      });
    }

    const state: SessionState = {
      id: sessionId,
      createdAt: now,
      lastActivity: now,
      status: 'idle',
      taskHistory: [],
    };

    // Set up asset event handler for this session (will be connected to events in runTask/sendResponse)
    // Filter by project directory so ALL sessions with the same project receive asset events,
    // not just the session that generated them (fixes real-time UI updates for ProjectContext)
    const assetEventHandler = (event: AssetAddedEvent) => {
      if (!event.projectDirectory || event.projectDirectory === basePath) {
        const session = this.sessions.get(sessionId);
        if (session?.currentEvents?.onAssetAdded) {
          session.currentEvents.onAssetAdded(sessionId, event.assetId, event.assetType, event.path, event.version, event.placementNumber, event.sceneNumber);
        }
      }
    };

    this.sessions.set(sessionId, { state, agent, basePath, assetEventHandler });

    // Listen for asset events
    assetEventEmitter.onAssetAdded(assetEventHandler);

    // CRITICAL: Set the global basePath immediately when session is created
    // This ensures tools use the correct project directory from the start
    if (this.taskType === 'video' && basePath) {
      setCurrentProjectBasePath(basePath);
      console.log(`[ConversationManager] Set basePath to ${basePath} when creating session ${sessionId}`);
    }

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

    // CRITICAL: For video tasks, save the task as original input if it's empty
    // This ensures desktop saves the user's first message to agent/original_input.md
    if (this.taskType === 'video') {
      try {
        const { loadProject, getOriginalInput, writeProjectFile, getCurrentProjectBasePath } = await import('../tasks/video/workflow/ProjectManager.js');
        // Use session.basePath if available, otherwise use getCurrentProjectBasePath()
        const basePath = session.basePath || getCurrentProjectBasePath();
        const project = loadProject(basePath);
        if (project) {
          const existingOriginalInput = getOriginalInput(project, basePath);
          // If original input is empty or doesn't exist, save the task
          if (!existingOriginalInput || existingOriginalInput.trim().length === 0) {
            writeProjectFile('agent/original_input.md', task, basePath);
            console.log(`[ConversationManager] Saved task as original input to agent/original_input.md (basePath: ${basePath})`);
          }
        } else {
          // Project doesn't exist yet - save original input anyway (will be used when project is created)
          writeProjectFile('agent/original_input.md', task, basePath);
          console.log(`[ConversationManager] Saved task as original input to agent/original_input.md (project doesn't exist yet, basePath: ${basePath})`);
        }
      } catch (error) {
        console.error('[ConversationManager] Failed to save original input:', error);
        // Don't fail the task if saving original input fails
      }
    }

    // Update session state
    session.state.status = 'running';
    session.state.lastActivity = Date.now();
    session.state.taskHistory.push(task);

    // Set current session for asset event tracking
    assetEventEmitter.setCurrentSessionId(sessionId);

    // Store events for asset handler
    session.currentEvents = events;

    // Create abort controller for cancellation
    session.abortController = new AbortController();

    // Set up event listeners
    this.setupEventListeners(sessionId, session.agent, events);

    try {
      // CRITICAL: Reset the global basePath before each agent run to ensure correct project directory
      // This is essential for servers where multiple sessions share the same process
      if (this.taskType === 'video' && session.basePath) {
        setCurrentProjectBasePath(session.basePath);
        console.log(`[ConversationManager] Reset basePath to ${session.basePath} before runTask()`);
      }

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

    // Set current session for asset event tracking
    assetEventEmitter.setCurrentSessionId(sessionId);

    // Store events for asset handler
    session.currentEvents = events;

    // Create abort controller for cancellation
    session.abortController = new AbortController();

    // Set up event listeners
    this.setupEventListeners(sessionId, session.agent, events);

    try {
      // CRITICAL: Reset the global basePath before each agent run to ensure correct project directory
      // This is essential for servers where multiple sessions share the same process
      if (this.taskType === 'video' && session.basePath) {
        setCurrentProjectBasePath(session.basePath);
        console.log(`[ConversationManager] Reset basePath to ${session.basePath} before sendResponse()`);
      }

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
      session.currentEvents = undefined;
      // Clear current session
      assetEventEmitter.setCurrentSessionId(null);
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

    // Update asset event handler for this session
    const session = this.sessions.get(sessionId);
    if (session && events.onAssetAdded) {
      // Remove old handler if exists
      if (session.assetEventHandler) {
        assetEventEmitter.offAssetAdded(session.assetEventHandler);
      }
      // Filter by project directory so all sessions with same project receive events
      const sessionBasePath = session.basePath;
      const assetEventHandler = (event: AssetAddedEvent) => {
        if (!event.projectDirectory || event.projectDirectory === sessionBasePath) {
          events.onAssetAdded!(sessionId, event.assetId, event.assetType, event.path, event.version, event.placementNumber, event.sceneNumber);
        }
      };
      session.assetEventHandler = assetEventHandler;
      assetEventEmitter.onAssetAdded(assetEventHandler);
    }

    if (events.onProgress) {
      agent.on('progress', (data) => {
        events.onProgress!(sessionId, data.percentage, data.message);
      });
    }

    if (events.onToolCall) {
      agent.on('tool_call', (data) => {
        events.onToolCall!(sessionId, data.toolName, data.arguments);
      });
    }

    if (events.onToolResult) {
      agent.on('tool_result', (data) => {
        events.onToolResult!(sessionId, data.toolName, data.result);
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

      // Also handle streaming_text events for real-time streaming
      agent.on('streaming_text', (data) => {
        if (data.chunk !== undefined) {
          console.log('[ConversationManager] streaming_text event:', {
            sessionId,
            chunkLength: data.chunk?.length ?? 0,
            done: data.done ?? false
          });
          events.onAgentText!(sessionId, data.chunk, data.done ?? false);
        }
      });

      // Also handle tool_streaming events (used by dispatch_agent and dispatch_content_agent)
      agent.on('tool_streaming', (data) => {
        // Always forward tool_streaming events (even empty chunks when done: true)
        const chunk = data.chunk ?? '';
        console.log('[ConversationManager] tool_streaming event:', {
          sessionId,
          toolCallId: data.toolCallId,
          chunkLength: chunk.length,
          done: data.done ?? false
        });
        // Forward tool_streaming as stream_chunk so it appears in chat
        events.onAgentText!(sessionId, chunk, data.done ?? false);
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
      // Remove asset event handler
      if (session.assetEventHandler) {
        assetEventEmitter.offAssetAdded(session.assetEventHandler);
      }
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
