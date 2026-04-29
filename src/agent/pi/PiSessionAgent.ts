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
import { join } from "node:path";

/**
 * PiSessionAgent — wraps pi-coding-agent's AgentSession to satisfy the
 * SessionAgent contract that ConversationManager expects. Lets the web
 * server treat pi as a drop-in replacement for ExecutorAgent at the
 * conversation layer; the kshana_* tools then call the executor in-
 * process for actual pipeline work.
 *
 * Pi events → kshana events:
 *   tool_execution_start  → tool_call
 *   tool_execution_update → tool_streaming
 *   tool_execution_end    → tool_result
 *   message_update.text_delta → streaming_text
 *   message_end           → streaming_text(done) + agent_text(final)
 *   agent_end             → run() resolves
 */
export class PiSessionAgent extends TypedEventEmitter {
  public readonly name = "kshana-pi";

  private session?: AgentSession;
  private streaming = false;
  private currentResolve?: (result: GenericAgentResult) => void;
  private currentReject?: (err: Error) => void;
  private finalAssistantText = "";
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
    this.finalAssistantText = "";

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
    switch (event.type) {
      case "tool_execution_start": {
        this.emit({
          type: "tool_call",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          arguments: (event.args ?? {}) as Record<string, unknown>,
          agentName: this.name,
        });
        return;
      }
      case "tool_execution_update": {
        const text = extractContentText(event.partialResult);
        if (text) {
          this.emit({
            type: "tool_streaming",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            chunk: text,
            done: false,
            reset: true,
            agentName: this.name,
          });
        }
        return;
      }
      case "tool_execution_end": {
        this.emit({
          type: "tool_result",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: flattenToolResult(event.result),
          isError: event.isError,
          agentName: this.name,
        });
        return;
      }
      case "message_update": {
        const sub = event.assistantMessageEvent;
        if (sub.type === "text_delta" && typeof sub.delta === "string" && sub.delta.length > 0) {
          this.emit({ type: "streaming_text", chunk: sub.delta, done: false });
        }
        return;
      }
      case "message_end": {
        const text = extractAssistantText(event.message);
        if (text) {
          this.finalAssistantText = text;
          this.emit({ type: "streaming_text", chunk: "", done: true });
          this.emit({ type: "agent_text", text, isFinal: true });
        }
        return;
      }
      case "agent_end": {
        const out = this.finalAssistantText || extractFinalText(event.messages);
        this.streaming = false;
        const resolve = this.currentResolve;
        this.cleanupRun();
        resolve?.({ status: "completed", output: out, todos: [] });
        return;
      }
      default:
        return;
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

function extractContentText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const v = value as { content?: unknown };
  if (!Array.isArray(v.content)) return "";
  return v.content
    .map((c) => (c && typeof c === "object" && "type" in c && (c as { type: unknown }).type === "text" && "text" in c ? String((c as { text: unknown }).text) : ""))
    .filter(Boolean)
    .join("\n");
}

function flattenToolResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as { content?: unknown; details?: unknown };
  const text = extractContentText(r);
  const details = r.details && typeof r.details === "object" ? (r.details as Record<string, unknown>) : {};
  return { ...details, output: text };
}

function extractAssistantText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as { content?: unknown };
  if (typeof m.content === "string") return m.content;
  if (!Array.isArray(m.content)) return "";
  return m.content
    .map((c) => (c && typeof c === "object" && "type" in c && (c as { type: unknown }).type === "text" && "text" in c ? String((c as { text: unknown }).text) : ""))
    .filter(Boolean)
    .join("");
}

function extractFinalText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && typeof m === "object" && "role" in m && (m as { role: unknown }).role === "assistant") {
      const text = extractAssistantText(m);
      if (text) return text;
    }
  }
  return "";
}
