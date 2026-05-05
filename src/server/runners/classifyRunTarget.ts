/**
 * Classify a user-supplied run target into a structured intent.
 *
 *   - empty / null → no gate, run to completion ({})
 *   - a value in VALID_STAGES → stage typeId ({ stage })
 *   - a value containing ':' → node id ({ nodeId })
 *   - a value containing '.' → alias (caller must resolve via executor state)
 *   - anything else → throws
 *
 * Aliases like `scene_1_shot_2.image` need the project's executorState
 * to resolve into a real node id. The CLI uses
 * `scripts/cli-helpers.ts:resolveNodeId` for this; the in-process
 * runner does the same lookup before calling runExecutor.
 */
import { VALID_STAGES } from '../../core/planner/stages.js';

export interface ClassifiedRunTarget {
  stage?: string;
  nodeId?: string;
  alias?: string;
}

export function classifyRunTarget(target: string | null | undefined): ClassifiedRunTarget {
  if (!target || target.trim() === '') return {};
  const t = target.trim();
  if (VALID_STAGES.includes(t)) return { stage: t };
  if (t.includes(':')) return { nodeId: t };
  if (t.includes('.')) return { alias: t };
  throw new Error(
    `Unknown target: '${t}'. Expected a stage (${VALID_STAGES.join(', ')}) or a node id like 'shot_image:scene_1_shot_1' or alias like 'scene_1_shot_2.image'.`,
  );
}
