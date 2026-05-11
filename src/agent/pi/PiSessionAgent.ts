import { TypedEventEmitter } from '../../events/EventEmitter.js';
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
  type ToolDefinition,
} from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';
import type { Model } from '@mariozechner/pi-ai';
import type { GenericAgentResult } from '../../core/agent/AgentResult.js';
import { dheeTools } from './tools/index.js';
import { createFocusProjectTool, type FocusProjectCallback } from './tools/focusProject.js';
import { createRunToTool, type MediaCallback } from './tools/runTo.js';
import { createShowShotTool } from './tools/showShot.js';
import {
  createShowFirstFrameTool,
  createShowLastFrameTool,
  createShowShotVideoTool,
  createShowFinalVideoTool,
} from './tools/showAsset.js';
import { createDispatchRunToTool } from './tools/dispatchRunTo.js';
import { loadOrchestratorPrompt } from './prompt.js';
import { selectToolsForRole, type SessionRole } from './selectToolsForRole.js';
import { ensureDir, getdheeConfigDir, getProjectsDir, REPO_ROOT } from './paths.js';
import { ensureOpenRouterApiKeyFromEnv } from './ensureOpenRouterKey.js';

const REPO_ROOT_PROMPTS = join(REPO_ROOT, 'prompts');
import { translatePiEvent, type TranslationContext } from './translateEvent.js';
import { join } from 'node:path';

function envTrim(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function envNumber(name: string, fallback: number): number {
  const value = Number(envTrim(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function openAiCompatibleProxyModel(): Model<'openai-completions'> | undefined {
  const baseUrl = envTrim('OPENAI_BASE_URL');
  const apiKey = envTrim('OPENAI_API_KEY');
  if (!baseUrl || !apiKey) return undefined;

  const modelId = envTrim('OPENAI_MODEL') ?? 'deepseek/deepseek-v4-flash';
  const lowerModel = modelId.toLowerCase();
  const reasoning =
    lowerModel.includes('deepseek') ||
    lowerModel.includes('qwen') ||
    lowerModel.includes('gpt-5') ||
    lowerModel.includes('reason');

  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: 'openai',
    baseUrl,
    reasoning,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: envNumber('LLM_CONTEXT_TOKENS', 160000),
    maxTokens: envNumber('LLM_MAX_TOKENS', 64000),
  };
}

export function resolvePiSessionModel(): Model<string> {
  ensureOpenRouterApiKeyFromEnv();

  const tierProvider = envTrim('LLM_TIER_HEAVY_PROVIDER');
  const tierModel = envTrim('LLM_TIER_HEAVY_MODEL');
  if (tierProvider) {
    return getModel(
      tierProvider as Parameters<typeof getModel>[0],
      (tierModel ?? 'deepseek/deepseek-v4-flash') as never
    ) as Model<string>;
  }

  const llmProvider = envTrim('LLM_PROVIDER')?.toLowerCase();
  if (llmProvider === 'openai') {
    const proxyModel = openAiCompatibleProxyModel();
    if (proxyModel) return proxyModel;
    return getModel('openai', (envTrim('OPENAI_MODEL') ?? 'gpt-4o') as never) as Model<string>;
  }
  if (llmProvider === 'openrouter') {
    return getModel(
      'openrouter',
      (envTrim('OPENROUTER_MODEL') ?? 'deepseek/deepseek-v4-flash') as never
    ) as Model<string>;
  }

  return getModel('openrouter', 'deepseek/deepseek-v4-flash') as Model<string>;
}

/**
 * PiSessionAgent — wraps pi-coding-agent's AgentSession to satisfy the
 * SessionAgent contract that ConversationManager expects.
 */
export class PiSessionAgent extends TypedEventEmitter {
  public readonly name = 'dhee-pi';

  private session?: AgentSession;
  private streaming = false;
  private currentResolve?: (result: GenericAgentResult) => void;
  private currentReject?: (err: Error) => void;
  private translationContext: TranslationContext = {
    agentName: 'dhee-pi',
    finalAssistantText: '',
  };
  private unsubscribe?: () => void;

  private readonly tools: ToolDefinition[];
  private readonly systemPrompt: string;

  constructor(opts?: {
    tools?: ToolDefinition[];
    systemPrompt?: string;
    /**
     * Session role. `'interactive'` strips long-running pipeline tools
     * (dhee_run_to, dhee_render_scene_bundle, dhee_audit_fidelity)
     * so a chat session can't be hijacked by a 1–4h blocking task.
     * `'background'` is the dedicated long-run session; it sees the
     * full toolkit. Defaults to `'interactive'` — the safer choice
     * for any caller that hasn't thought about it.
     */
    role?: SessionRole;
    /** Callback that lets the agent focus a project as the session's active project. */
    focusProject?: FocusProjectCallback;
    /** Called whenever a long-running tool surfaces a newly-generated asset. */
    onMedia?: MediaCallback;
    /**
     * Session id to embed in `dhee_dispatch_*` tools so the
     * background task runner tags emitted events with this id, and
     * the host can route them back to the right chat.
     */
    sessionId?: string;
  }) {
    super();
    const role: SessionRole = opts?.role ?? 'interactive';
    let baseTools = opts?.tools ?? dheeTools;
    // Tools that need to surface inline media in chat are factory-built when
    // an onMedia callback is wired. Without onMedia, dhee_show_shot still
    // returns a text summary but won't render image/video cards in the UI.
    if (opts?.onMedia) {
      const mediaRunTo = createRunToTool({
        onMedia: opts.onMedia,
        ...(opts?.sessionId ? { sessionId: opts.sessionId } : {}),
      });
      // The four per-asset show tools (firstFrame, lastFrame,
      // shotVideo, finalVideo) used to be plain exports without
      // any onMedia plumbing — pi-agent calls succeeded but no
      // image/video bubble rendered in chat. Replacing them here
      // with media-wired factory variants closes that gap.
      const showShot = createShowShotTool({ onMedia: opts.onMedia });
      const showFirstFrame = createShowFirstFrameTool({ onMedia: opts.onMedia });
      const showLastFrame = createShowLastFrameTool({ onMedia: opts.onMedia });
      const showShotVideo = createShowShotVideoTool({ onMedia: opts.onMedia });
      const showFinalVideo = createShowFinalVideoTool({ onMedia: opts.onMedia });
      baseTools = baseTools.map(t => {
        if (t.name === 'dhee_run_to') return mediaRunTo;
        if (t.name === 'dhee_show_first_frame') return showFirstFrame;
        if (t.name === 'dhee_show_last_frame') return showLastFrame;
        if (t.name === 'dhee_show_shot_video') return showShotVideo;
        if (t.name === 'dhee_show_final_video') return showFinalVideo;
        return t;
      });
      baseTools = [...baseTools, showShot];
    } else if (opts?.sessionId) {
      // No onMedia callback (rare in production) but we still want
      // to dispatch instead of block when we have a session id.
      const sessionRunTo = createRunToTool({ sessionId: opts.sessionId });
      baseTools = baseTools.map(t => (t.name === 'dhee_run_to' ? sessionRunTo : t));
      baseTools = [...baseTools, createShowShotTool({})];
    } else {
      baseTools = [...baseTools, createShowShotTool({})];
    }
    // Currently a no-op pass-through (see selectToolsForRole notes).
    // Reserved for future dispatch-based tool gating.
    baseTools = selectToolsForRole(baseTools, role);

    // Add the per-session dispatch tools when we have a sessionId.
    // Without sessionId (legacy callers), they're omitted — the
    // legacy synchronous dhee_run_to remains in the tool list as
    // a fallback, so behavior degrades gracefully.
    if (opts?.sessionId) {
      const dispatchRunTo = createDispatchRunToTool({ sessionId: opts.sessionId });
      baseTools = [...baseTools, dispatchRunTo];
    }

    this.tools = opts?.focusProject
      ? [...baseTools, createFocusProjectTool(opts.focusProject)]
      : baseTools;
    this.systemPrompt = opts?.systemPrompt ?? loadOrchestratorPrompt();
  }

  async initialize(): Promise<void> {
    if (this.session) return;

    const model = resolvePiSessionModel();

    const cwd = ensureDir(getProjectsDir());
    const agentDir = ensureDir(join(getdheeConfigDir(), 'pi-agent'));

    const authStorage = AuthStorage.create(join(agentDir, 'auth.json'));
    const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, 'models.json'));
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const skillsDir = join(REPO_ROOT_PROMPTS, 'skills');
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      systemPromptOverride: () => this.systemPrompt,
      additionalSkillPaths: [skillsDir],
    });
    await resourceLoader.reload();

    const result = await createAgentSession({
      cwd,
      agentDir,
      authStorage,
      modelRegistry,
      model,
      customTools: this.tools,
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      settingsManager,
    });
    this.session = result.session;
    this.unsubscribe = this.session.subscribe(event => this.handleEvent(event));
  }

  async run(task: string, userResponse?: string): Promise<GenericAgentResult> {
    if (!this.session) {
      throw new Error('PiSessionAgent.run() called before initialize()');
    }
    const text = userResponse ? `${task}\n\n${userResponse}`.trim() : task;
    if (!text) {
      return { status: 'completed', output: '', todos: [] };
    }

    this.streaming = true;
    this.translationContext = { agentName: this.name, finalAssistantText: '' };

    return await new Promise<GenericAgentResult>((resolve, reject) => {
      this.currentResolve = resolve;
      this.currentReject = reject;
      this.session!.prompt(text).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        if (this.currentReject) {
          const r = this.currentReject;
          this.cleanupRun();
          r(new Error(message));
        }
      });
    });
  }

  stop(): void {
    if (this.session && this.streaming) {
      void this.session.abort();
    }
  }

  isRunning(): boolean {
    return this.streaming;
  }

  getToolNames(): string[] {
    return this.tools.map(t => t.name);
  }

  setAutonomousMode(_enabled: boolean): void {
    // Pi has no direct equivalent of ExecutorAgent's autonomous toggle;
    // session-level confirmation behavior is governed by pi's own settings.
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.removeAllListeners();
  }

  private handleEvent(event: AgentSessionEvent): void {
    const r = translatePiEvent(event, this.translationContext);
    this.translationContext = r.context;
    for (const e of r.events) {
      // TypedEventEmitter is generic — emit accepts any AgentEvent variant.
      this.emit(e as never);
    }
    if (r.agentEndOutput !== undefined) {
      this.streaming = false;
      const resolve = this.currentResolve;
      this.cleanupRun();
      resolve?.({ status: 'completed', output: r.agentEndOutput, todos: [] });
    }
  }

  private cleanupRun(): void {
    this.streaming = false;
    this.currentResolve = undefined;
    this.currentReject = undefined;
  }
}
