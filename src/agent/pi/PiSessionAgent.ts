import { TypedEventEmitter } from "../../events/EventEmitter.js";
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
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import type { GenericAgentResult } from "../../core/agent/AgentResult.js";
import { kshanaTools } from "./tools/index.js";
import { createFocusProjectTool, type FocusProjectCallback } from "./tools/focusProject.js";
import { loadOrchestratorPrompt } from "./prompt.js";
import { ensureDir, getKshanaConfigDir, getProjectsDir } from "./paths.js";
import { translatePiEvent, type TranslationContext } from "./translateEvent.js";
import { join } from "node:path";

/**
 * PiSessionAgent — wraps pi-coding-agent's AgentSession to satisfy the
 * SessionAgent contract that ConversationManager expects.
 */
export class PiSessionAgent extends TypedEventEmitter {
  public readonly name = "kshana-pi";

  private session?: AgentSession;
  private streaming = false;
  private currentResolve?: (result: GenericAgentResult) => void;
  private currentReject?: (err: Error) => void;
  private translationContext: TranslationContext = { agentName: "kshana-pi", finalAssistantText: "" };
  private unsubscribe?: () => void;

  private readonly tools: ToolDefinition[];
  private readonly systemPrompt: string;

  constructor(opts?: {
    tools?: ToolDefinition[];
    systemPrompt?: string;
    /** Callback that lets the agent focus a project as the session's active project. */
    focusProject?: FocusProjectCallback;
  }) {
    super();
    const baseTools = opts?.tools ?? kshanaTools;
    this.tools = opts?.focusProject
      ? [...baseTools, createFocusProjectTool(opts.focusProject)]
      : baseTools;
    this.systemPrompt = opts?.systemPrompt ?? loadOrchestratorPrompt();
  }

  async initialize(): Promise<void> {
    if (this.session) return;

    pipeOpenRouterKey();

    const provider = (process.env["LLM_TIER_HEAVY_PROVIDER"] ?? "openrouter") as "openrouter";
    const modelId = (process.env["LLM_TIER_HEAVY_MODEL"] ?? "deepseek/deepseek-v4-flash") as never;
    const model = getModel(provider, modelId);

    const cwd = ensureDir(getProjectsDir());
    const agentDir = ensureDir(join(getKshanaConfigDir(), "pi-agent"));

    const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
    const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      systemPromptOverride: () => this.systemPrompt,
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
    this.unsubscribe = this.session.subscribe((event) => this.handleEvent(event));
  }

  async run(task: string, userResponse?: string): Promise<GenericAgentResult> {
    if (!this.session) {
      throw new Error("PiSessionAgent.run() called before initialize()");
    }
    const text = userResponse ? `${task}\n\n${userResponse}`.trim() : task;
    if (!text) {
      return { status: "completed", output: "", todos: [] };
    }

    this.streaming = true;
    this.translationContext = { agentName: this.name, finalAssistantText: "" };

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
    return this.tools.map((t) => t.name);
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
      resolve?.({ status: "completed", output: r.agentEndOutput, todos: [] });
    }
  }

  private cleanupRun(): void {
    this.streaming = false;
    this.currentResolve = undefined;
    this.currentReject = undefined;
  }
}

function pipeOpenRouterKey(): void {
  const provider = process.env["LLM_TIER_HEAVY_PROVIDER"];
  const key = process.env["LLM_TIER_HEAVY_API_KEY"];
  if (provider === "openrouter" && key && !process.env["OPENROUTER_API_KEY"]) {
    process.env["OPENROUTER_API_KEY"] = key;
  }
}
