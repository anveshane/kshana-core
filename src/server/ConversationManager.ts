/**
 * ConversationManager - Manages agent sessions and orchestrates conversations.
 * Each WebSocket connection can have one active conversation session.
 * Agent is created lazily when a project is selected via configureSessionForProject().
 */
import { v4 as uuidv4 } from 'uuid';
import { GenericAgent, type GenericAgentResult } from '../core/agent/index.js';
import { LLMClient, type LLMClientConfig } from '../core/llm/index.js';
import { createAgentForProject, updateProjectConfiguration } from '../tasks/video/index.js';
import { getProviderRegistry } from '../services/providers/index.js';
import type { SessionState } from './types.js';
import type { ExpandableTodoItem } from '../core/todo/index.js';
import {
  type SessionContext,
  type IFileSystem,
  runInSession,
  runInSessionAsync,
  createLocalSession,
  createRemoteSession,
  requireSession,
} from '../core/fs/index.js';
import {
  startTimer,
  stopTimer,
  checkpointTimer,
  updateProjectAutonomousMode,
  getElapsedMs,
  loadProject,
} from '../tasks/video/workflow/ProjectManager.js';
import {
  captureSessionEnded,
  captureSessionStarted,
  captureWorkflowCompleted,
  captureWorkflowFailed,
  captureWorkflowStarted,
} from './posthog.js';
import type { DesktopSessionCapabilities } from '../core/remote/DesktopAssemblyBroker.js';

const TIMER_CHECKPOINT_INTERVAL_MS = 60_000; // Flush elapsed time to disk every 60s

export interface ConversationManagerConfig {
  llmConfig: LLMClientConfig;
  sessionTimeoutMs?: number;  // Default: 30 minutes
  maxIterations?: number;     // Default: 50
}

export interface ConversationEvents {
  onProgress?: (sessionId: string, percentage: number, message: string) => void;
  onToolCall?: (
    sessionId: string,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
    agentName?: string,
  ) => void;
  onToolResult?: (
    sessionId: string,
    toolCallId: string,
    toolName: string,
    result: unknown,
    isError?: boolean,
    agentName?: string,
  ) => void;
  onTodoUpdate?: (sessionId: string, todos: ExpandableTodoItem[]) => void;
  onAgentText?: (sessionId: string, text: string, isFinal: boolean) => void;
  onQuestion?: (sessionId: string, question: string, isConfirmation: boolean, options?: Array<{ label: string; description?: string }>, autoApproveTimeoutMs?: number) => void;
  onAgentStatus?: (sessionId: string, status: string, agentName?: string) => void;
  /** Streaming text from agent's LLM output */
  onStreamingText?: (sessionId: string, chunk: string, done: boolean) => void;
  /** Tool streaming for sub-agent content generation */
  onToolStreaming?: (sessionId: string, toolCallId: string, chunk: string, done: boolean, agentName?: string, toolName?: string, reset?: boolean) => void;
  /** Context window usage stats */
  onContextUsage?: (sessionId: string, data: { promptTokens: number; maxTokens: number; percentage: number; wasCompressed: boolean; iteration: number }) => void;
  /** Neutral usage facts for external metering */
  onUsageFact?: (sessionId: string, data: {
    eventId: string;
    kind: 'llm' | 'image_generation' | 'image_edit' | 'video_generation';
    toolName?: string;
    toolCallId?: string;
    facts: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      imageCount?: number;
      seconds?: number;
      artifactId?: string;
      filePath?: string;
    };
  }) => void;
  /** Workflow phase transition */
  onPhaseTransition?: (sessionId: string, data: { fromPhase: string; toPhase: string; displayName?: string; description?: string }) => void;
  /** User-facing notification */
  onNotification?: (sessionId: string, data: { level: 'info' | 'warning' | 'error'; message: string }) => void;
}

interface ActiveSession {
  state: SessionState;
  agent?: GenericAgent;
  abortController?: AbortController;
  initialized?: boolean;
  /** Per-session context for file system and project isolation */
  sessionContext?: SessionContext;
  /** The mode this session operates in */
  mode: 'local' | 'remote';
  /** Remote client filesystem (set in remote mode) */
  remoteFs?: IFileSystem;
  /** Capabilities reported by the connected desktop client */
  desktopCapabilities?: DesktopSessionCapabilities;
  /** Periodic timer checkpoint interval (flushes elapsedMs to disk) */
  timerCheckpointInterval?: ReturnType<typeof setInterval>;
}

export class ConversationManager {
  private sessions = new Map<string, ActiveSession>();
  private llmConfig: LLMClientConfig;
  private sessionTimeoutMs: number;
  private maxIterations: number;
  private cleanupInterval?: ReturnType<typeof setInterval>;

  private getWorkflowName(session: ActiveSession): string {
    const maybeName = (session.agent as unknown as { name?: unknown } | undefined)?.name;
    return typeof maybeName === 'string' && maybeName.trim().length > 0
      ? maybeName
      : 'unknown';
  }

  constructor(config: ConversationManagerConfig) {
    this.llmConfig = config.llmConfig;
    this.sessionTimeoutMs = config.sessionTimeoutMs ?? 30 * 60 * 1000; // 30 minutes
    this.maxIterations = config.maxIterations ?? 50;

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanupStaleSessions(), 60 * 1000);
  }

  /**
   * Create a new conversation session (bare — no agent until project is configured).
   */
  createSession(mode: 'local' | 'remote' = 'local', remoteFs?: IFileSystem): SessionState {
    const sessionId = uuidv4();
    const now = Date.now();

    const state: SessionState = {
      id: sessionId,
      createdAt: now,
      lastActivity: now,
      status: 'idle',
      taskHistory: [],
    };

    this.sessions.set(sessionId, { state, mode, remoteFs });
    captureSessionStarted(sessionId, new Date(now).toISOString());

    return state;
  }

  /**
   * Configure a session's agent for a specific project.
   * Uses the shared createAgentForProject() — same tools, prompt, and params as CLI.
   * Creates a per-session SessionContext so each session has its own project dir and filesystem.
   */
  configureSessionForProject(
    sessionId: string,
    templateId: string,
    style: string,
    duration: number,
    projectDirName?: string,
    providerConfig?: { imageGeneration?: string; imageEditing?: string; videoGeneration?: string },
    autonomousMode?: boolean,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Create per-session context with the appropriate filesystem
    const projectDir = projectDirName ?? 'default.kshana';
    if (session.mode === 'remote' && session.remoteFs) {
      session.sessionContext = createRemoteSession(sessionId, projectDir, session.remoteFs);
    } else {
      session.sessionContext = createLocalSession(sessionId, projectDir);
    }

    // Store autonomous mode on session state
    if (autonomousMode) {
      session.state.autonomousMode = true;
    }

    // Apply provider config if provided
    if (providerConfig) {
      getProviderRegistry().setConfig(providerConfig);
    }

    const effectiveMaxIterations = autonomousMode ? Number.MAX_SAFE_INTEGER : this.maxIterations;

    // Create agent inside the session context so tools see the right project dir
    runInSession(session.sessionContext, () => {
      const { tools, customPrompt, agentName } = createAgentForProject({
        templateId,
        style,
        duration,
        llmConfig: this.llmConfig,
        maxIterations: effectiveMaxIterations,
      });

      const llm = new LLMClient(this.llmConfig);
      session.agent = new GenericAgent(tools, llm, {
        maxIterations: effectiveMaxIterations,
        customPrompt,
        name: agentName,
        autonomousMode,
      });
      session.initialized = false;
    });
  }

  /**
   * Get an existing session.
   */
  getSession(sessionId: string): SessionState | undefined {
    const session = this.sessions.get(sessionId);
    return session?.state;
  }

  getSessionTimerState(sessionId: string): {
    elapsedMs: number;
    running: boolean;
    completed: boolean;
  } | null {
    const session = this.sessions.get(sessionId);
    if (!session?.sessionContext) {
      return null;
    }

    try {
      return runInSession(session.sessionContext, () => {
        const project = loadProject();
        return {
          elapsedMs: getElapsedMs(),
          running: session.state.status === 'running',
          completed:
            session.state.status !== 'running' && !!project?.productionCompletedAt,
        };
      });
    } catch {
      return null;
    }
  }

  /**
   * Check if a session exists.
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Refresh a session's activity timestamp to keep it eligible for resume.
   */
  touchSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.state.lastActivity = Date.now();
    return true;
  }

  /**
   * Check if a session has a configured agent.
   */
  isSessionConfigured(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.agent != null;
  }

  /**
   * Get the tool names for a configured session's agent.
   */
  getSessionToolNames(sessionId: string): string[] {
    const session = this.sessions.get(sessionId);
    return session?.agent?.getToolNames() ?? [];
  }

  /**
   * Update the remote filesystem for a session after websocket connect/reconnect.
   */
  setRemoteFileSystem(sessionId: string, remoteFs: IFileSystem): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.remoteFs = remoteFs;
    if (session.mode === 'remote') {
      if (session.sessionContext) {
        (
          session.sessionContext as SessionContext & {
            fs: IFileSystem;
            mode: 'remote';
          }
        ).fs = remoteFs;
      } else {
        session.sessionContext = createRemoteSession(
          sessionId,
          'default.kshana',
          remoteFs,
        );
      }
    }
    session.state.lastActivity = Date.now();
  }

  getSessionMode(sessionId: string): 'local' | 'remote' | null {
    return this.sessions.get(sessionId)?.mode ?? null;
  }

  setDesktopCapabilities(
    sessionId: string,
    capabilities: DesktopSessionCapabilities,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.desktopCapabilities = capabilities;
    session.state.lastActivity = Date.now();
  }

  getDesktopCapabilities(
    sessionId: string,
  ): DesktopSessionCapabilities | undefined {
    return this.sessions.get(sessionId)?.desktopCapabilities;
  }

  /**
   * Toggle autonomous mode on a running session.
   */
  setAutonomousMode(sessionId: string, enabled: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.state.autonomousMode = enabled;
    session.agent?.setAutonomousMode(enabled);
    if (session.sessionContext) {
      runInSession(session.sessionContext, () => {
        updateProjectAutonomousMode(enabled);
      });
    }
  }

  /**
   * Ensure project.json is present in the remote project cache so sync
   * helpers like loadProject() can read it. No-op for local sessions.
   */
  async ensureRemoteProjectJsonCached(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.sessionContext || session.sessionContext.mode !== 'remote') {
      return;
    }

    await runInSessionAsync(session.sessionContext, async () => {
      try {
        await requireSession().fs.readFile('project.json');
      } catch {
        // Missing or unreadable; persist may still no-op until a project exists on disk.
      }
    });
  }

  persistProjectConfiguration(
    sessionId: string,
    config: { templateId: string; style: string; duration: number; autonomousMode?: boolean },
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.sessionContext) {
      return false;
    }

    return runInSession(session.sessionContext, () => {
      return updateProjectConfiguration({
        templateId: config.templateId,
        style: config.style,
        duration: config.duration,
        autonomousMode: config.autonomousMode,
      });
    });
  }

  /**
   * Run a task in a session.
   * Wraps execution in the session's context so all tool/file operations
   * see the correct project directory and filesystem.
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

    if (!session.agent) {
      throw new Error('Session agent not configured. Select a project first.');
    }

    if (session.state.status === 'running') {
      throw new Error('Session already has a running task');
    }

    if (!session.sessionContext) {
      throw new Error('Session context not initialized. Configure project first.');
    }

    // Run the entire agent execution inside the session context
    return runInSession(session.sessionContext, async () => {
      // Initialize agent if not already done (queries model context length)
      if (!session.initialized) {
        await session.agent!.initialize();
        session.initialized = true;
      }

      // Update session state
      session.state.status = 'running';
      session.state.lastActivity = Date.now();
      session.state.taskHistory.push(task);

      // Create abort controller for cancellation
      session.abortController = new AbortController();

      // Set up event listeners
      this.setupEventListeners(sessionId, session.agent!, events);

      // Start active timer + periodic checkpoint
      try { startTimer(); } catch { /* ignore if no project yet */ }
      session.timerCheckpointInterval = setInterval(() => {
        try { checkpointTimer(); } catch { /* ignore */ }
      }, TIMER_CHECKPOINT_INTERVAL_MS);

      const workflowName = this.getWorkflowName(session);
      const workflowStartedAt = Date.now();
      captureWorkflowStarted({
        sessionId,
        workflowName,
      });

      try {
        const result = await session.agent!.run(task);

        // Stop active timer + checkpoint interval
        if (session.timerCheckpointInterval) { clearInterval(session.timerCheckpointInterval); session.timerCheckpointInterval = undefined; }
        try { stopTimer(); } catch { /* ignore */ }

        // Update session state based on result
        session.state.lastActivity = Date.now();
        if (result.status === 'waiting_for_user') {
          session.state.status = 'awaiting_input';
        } else if (result.status === 'completed') {
          session.state.status = 'completed';
        } else if (result.status === 'error' || result.status === 'interrupted') {
          session.state.status = 'error';
        }

        captureWorkflowCompleted({
          sessionId,
          workflowName,
          durationMs: Math.max(0, Date.now() - workflowStartedAt),
        });

        return result;
      } catch (error) {
        // Stop active timer + checkpoint interval on error
        if (session.timerCheckpointInterval) { clearInterval(session.timerCheckpointInterval); session.timerCheckpointInterval = undefined; }
        try { stopTimer(); } catch { /* ignore */ }
        session.state.status = 'error';
        session.state.lastActivity = Date.now();
        captureWorkflowFailed({
          sessionId,
          workflowName,
          errorType: error instanceof Error ? error.name : 'unknown_error',
          durationMs: Math.max(0, Date.now() - workflowStartedAt),
        });
        throw error;
      } finally {
        // Clean up event listeners
        session.agent!.removeAllListeners();
        session.abortController = undefined;
      }
    });
  }

  /**
   * Send a user response to continue a paused session.
   * Wraps execution in the session's context.
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

    if (!session.agent) {
      throw new Error('Session agent not configured. Select a project first.');
    }

    if (session.state.status !== 'awaiting_input') {
      throw new Error('Session is not awaiting input');
    }

    if (!session.sessionContext) {
      throw new Error('Session context not initialized.');
    }

    return runInSession(session.sessionContext, async () => {
      // Update session state
      session.state.status = 'running';
      session.state.lastActivity = Date.now();

      // Create abort controller for cancellation
      session.abortController = new AbortController();

      // Set up event listeners
      this.setupEventListeners(sessionId, session.agent!, events);

      // Start active timer + periodic checkpoint
      try { startTimer(); } catch { /* ignore */ }
      session.timerCheckpointInterval = setInterval(() => {
        try { checkpointTimer(); } catch { /* ignore */ }
      }, TIMER_CHECKPOINT_INTERVAL_MS);

      try {
        const result = await session.agent!.run('', response);

        // Stop active timer + checkpoint interval
        if (session.timerCheckpointInterval) { clearInterval(session.timerCheckpointInterval); session.timerCheckpointInterval = undefined; }
        try { stopTimer(); } catch { /* ignore */ }

        // Update session state based on result
        session.state.lastActivity = Date.now();
        if (result.status === 'waiting_for_user') {
          session.state.status = 'awaiting_input';
        } else if (result.status === 'completed') {
          session.state.status = 'completed';
        } else if (result.status === 'error' || result.status === 'interrupted') {
          session.state.status = 'error';
        }

        return result;
      } catch (error) {
        // Stop active timer + checkpoint interval on error
        if (session.timerCheckpointInterval) { clearInterval(session.timerCheckpointInterval); session.timerCheckpointInterval = undefined; }
        try { stopTimer(); } catch { /* ignore */ }
        session.state.status = 'error';
        session.state.lastActivity = Date.now();
        throw error;
      } finally {
        // Clean up event listeners
        session.agent!.removeAllListeners();
        session.abortController = undefined;
      }
    });
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
        events.onToolCall!(
          sessionId,
          data.toolCallId,
          data.toolName,
          data.arguments,
          data.agentName,
        );
      });
    }

    if (events.onToolResult) {
      agent.on('tool_result', (data) => {
        events.onToolResult!(
          sessionId,
          data.toolCallId,
          data.toolName,
          data.result,
          data.isError,
          data.agentName,
        );
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
        events.onQuestion!(sessionId, data.question, data.isConfirmation, data.options, data.autoApproveTimeoutMs);
      });
    }

    if (events.onContextUsage) {
      agent.on('context_usage', (data) => {
        events.onContextUsage!(sessionId, data);
      });
    }

    if (events.onUsageFact) {
      agent.on('usage_fact', (data) => {
        events.onUsageFact!(sessionId, data);
      });
    }

    if (events.onPhaseTransition) {
      agent.on('phase_transition', (data) => {
        events.onPhaseTransition!(sessionId, data);
      });
    }

    if (events.onNotification) {
      agent.on('notification', (data) => {
        events.onNotification!(sessionId, data);
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

    // Call agent.stop() to set the aborted flag — the loop checks this each iteration
    if (session.agent) {
      session.agent.stop();
    }

    if (session.abortController) {
      session.abortController.abort();
    }

    session.state.status = 'idle';
    session.state.lastActivity = Date.now();
    return !!(session.agent || session.abortController);
  }

  /**
   * Delete a session.
   */
  deleteSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      const sessionDurationMs = Math.max(0, Date.now() - session.state.createdAt);
      captureSessionEnded(
        sessionId,
        sessionDurationMs,
        new Date(session.state.createdAt).toISOString(),
        session.state.taskHistory.length
      );

      // Cancel any running task
      if (session.abortController) {
        session.abortController.abort();
      }
      // Clear timer checkpoint interval
      if (session.timerCheckpointInterval) {
        clearInterval(session.timerCheckpointInterval);
        session.timerCheckpointInterval = undefined;
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
    // Sessions awaiting user input get a longer timeout (2 hours)
    // to survive long generation jobs + user think time
    const awaitingInputTimeout = Math.max(this.sessionTimeoutMs, 2 * 60 * 60 * 1000);
    for (const [sessionId, session] of this.sessions) {
      const timeout = session.state.status === 'awaiting_input'
        ? awaitingInputTimeout
        : this.sessionTimeoutMs;
      if (now - session.state.lastActivity > timeout) {
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
