import { spawn } from "node:child_process";
import { isAbsolute, join } from "node:path";
import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-agent-core";
import { getProjectsDir, REPO_ROOT } from "../paths.js";
import { createAssetParser, feedChunk, type AssetEvent } from "./parseAssetLines.js";

/**
 * NOTE: Shelling out to `pnpm exec tsx scripts/*.ts` only works in the
 * dev/repo context. The packaged desktop build has no pnpm, no tsx, and
 * no scripts/ directory — every tool that uses runScript needs an
 * in-process ExecutorAgent equivalent before kshana ships as an app.
 * Tracked in todos/wrap-executor-with-pi-agent.md (the ~3-day slice).
 */

export interface RunScriptOptions {
  script: string;
  args: string[];
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback<RunScriptDetails>;
  cwd?: string;
  /**
   * Called every time a new asset path is observed in stdout
   * (lines like `→ assets/images/...png`). Lets the caller surface
   * generated images / videos as standalone events while the script is
   * still running — distinct from the streaming text that goes to onUpdate.
   */
  onAsset?: (event: AssetEvent) => void;
}

export interface RunScriptDetails {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signalled: boolean;
}

export async function runScript(opts: RunScriptOptions): Promise<AgentToolResult<RunScriptDetails>> {
  const { script, args, signal, onUpdate } = opts;
  const cwd = opts.cwd ?? getProjectsDir();
  const scriptPath = isAbsolute(script) ? script : join(REPO_ROOT, script);
  const tsxBin = join(REPO_ROOT, "node_modules", ".bin", "tsx");
  const fullArgs = [scriptPath, ...args];
  const command = `tsx ${script} ${args.join(" ")}`.trim();

  const { onAsset } = opts;
  const parserState = createAssetParser();

  return await new Promise((resolveP, rejectP) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(tsxBin, fullArgs, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const emitUpdate = () => {
      if (!onUpdate) return;
      onUpdate({
        content: [{ type: "text", text: tail(stdout, stderr) }],
        details: { command, exitCode: null, stdout, stderr, signalled: false },
      });
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (onAsset) {
        for (const ev of feedChunk(parserState, text)) onAsset(ev);
      }
      emitUpdate();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      emitUpdate();
    });

    const onAbort = () => {
      child.kill("SIGTERM");
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      rejectP(err);
    });

    child.on("close", (code, sig) => {
      signal?.removeEventListener("abort", onAbort);
      const signalled = sig !== null;
      const text = formatFinal(command, code, stdout, stderr, signalled);
      resolveP({
        content: [{ type: "text", text }],
        details: { command, exitCode: code, stdout, stderr, signalled },
      });
    });
  });
}

function tail(stdout: string, stderr: string): string {
  const combined = stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
  const lines = combined.split("\n");
  return lines.slice(-30).join("\n");
}

function formatFinal(
  command: string,
  code: number | null,
  stdout: string,
  stderr: string,
  signalled: boolean,
): string {
  const status = signalled
    ? "killed"
    : code === 0
      ? "ok"
      : `exit ${code}`;
  const head = `$ ${command}\n[${status}]`;
  const out = stdout.trim();
  const err = stderr.trim();
  const parts = [head];
  if (out) parts.push(out);
  if (err) parts.push(`[stderr]\n${err}`);
  return parts.join("\n\n");
}

