import { Type } from "typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { getBackgroundTaskRunner } from "../../../server/runners/backgroundTaskRunnerSingleton.js";

/**
 * Read-only snapshot of the background task runner state. The agent
 * can call this any time to answer "what's running?" without
 * triggering work.
 */

export interface TaskStatusDetails {
  active: boolean;
  taskId?: string;
  kind?: string;
  projectName?: string;
  startedAt?: number;
  log: string;
}

export const kshanaTaskStatus = defineTool({
  name: "kshana_task_status",
  label: "kshana task status",
  description:
    "Report what background task (if any) is currently running. **DO NOT call this in a loop while a run is in progress** — the runner streams progress events into the chat in real time, the user already sees them, and repeated polls only add noise. Use this when the user asks 'what's running?', when you finished an action and want to confirm a state transition, or after at least 60 seconds of silence — never on a tighter cadence.",
  parameters: Type.Object({}),
  async execute(): Promise<AgentToolResult<TaskStatusDetails>> {
    const runner = getBackgroundTaskRunner();
    const active = runner.getActive();
    if (!active) {
      const summary = "No background task is running.";
      return {
        content: [{ type: "text", text: summary }],
        details: { active: false, log: summary },
      };
    }
    const elapsedSec = Math.round((Date.now() - active.startedAt) / 1000);
    const summary = `Running: ${active.spec.kind} on '${active.spec.projectName}' (task ${active.id}, ${elapsedSec}s elapsed).`;
    return {
      content: [{ type: "text", text: summary }],
      details: {
        active: true,
        taskId: active.id,
        kind: active.spec.kind,
        projectName: active.spec.projectName,
        startedAt: active.startedAt,
        log: summary,
      },
    };
  },
});
