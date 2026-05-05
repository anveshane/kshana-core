/**
 * ConversationManager - Manages agent sessions and orchestrates conversations.
 * Each WebSocket connection can have one active conversation session.
 * Agent is created lazily when a project is selected via configureSessionForProject().
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { defaultBasePath } from '../tasks/video/workflow/projectFileIO.js';
import {
  resolveProjectDir,
  ProjectDirNotFoundError,
} from '../agent/pi/tools/resolveProjectDir.js';
import type { GenericAgentResult } from '../core/agent/index.js';
import type { LLMClientConfig } from '../core/llm/index.js';
import type { TypedEventEmitter } from '../events/EventEmitter.js';
import { PiSessionAgent } from '../agent/pi/PiSessionAgent.js';
import { getBackgroundTaskRunner } from './runners/backgroundTaskRunnerSingleton.js';
import type { BackgroundTaskRunnerEvents } from './runners/BackgroundTaskRunner.js';
import { applyProjectAnnouncement } from './projectAnnouncement.js';
import {
  setPiOversight as setGlobalPiOversight,
  setVLMJudge as setGlobalVLMJudge,
} from './oversightState.js';
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
  updateProjectConfiguration,
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
  /** Workflow phase transition */
  onPhaseTransition?: (sessionId: string, data: { fromPhase: string; toPhase: string; displayName?: string; description?: string }) => void;
  /** Full timeline state update */
  onTimelineUpdate?: (sessionId: string, data: { timeline: unknown }) => void;
  /** User-facing notification */
  onNotification?: (sessionId: string, data: { level: 'info' | 'warning' | 'error'; message: string }) => void;
  /** Agent (or user) focused a project — frontend should treat it as the active project. */
  onProjectFocused?: (sessionId: string, data: { projectName: string; templateId: string; style: string; duration: number; tools: string[] }) => void;
  /** A long-running tool produced an asset (image / video) — surface it as a standalone chat event. */
  onMediaGenerated?: (sessionId: string, data: { kind: 'image' | 'video'; project: string; path: string; source: string }) => void;
}

/**
 * Common interface for agents that can be used in sessions.
 * Both GenericAgent and ExecutorAgent satisfy this.
 */
interface SessionAgent extends TypedEventEmitter {
  initialize(): Promise<void>;
  run(task: string, userResponse?: string): Promise<GenericAgentResult>;
  stop(): void;
  isRunning(): boolean;
  getToolNames(): string[];
  setAutonomousMode(enabled: boolean): void;
  injectInput?(input: string): void;
}

/**
 * Session role. `'interactive'` (default) is the user's chat
 * session — long-running pipeline tools are stripped so a chat
 * message can't block on a multi-hour run. `'background'` is the
 * dedicated long-run session (created by the desktop when the user
 * clicks Resume); it gets the full toolkit. See
 * `src/agent/pi/selectToolsForRole.ts`.
 */
export type ConversationSessionRole = 'interactive' | 'background';

interface ActiveSession {
  state: SessionState;
  agent?: SessionAgent;
  abortController?: AbortController;
  initialized?: boolean;
  /** Per-session context for file system and project isolation */
  sessionContext?: SessionContext;
  /** The mode this session operates in */
  mode: 'local' | 'remote';
  /** Long-run policy. See ConversationSessionRole. Default 'interactive'. */
  role: ConversationSessionRole;
  /** Remote client filesystem (set in remote mode) */
  remoteFs?: IFileSystem;
  /** Capabilities reported by the connected desktop client */
  desktopCapabilities?: DesktopSessionCapabilities;
  /** Periodic timer checkpoint interval (flushes elapsedMs to disk) */
  timerCheckpointInterval?: ReturnType<typeof setInterval>;
  /** Events callbacks for the currently-running task (cleared after runTask). */
  activeEvents?: ConversationEvents;
  /**
   * Events callbacks pinned for the lifetime of an in-flight background
   * task on this session. Captured from `activeEvents` when the runner
   * emits 'started' and cleared on 'completed' / 'failed' / 'cancelled'.
   * Lives independently of `activeEvents` because the agent's turn
   * (and `activeEvents`) ends as soon as the dispatch tool returns,
   * while the background task keeps emitting progress events for
   * minutes-to-hours afterward.
   */
  backgroundEvents?: ConversationEvents;
  /** Currently-focused project name (no .kshana suffix), set by kshana_focus_project. */
  focusedProject?: string;
  /** Last focused project we announced to the agent (for change detection in runTask). */
  announcedProject?: string;
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

    // Forward background-task-runner events back to the originating
    // session's chat. The runner emits events tagged with the
    // sessionId that dispatched the task; we read each session's
    // activeEvents and route the runner's payload through the
    // same channels the agent's own tool calls use, so the chat
    // panel sees background progress as if it were inline tool output.
    this.subscribeToBackgroundTaskRunner();
  }

  private subscribeToBackgroundTaskRunner(): void {
    const runner = getBackgroundTaskRunner();
    const fakeToolCallIdForTask = (taskId: string): string =>
      `task:${taskId}`;
    // Pick the events sink that's still alive. Prefer the background
    // pin (set on 'started' and held for the task's lifetime) and
    // fall back to activeEvents for the rare case where the agent's
    // turn is still running when an event fires.
    const sinkFor = (session: ActiveSession | undefined): ConversationEvents | undefined =>
      session?.backgroundEvents ?? session?.activeEvents;

    runner.on('started', ({ task }: BackgroundTaskRunnerEvents['started']) => {
      const session = this.sessions.get(task.spec.sessionId);
      if (!session) return;
      // Pin the events sink for the task's lifetime — the agent's
      // tool call returns immediately after dispatch, which clears
      // activeEvents, but the runner keeps emitting progress events
      // long after that. Without this pin, every tool/result/asset
      // event would be dropped.
      if (session.activeEvents) {
        session.backgroundEvents = session.activeEvents;
      }
      const events = sinkFor(session);
      if (!events) return;
      // Synthesize a tool_call event so the chat shows a tool card
      // for the task.
      events.onToolCall?.(
        task.spec.sessionId,
        fakeToolCallIdForTask(task.id),
        `kshana_${task.spec.kind}`,
        task.spec.params,
        this.getWorkflowName(session),
      );
    });
    runner.on('tool', ({ task, toolName, nodeId }: BackgroundTaskRunnerEvents['tool']) => {
      const session = this.sessions.get(task.spec.sessionId);
      const events = sinkFor(session);
      if (!session || !events) return;
      const line = nodeId ? `  [${toolName}] ${nodeId}` : `  [${toolName}]`;
      events.onToolStreaming?.(
        task.spec.sessionId,
        fakeToolCallIdForTask(task.id),
        line + '\n',
        false,
        this.getWorkflowName(session),
        toolName,
      );
    });
    runner.on('result', ({ task, toolName, filePath, status, error }: BackgroundTaskRunnerEvents['result']) => {
      const session = this.sessions.get(task.spec.sessionId);
      const events = sinkFor(session);
      if (!session || !events) return;
      // Surface the error reason inline so both the agent (when it
      // reads the chat transcript on its next turn) and the user see
      // WHY a tool errored — not just "→ error". Without this the
      // ComfyUI rejection text was being dropped at the runner layer.
      const line = filePath
        ? `    → ${filePath}`
        : status === 'error' && error
          ? `    → error: ${error}`
          : status
            ? `    → ${status}`
            : '';
      if (!line) return;
      events.onToolStreaming?.(
        task.spec.sessionId,
        fakeToolCallIdForTask(task.id),
        line + '\n',
        false,
        this.getWorkflowName(session),
        toolName,
      );
    });
    runner.on('notification', ({ task, level, message }: BackgroundTaskRunnerEvents['notification']) => {
      const session = this.sessions.get(task.spec.sessionId);
      const events = sinkFor(session);
      if (!session || !events) return;
      events.onToolStreaming?.(
        task.spec.sessionId,
        fakeToolCallIdForTask(task.id),
        `  [${level}] ${message}\n`,
        false,
        this.getWorkflowName(session),
        'kshana_run_to',
      );
    });
    runner.on('asset', ({ task, kind, filePath }: BackgroundTaskRunnerEvents['asset']) => {
      const session = this.sessions.get(task.spec.sessionId);
      const events = sinkFor(session);
      if (!session || !events) return;
      events.onMediaGenerated?.(task.spec.sessionId, {
        kind,
        path: filePath,
        project: task.spec.projectName,
        source: 'kshana_run_to',
      });
    });
    runner.on('completed', ({ task }: BackgroundTaskRunnerEvents['completed']) => {
      const session = this.sessions.get(task.spec.sessionId);
      const events = sinkFor(session);
      if (session && events) {
        events.onToolResult?.(
          task.spec.sessionId,
          fakeToolCallIdForTask(task.id),
          `kshana_${task.spec.kind}`,
          { status: 'completed' },
          false,
          this.getWorkflowName(session),
        );
      }
      if (session) session.backgroundEvents = undefined;
    });
    runner.on('failed', ({ task, error }: BackgroundTaskRunnerEvents['failed']) => {
      const session = this.sessions.get(task.spec.sessionId);
      const events = sinkFor(session);
      if (session && events) {
        events.onToolResult?.(
          task.spec.sessionId,
          fakeToolCallIdForTask(task.id),
          `kshana_${task.spec.kind}`,
          { error },
          true,
          this.getWorkflowName(session),
        );
      }
      if (session) session.backgroundEvents = undefined;
    });
    runner.on('cancelled', ({ task }: BackgroundTaskRunnerEvents['cancelled']) => {
      const session = this.sessions.get(task.spec.sessionId);
      const events = sinkFor(session);
      if (session && events) {
        events.onToolResult?.(
          task.spec.sessionId,
          fakeToolCallIdForTask(task.id),
          `kshana_${task.spec.kind}`,
          { status: 'cancelled' },
          false,
          this.getWorkflowName(session),
        );
      }
      if (session) session.backgroundEvents = undefined;
    });
  }

  /**
   * Create a new conversation session (bare — no agent until project is configured).
   */
  createSession(
    mode: 'local' | 'remote' = 'local',
    remoteFs?: IFileSystem,
    role: ConversationSessionRole = 'interactive',
  ): SessionState {
    const sessionId = uuidv4();
    const now = Date.now();

    const state: SessionState = {
      id: sessionId,
      createdAt: now,
      lastActivity: now,
      status: 'idle',
      taskHistory: [],
    };

    this.sessions.set(sessionId, { state, mode, role, remoteFs });
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

    // Create the pi-coding-agent session inside the session context so tools see
    // the right project dir. The legacy ExecutorAgent is no longer used at this
    // layer — it's driven by the kshana_* tools.
    //
    // Idempotent on the agent: pi sessions hold the user's chat history, so
    // we MUST NOT recreate the agent when the user selects a different
    // project mid-conversation. Only the SessionContext (filesystem scope)
    // and the focusedProject marker change. The agent picks up the new
    // project via runTask's prepended "Active project" announcement.
    runInSession(session.sessionContext, () => {
      if (!session.agent) {
        session.agent = new PiSessionAgent({
          role: session.role,
          sessionId,
          focusProject: (name) => this.focusSessionProject(sessionId, name),
          onMedia: (event) => {
            const s = this.sessions.get(sessionId);
            s?.activeEvents?.onMediaGenerated?.(sessionId, event);
          },
        });
        session.initialized = false;
      }
    });

    if (projectDirName) {
      session.focusedProject = projectDirName.replace(/\.kshana$/, '');
    }
  }

  /**
   * Ensure the session has a SessionContext + PiSessionAgent so the user can
   * chat before selecting a project. Uses default.kshana as the ambient
   * working directory; tool calls take an explicit `project` parameter so the
   * ambient context only matters for filesystem helpers that scope to a
   * project dir.
   */
  private ensureAmbientSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (!session.sessionContext) {
      const projectDir = 'default.kshana';
      session.sessionContext =
        session.mode === 'remote' && session.remoteFs
          ? createRemoteSession(sessionId, projectDir, session.remoteFs)
          : createLocalSession(sessionId, projectDir);
    }

    if (!session.agent) {
      runInSession(session.sessionContext, () => {
        session.agent = new PiSessionAgent({
          role: session.role,
          sessionId,
          focusProject: (name) => this.focusSessionProject(sessionId, name),
          onMedia: (event) => {
            const s = this.sessions.get(sessionId);
            s?.activeEvents?.onMediaGenerated?.(sessionId, event);
          },
        });
        session.initialized = false;
      });
    }
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
   * Pi-agent oversight runtime toggle (global). Mutates the
   * process-wide `oversightState` global. The desktop's
   * `kshanaCoreManager` invokes this on Settings-panel changes AND on
   * chat-header toggle clicks; both surfaces share the same state.
   *
   * Note on session id: the parameter is preserved for IPC-shape
   * symmetry with `setAutonomousMode`, but oversight is global —
   * the value applies to ALL sessions, not just the caller's.
   * Future-friendly: when we want per-session overrides, this
   * becomes the place to layer them.
   */
  setPiOversight(_sessionId: string, enabled: boolean): void {
    setGlobalPiOversight(enabled);
  }

  /**
   * VLM master switch (global). Same global-state semantics as
   * setPiOversight. The runtime effective value is
   * `piOversight && vlmJudge` — VLM standalone has no consumer;
   * gating is enforced at the runner-singleton's read site, not
   * on writes.
   */
  setVLMJudge(_sessionId: string, enabled: boolean): void {
    setGlobalVLMJudge(enabled);
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
   * Toggle parallel media generation on a running session.
   */
  setParallelMediaGeneration(sessionId: string, enabled: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session?.agent) return;
    // ExecutorAgent exposes setParallelMediaGeneration
    if ('setParallelMediaGeneration' in session.agent) {
      (session.agent as { setParallelMediaGeneration(e: boolean): void }).setParallelMediaGeneration(enabled);
    }
  }

  /**
   * Run a task in a session.
   * Wraps execution in the session's context so all tool/file operations
   * see the correct project directory and filesystem.
   *
   * `opts.stopAtStage` arms the executor's `/run-to <stage>` gate for
   * THIS invocation only — it's cleared in the finally block so the
   * long-lived agent instance doesn't carry state between tasks.
   */
  async runTask(
    sessionId: string,
    task: string,
    events?: ConversationEvents,
    opts?: { stopAtStage?: string },
  ): Promise<GenericAgentResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.state.status === 'running') {
      throw new Error('Session already has a running task');
    }

    // Pi-orchestrator chat works without a project being selected — the user
    // can ask "what projects are available?" before picking one. If no project
    // is configured yet, set up an ambient context + agent on first message.
    // Run BEFORE the agent guard so a brand-new session (created via
    // createSession() but never configured) can still chat. Without this
    // ordering, the embedded desktop hits "Session agent not configured"
    // because focusSessionProject doesn't create an agent — only
    // configureSessionForProject and ensureAmbientSession do.
    if (!session.sessionContext || !session.agent) {
      this.ensureAmbientSession(sessionId);
    }
    if (!session.sessionContext || !session.agent) {
      throw new Error('Failed to initialize session context');
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
      // Stash events on the session so non-agent-emitter callbacks
      // (e.g. PiSessionAgent's onMedia closure firing onMediaGenerated)
      // can reach the WS bridge while the run is in flight.
      session.activeEvents = events;

      // Start active timer + periodic checkpoint
      try { startTimer(); } catch { /* ignore if no project yet */ }
      session.timerCheckpointInterval = setInterval(() => {
        try { checkpointTimer(); } catch { /* ignore */ }
      }, TIMER_CHECKPOINT_INTERVAL_MS);

      // Arm the `/run-to <stage>` gate for this invocation. Guard with a
      // capability check so non-executor agents (if any) don't break.
      const agent = session.agent!;
      const hasStageGate = typeof (agent as { setStopAtStage?: unknown }).setStopAtStage === 'function';
      if (opts?.stopAtStage && hasStageGate) {
        (agent as unknown as { setStopAtStage(s: string | null): void }).setStopAtStage(opts.stopAtStage);
      }

      const workflowName = this.getWorkflowName(session);
      const workflowStartedAt = Date.now();
      captureWorkflowStarted({
        sessionId,
        workflowName,
      });

      // Announce the focused project on the first turn after it changes — pi
      // remembers it in its conversation context, so we only inject once.
      const announced = applyProjectAnnouncement(task, session.focusedProject, session.announcedProject);
      session.announcedProject = announced.announcedProject;
      const effectiveTask = announced.task;

      try {
        const result = await session.agent!.run(effectiveTask);

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
        // Always clear the stage gate — per-invocation, never persists across tasks.
        if (hasStageGate) {
          (agent as unknown as { setStopAtStage(s: string | null): void }).setStopAtStage(null);
        }
        // Clean up event listeners
        session.agent!.removeAllListeners();
        session.abortController = undefined;
        session.activeEvents = undefined;
      }
    });
  }

  /**
   * Focus a project as the active project for this session. Called from the
   * kshana_focus_project tool so the agent can pick a project from the chat
   * without the user needing to use the dropdown. Updates the session's
   * filesystem context, persists the project's stored config, and notifies
   * the frontend so panels (storyboard / phase / timeline) can populate.
   */
  async focusSessionProject(sessionId: string, projectName: string): Promise<{
    projectName: string;
    title?: string;
    style?: string;
    phase?: string;
    templateId: string;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Resolve the on-disk folder via the shared resolver so both
    // naming conventions work — `<name>.kshana` (canonical) and
    // `<name>` (kshana-desktop's NewProjectDialog default). Earlier
    // this hardcoded `<name>.kshana` and ENOENT'd on desktop projects.
    let projectDirAbs: string;
    try {
      projectDirAbs = resolveProjectDir({
        name: projectName,
        basePath: defaultBasePath(),
      });
    } catch (err) {
      const detail =
        err instanceof ProjectDirNotFoundError ? err.message : String(err);
      throw new Error(
        `Project '${projectName}' not found or unreadable. ${detail}`,
      );
    }
    const projectDirName = nodePath.basename(projectDirAbs);
    let project: NonNullable<ReturnType<typeof loadProject>>;
    try {
      const projectJsonPath = nodePath.join(projectDirAbs, 'project.json');
      if (!nodeFs.existsSync(projectJsonPath)) {
        throw new Error(`project.json not found at ${projectJsonPath}`);
      }
      const raw = nodeFs.readFileSync(projectJsonPath, 'utf-8');
      project = JSON.parse(raw) as NonNullable<ReturnType<typeof loadProject>>;
    } catch (err) {
      throw new Error(
        `Project '${projectName}' not found or unreadable. ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const templateId = project.templateId ?? 'narrative';
    const style = project.style ?? 'cinematic_realism';
    const duration = project.targetDuration ?? 60;

    // Refresh the session context to point at the focused project so any
    // file-system helpers that scope to a project (asset registry, etc.) see
    // the right cwd. Preserve the existing agent — we don't want to recreate
    // pi mid-conversation; pi tools already take an explicit project param.
    if (session.mode === 'remote' && session.remoteFs) {
      session.sessionContext = createRemoteSession(sessionId, projectDirName, session.remoteFs);
    } else {
      session.sessionContext = createLocalSession(sessionId, projectDirName);
    }

    session.focusedProject = projectName;
    // Do NOT pre-mark this project as announced. Both the agent's own
    // kshana_focus_project tool AND the desktop's IPC focusProject
    // bridge land here, but only the agent path already sees the
    // focus inside its tool result; the desktop path opens a project
    // BEFORE any agent turn has run. Pre-setting `announcedProject`
    // caused `applyProjectAnnouncement` to silently skip the prefix
    // on the very first user message, leaving pi-agent to guess the
    // active project from `kshana_list_projects` (the BurgerEating-vs-
    // The-Village miss from the field). A redundant announcement when
    // the agent itself just focused is cheap; a missed announcement
    // when the desktop just focused is a wrong-project answer.
    session.announcedProject = undefined;

    // Persist the configuration so a reconnect resumes on this project.
    try {
      this.persistProjectConfiguration(sessionId, { templateId, style, duration });
    } catch {
      /* persisting is best-effort — non-fatal if storage is unavailable */
    }

    const tools = session.agent?.getToolNames() ?? [];
    session.activeEvents?.onProjectFocused?.(sessionId, {
      projectName,
      templateId,
      style,
      duration,
      tools,
    });

    return {
      projectName,
      title: project.title,
      style: project.style,
      phase: project.currentPhase,
      templateId,
    };
  }

  /**
   * Read the agent's last stop reason. Used by WebSocketHandler to
   * distinguish "paused at stage" from "completed" when emitting the
   * final status message.
   */
  getAgentStopReason(sessionId: string): 'complete' | 'paused_at_stage' | 'cancelled' | 'failed' | null {
    const session = this.sessions.get(sessionId);
    const agent = session?.agent;
    if (agent && typeof (agent as { getStopReason?: unknown }).getStopReason === 'function') {
      return (agent as unknown as { getStopReason(): 'complete' | 'paused_at_stage' | 'cancelled' | 'failed' | null }).getStopReason();
    }
    return null;
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
      session.activeEvents = events;

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
        session.activeEvents = undefined;
      }
    });
  }

  /**
   * Set up event listeners for agent events.
   */
  private setupEventListeners(
    sessionId: string,
    agent: SessionAgent,
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

    if (events.onPhaseTransition) {
      agent.on('phase_transition', (data) => {
        events.onPhaseTransition!(sessionId, data);
      });
    }

    if (events.onTimelineUpdate) {
      agent.on('timeline_update', (data) => {
        events.onTimelineUpdate!(sessionId, { timeline: data.timeline });
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
   *
   * Two execution paths can be live for one chat:
   *   1. The pi-agent's own loop (`session.agent`) — stopped via
   *      `agent.stop()` + `abortController.abort()`.
   *   2. A `BackgroundTaskRunner` task the pi-agent dispatched
   *      (`kshana_dispatch_run_to`) — runs OUT of the chat's call
   *      stack with its own AbortController.
   *
   * Stop must terminate BOTH. Pre-2026-05-04 only (1) was cancelled,
   * so the desktop's Stop button left the runner ploughing through
   * shots while the chat's "Stopping..." spinner span forever. Only
   * the runner task matching THIS session's id is touched — other
   * chat windows' work is independent.
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

    let backgroundCancelled = false;
    try {
      const runner = getBackgroundTaskRunner();
      const active = runner.getActive();
      if (active && active.spec.sessionId === sessionId) {
        backgroundCancelled = runner.cancel(active.id);
      }
    } catch {
      // Runner uninitialized in this process — nothing to cancel.
    }

    session.state.status = 'idle';
    session.state.lastActivity = Date.now();
    return !!(session.agent || session.abortController || backgroundCancelled);
  }

  /**
   * Redo a specific node: invalidate it + dependents, then resume execution.
   */
  async redoNode(
    sessionId: string,
    nodeId: string,
    events?: ConversationEvents,
    editedPrompt?: Record<string, unknown>,
    frame?: string,
    scope?: 'prompt',
  ): Promise<GenericAgentResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (!session.agent) {
      throw new Error('Session agent not configured. Select a project first.');
    }
    if (session.state.status === 'running') {
      throw new Error('Session already has a running task — cannot redo while executing');
    }
    if (!session.sessionContext) {
      throw new Error('Session context not initialized. Configure project first.');
    }

    // If user edited the prompt, save it to disk BEFORE invalidation
    const hasEdits = !!(editedPrompt && Object.keys(editedPrompt).length > 0);
    if (hasEdits) {
      const { saveEditedPrompt } = await import('./editAndRedo.js');
      const projectDir = session.sessionContext.projectDir;
      await saveEditedPrompt(projectDir, nodeId, editedPrompt);
    }

    // Edit-prompt special case: if user edited a shot_image_prompt, we MUST
    // NOT invalidate that prompt node (invalidation → re-run LLM → overwrite
    // the user's edits). Instead, keep the prompt as-is and invalidate only
    // the dependent shot_image so the image regenerates from the edited prompt.
    // Downstream video/final stay put — user can redo them manually if needed.
    let redoTargetNodeId = nodeId;
    let redoOpts: { frame?: string; scope?: 'prompt' | 'image_only' } = { frame, scope };
    if (hasEdits && nodeId.startsWith('shot_image_prompt:')) {
      redoTargetNodeId = nodeId.replace('shot_image_prompt:', 'shot_image:');
      // Preserve the frame so only that frame regenerates (not the whole shot)
      redoOpts = { scope: 'image_only', frame };
    }

    // Legacy ExecutorAgent path: invalidate in-process and resume runTask.
    if ('redoNode' in session.agent) {
      const invalidated = (session.agent as {
        redoNode(id: string, opts?: { frame?: string; scope?: 'prompt' | 'image_only' }): unknown[];
      }).redoNode(redoTargetNodeId, redoOpts);
      if (invalidated.length === 0) {
        throw new Error(`Node '${redoTargetNodeId}' not found in execution graph`);
      }
      return this.runTask(sessionId, '', events);
    }

    // Pi-era fallback: PiSessionAgent has no in-process executor graph,
    // so spawn scripts/regen-node.ts (same path kshana_regen uses).
    // Stream stdout through onToolStreaming and surface generated assets
    // as media_generated events.
    const projectName = session.sessionContext.projectDir.replace(/\.kshana$/, '');
    return await this.runRegenSubprocess(sessionId, projectName, redoTargetNodeId, events);
  }

  private async runRegenSubprocess(
    sessionId: string,
    projectName: string,
    nodeId: string,
    events?: ConversationEvents,
  ): Promise<GenericAgentResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    session.state.status = 'running';
    session.state.lastActivity = Date.now();
    session.activeEvents = events;

    const { spawn } = await import('node:child_process');
    const { join } = await import('node:path');
    const { createAssetParser, feedChunk } = await import('../agent/pi/tools/parseAssetLines.js');
    const tsxBin = join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const scriptPath = join(process.cwd(), 'scripts', 'regen-node.ts');

    const parser = createAssetParser();
    let stdout = '';
    let stderr = '';
    const startedAt = Date.now();
    const toolCallId = `regen_${startedAt}`;

    events?.onToolCall?.(sessionId, toolCallId, 'kshana_regen', { project: projectName, node: nodeId }, 'kshana');

    return await new Promise<GenericAgentResult>((resolve) => {
      const child = spawn(tsxBin, [scriptPath, projectName, nodeId], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stdout += text;
        events?.onToolStreaming?.(sessionId, toolCallId, text, false, 'kshana', 'kshana_regen', false);
        for (const ev of feedChunk(parser, text)) {
          events?.onMediaGenerated?.(sessionId, {
            kind: ev.kind,
            project: projectName,
            path: ev.path,
            source: 'kshana_regen',
          });
        }
      });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      child.on('error', (err) => {
        events?.onToolResult?.(sessionId, toolCallId, 'kshana_regen', { error: err.message }, true, 'kshana');
        session.state.status = 'error';
        session.activeEvents = undefined;
        resolve({ status: 'error', output: '', todos: [], error: err.message });
      });
      child.on('close', (code) => {
        const ok = code === 0;
        events?.onToolResult?.(sessionId, toolCallId, 'kshana_regen', {
          exit_code: code,
          stdout: stdout.slice(-500),
          stderr: stderr.slice(-500),
        }, !ok, 'kshana');
        session.state.status = ok ? 'completed' : 'error';
        session.activeEvents = undefined;
        resolve({
          status: ok ? 'completed' : 'error',
          output: ok ? `Regenerated ${nodeId}` : `regen-node exited ${code}`,
          todos: [],
          ...(ok ? {} : { error: `regen-node exited ${code}: ${stderr.slice(-200)}` }),
        });
      });
    });
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
