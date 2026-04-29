/**
 * Shared project-selection action used by both the header dropdown
 * (ProjectSelector) and the `/project` slash command. Mirrors the
 * dropdown's hydration steps so a chat-driven pick gets the same
 * panels populated as a click pick.
 */
import type { ExecutorNodeInfo } from "./store";

type Dispatch = (action: { type: string; [k: string]: unknown }) => void;
type Send = (msg: Record<string, unknown>) => void;

export async function selectProjectByName(
  name: string,
  dispatch: Dispatch,
  send: Send,
): Promise<{ ok: boolean; reason?: string }> {
  const projectName = name.replace(/\.kshana$/, "");
  const dirName = `${projectName}.kshana`;

  dispatch({ type: "SELECT_PROJECT", name: projectName });
  send({ type: "select_project", data: { projectName } });

  try {
    const stateRes = await fetch(`/api/v1/projects/${projectName}`);
    if (stateRes.ok) {
      const data = await stateRes.json();
      if (data.currentPhase) {
        dispatch({ type: "SET_PHASE", phase: data.currentPhase });
      }
      if (data.executorState?.nodes) {
        const rawNodes = data.executorState.nodes as Record<string, {
          id: string;
          displayName?: string;
          status?: string;
          typeId: string;
          itemId?: string;
          outputPath?: string;
          outputPaths?: Record<string, string>;
        }>;
        const nodeMap: Record<string, ExecutorNodeInfo> = {};
        for (const [id, n] of Object.entries(rawNodes)) {
          nodeMap[id] = {
            id,
            typeId: n.typeId,
            itemId: n.itemId,
            displayName: n.displayName,
            status: (n.status ?? "pending") as
              | "pending"
              | "in_progress"
              | "completed"
              | "failed",
            outputPath: n.outputPath,
            outputPaths: n.outputPaths,
          };
        }
        dispatch({ type: "SET_NODES", nodes: nodeMap });
        const todos = Object.values(nodeMap)
          .filter((n) => n.displayName && n.typeId !== "final_video")
          .map((n) => ({
            id: n.id,
            text: n.displayName!,
            status: (n.status === "completed"
              ? "completed"
              : n.status === "failed"
                ? "failed"
                : n.status === "in_progress"
                  ? "in_progress"
                  : "pending") as
              | "completed"
              | "failed"
              | "in_progress"
              | "pending",
          }));
        dispatch({ type: "SET_TODOS", todos });
      }
    } else if (stateRes.status === 404) {
      return { ok: false, reason: `Project '${projectName}' not found.` };
    }
  } catch {
    /* state fetch is best-effort */
  }

  try {
    const assetsRes = await fetch(`/api/v1/projects/${projectName}/assets`);
    if (assetsRes.ok) {
      const data = await assetsRes.json();
      const assets = (data.assets || []).map(
        (a: { id: string; path: string; type: string; nodeId?: string; frame?: string }) => ({
          ...a,
          url: `/api/v1/assets/${projectName}/${a.path}`,
        }),
      );
      dispatch({ type: "SET_ASSETS", assets });
    }
  } catch {
    /* assets fetch is best-effort */
  }

  void dirName;
  return { ok: true };
}
