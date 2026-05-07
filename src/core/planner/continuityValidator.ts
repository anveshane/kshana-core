/**
 * Continuity validation for scene_video_prompt and per-shot state transitions.
 *
 * Two validators:
 *  1. validateContinuitySequence — sync JSON walk, checks entry/exit/bridge balance.
 *  2. checkPositionContinuity   — async LLM check: did the main subject teleport?
 *
 * Both produce WARNINGS (non-fatal). The executor logs them; it does NOT reject.
 */

import type { SceneState } from './sceneState.js';

export interface ContinuityWarning {
  scope: 'sequence' | 'position';
  shotNumber: number;
  message: string;
  /** Optional hint for what to fix (useful for self-repair retries). */
  suggestion?: string;
}

/**
 * Minimal shot shape used by the sequence validator — intentionally loose so
 * it can accept both post-Zod objects and raw JSON.
 */
export interface ContinuityShotInput {
  shotNumber: number;
  continuityRole?: string;
  purpose?: string;
  description?: string;
}

export interface ContinuityScenePromptInput {
  mainSubject?: string;
  shots: ContinuityShotInput[];
}

// ── Option 1: Sequence validator (sync, no LLM) ─────────────────────────────

/**
 * Walk the shot list and flag sequence anomalies in continuityRole markers.
 * Does NOT reject — returns warnings only.
 */
export function validateContinuitySequence(
  svp: ContinuityScenePromptInput,
): ContinuityWarning[] {
  const warnings: ContinuityWarning[] = [];
  let pendingExitSince: number | null = null;

  for (const shot of svp.shots) {
    const role = shot.continuityRole || 'none';

    if (role === 'exit') {
      if (pendingExitSince !== null) {
        warnings.push({
          scope: 'sequence',
          shotNumber: shot.shotNumber,
          message: `Second 'exit' at shot ${shot.shotNumber} before 'entry' resolved the previous exit at shot ${pendingExitSince}`,
          suggestion: `Add an 'entry' or 'bridge' shot between them, or change one of these to a different continuityRole`,
        });
      }
      pendingExitSince = shot.shotNumber;
    } else if (role === 'entry') {
      // An entry as the very first shot is fine (scene opens with arrival).
      // An entry mid-scene without a prior exit is suspicious.
      if (pendingExitSince === null && shot.shotNumber > 1) {
        warnings.push({
          scope: 'sequence',
          shotNumber: shot.shotNumber,
          message: `'entry' at shot ${shot.shotNumber} has no matching 'exit' earlier in the scene`,
          suggestion: `If this is a scene opener, ignore. Otherwise add an 'exit' shot for the main subject before this entry.`,
        });
      }
      pendingExitSince = null;
    } else if (role === 'bridge') {
      // Bridge without prior exit is odd — bridges connect exit→entry.
      if (pendingExitSince === null) {
        warnings.push({
          scope: 'sequence',
          shotNumber: shot.shotNumber,
          message: `'bridge' at shot ${shot.shotNumber} has no prior 'exit' — bridges typically follow an exit`,
          suggestion: `Add an 'exit' shot before this bridge or change this shot's continuityRole`,
        });
      }
    }
  }

  // Note: an unresolved `pendingExitSince` at scene end is OK — the main subject
  // legitimately leaves the scene, and the next scene can open with an 'entry'.

  return warnings;
}

// ── One-setting-per-scene validator ──────────────────────────────────────────
//
// Why this exists: in the failed projects (The Village shot 2.3 in particular),
// a single shot referenced two settings simultaneously ("forest from image 2"
// AND "forest edge from image 1"). Flux Klein's 4-slot input layout reserves
// slot 1 for the base canvas; two settings competing for it produces mangled
// framing. The deeper rule: a scene = one location. A multi-setting scene is
// either redundant aliasing of the same location OR a missing scene boundary.
// Either way, the LLM should be re-rolled with a tighter brief.
//
// We allow multi-setting use ONLY when the scene has explicit
// continuityRole='bridge' / 'entry' / 'exit' shots — that's the LLM declaring
// "yes, the main subject is moving between locations and here are the bridge
// shots." Without those markers, multiple settings = drift.

export interface OneSettingPerSceneShotInput {
  shotNumber: number;
  continuityRole?: string;
  focus?: {
    primary?: string;
    background?: string[];
    lurking?: string | null;
  };
}

export interface OneSettingPerSceneInput {
  shots: OneSettingPerSceneShotInput[];
  /** Setting refIds known to the project. Lets us distinguish setting refs from
   *  character refs in the focus block (focus.primary may be either). */
  knownSettingRefIds: string[];
}

export function validateOneSettingPerScene(
  input: OneSettingPerSceneInput,
): ContinuityWarning[] {
  const settingSet = new Set(input.knownSettingRefIds);
  const sceneHasBridge = input.shots.some(s => {
    const r = s.continuityRole ?? 'none';
    return r === 'bridge' || r === 'entry' || r === 'exit';
  });

  // Walk shots in order; record the first setting and flag the first shot that
  // introduces a different one (when no bridge marker exists in the scene).
  let firstSetting: string | null = null;
  const warnings: ContinuityWarning[] = [];

  for (const shot of input.shots) {
    const used = new Set<string>();
    const focus = shot.focus ?? {};
    if (focus.primary && settingSet.has(focus.primary)) used.add(focus.primary);
    for (const b of focus.background ?? []) {
      if (settingSet.has(b)) used.add(b);
    }
    if (focus.lurking && settingSet.has(focus.lurking)) used.add(focus.lurking);

    for (const s of used) {
      if (firstSetting === null) {
        firstSetting = s;
      } else if (s !== firstSetting && !sceneHasBridge) {
        warnings.push({
          scope: 'sequence',
          shotNumber: shot.shotNumber,
          message:
            `Shot ${shot.shotNumber} introduces a second setting "${s}" — ` +
            `scene already uses setting "${firstSetting}". ` +
            `A scene should reference one location.`,
          suggestion:
            `Reuse "${firstSetting}" for this shot, OR mark a transition shot ` +
            `with continuityRole='bridge'/'entry'/'exit', OR split the scene.`,
        });
        return warnings; // First offence is enough — the LLM will fix the rest after re-roll.
      }
    }
  }

  return warnings;
}

// ── Layer C3: consecutive scenes must use different locations ───────────────
//
// User's law: "A completely different location is a completely different
// scene." The corollary: two consecutive scenes that share a primary setting
// refId are either accidentally split (and should be merged) or have a
// genuine non-location reason (time skip, perspective change). This validator
// flags the violation; the breakdown LLM can then re-roll the scene plan.

export interface ConsecutiveScenesInput {
  /** Each scene with its dominant setting refId — usually computed by taking
   *  the most common setting refId across the scene's shots, or the first
   *  one referenced. */
  scenes: Array<{
    sceneNumber: number;
    primarySetting?: string | null;
    /** Optional flag for legitimate non-location reasons (time skip etc.).
     *  When set, the validator skips this transition. */
    timeSkip?: boolean;
  }>;
}

export function validateNewScenesNewLocations(
  input: ConsecutiveScenesInput,
): ContinuityWarning[] {
  const warnings: ContinuityWarning[] = [];
  for (let i = 1; i < input.scenes.length; i++) {
    const prev = input.scenes[i - 1]!;
    const curr = input.scenes[i]!;
    if (curr.timeSkip) continue;
    if (!prev.primarySetting || !curr.primarySetting) continue;
    if (prev.primarySetting === curr.primarySetting) {
      warnings.push({
        scope: 'sequence',
        shotNumber: curr.sceneNumber,
        message:
          `Scene ${curr.sceneNumber} reuses scene ${prev.sceneNumber}'s setting ` +
          `"${prev.primarySetting}" — a new scene should be a new location.`,
        suggestion:
          `Either merge scene ${curr.sceneNumber} into scene ${prev.sceneNumber}, ` +
          `OR mark this transition as a deliberate time skip / perspective shift.`,
      });
    }
  }
  return warnings;
}

// ── Option 2: LLM-based position continuity check ───────────────────────────

const TELEPORT_CHECK_SYSTEM = `You check video shot continuity. Your job is to detect TELEPORTS — where a character appears in a completely different physical location between consecutive shots without any bridge shot showing movement.

RULES for what counts as a teleport:
- Moving between rooms, buildings, or outdoor locations WITHOUT a bridge shot = teleport.
- Character goes off-screen in one shot and appears in a new location in the next = teleport.
- Small position shifts within the same physical space (standing → sitting → leaning, walking across a room) = NOT a teleport.
- Camera re-framing of the same physical space (wide shot → close-up) = NOT a teleport.
- A shot with continuityRole "entry", "exit", or "bridge" is explicitly a bridge shot — NOT a teleport.

Return ONLY JSON: { "teleport": boolean, "reason": "short explanation (under 20 words)" }

No markdown, no commentary.`;

interface TeleportCheckResult {
  teleport: boolean;
  reason: string;
}

/**
 * Use the LLM to judge whether the main subject's position change between two
 * shots constitutes a teleport (missing bridge shot). Loose — the LLM has
 * latitude to ignore trivial re-framings while flagging real jumps.
 *
 * Returns null (no warning) when:
 *   - no previous state / no target state
 *   - mainSubject missing from either state
 *   - positions identical or either is 'unknown'
 *   - character is off-screen in both states
 *   - this shot's continuityRole is entry/exit/bridge (explicit bridge shot)
 */
export async function checkPositionContinuity(
  prevState: SceneState | null,
  targetState: SceneState | null,
  mainSubjectRefId: string | null | undefined,
  shotContinuityRole: string | undefined,
  shotNumber: number,
  llm: {
    generateStream: (opts: any) => AsyncGenerator<
      { content?: string; thinking?: string; done?: boolean },
      any,
      any
    >;
  },
): Promise<ContinuityWarning | null> {
  if (!prevState || !targetState) return null;
  if (!mainSubjectRefId) return null;
  if (shotContinuityRole === 'entry' || shotContinuityRole === 'exit' || shotContinuityRole === 'bridge') {
    return null;
  }

  const prevChar = prevState.characters[mainSubjectRefId];
  const newChar = targetState.characters[mainSubjectRefId];
  if (!prevChar || !newChar) return null;

  // Skip unknown positions — can't reason about them
  if (prevChar.position === 'unknown' || newChar.position === 'unknown') return null;
  // Skip if positions are identical
  if (prevChar.position === newChar.position) return null;
  // Skip if character is off-screen in both (they legitimately went somewhere)
  if (!prevChar.inFrame && !newChar.inFrame) return null;

  const userPrompt = `Main subject refId: ${mainSubjectRefId}

Previous shot state:
- position: "${prevChar.position}"
- pose: ${prevChar.pose}
- inFrame: ${prevChar.inFrame}

Current shot state:
- position: "${newChar.position}"
- pose: ${newChar.pose}
- inFrame: ${newChar.inFrame}

Current shot's continuityRole: "${shotContinuityRole || 'none'}"

Is this a teleport?`;

  let rawContent = '';
  try {
    for await (const chunk of llm.generateStream({
      messages: [
        { role: 'system', content: TELEPORT_CHECK_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      responseFormat: { type: 'json_object' },
    })) {
      if (chunk.content) rawContent += chunk.content;
    }
  } catch {
    // LLM call failed — skip this check silently
    return null;
  }

  let parsed: TeleportCheckResult;
  try {
    let cleaned = rawContent.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    parsed = JSON.parse(cleaned) as TeleportCheckResult;
  } catch {
    return null;
  }

  if (!parsed.teleport) return null;

  return {
    scope: 'position',
    shotNumber,
    message: `Possible teleport for main subject "${mainSubjectRefId}" at shot ${shotNumber}: ${parsed.reason}`,
    suggestion: `Add a continuityRole of 'exit', 'bridge', or 'entry' — OR insert a bridge shot showing the subject moving between locations.`,
  };
}

// ── Formatting helpers ──────────────────────────────────────────────────────

/**
 * Format a warning list for logging (one line per warning).
 */
export function formatWarnings(warnings: ContinuityWarning[]): string {
  if (warnings.length === 0) return 'No continuity warnings';
  return warnings
    .map(w => `[${w.scope}:shot${w.shotNumber}] ${w.message}${w.suggestion ? ` — ${w.suggestion}` : ''}`)
    .join('\n');
}

// ── Auto-reroll decision ────────────────────────────────────────────────────

export interface RerollDecision {
  /** True when the warning indicates visible drift that a regeneration might fix. */
  reroll: boolean;
  /**
   * Text to inject into the next shot_image_prompt generation context so the
   * LLM can produce a bridging composition. Empty string when reroll is false.
   */
  hint: string;
}

/**
 * Decide whether a continuity warning warrants rerolling the shot_image_prompt
 * (with a hint injected) versus just logging.
 *
 * Policy:
 * - `position` warnings are LLM-judged teleports — high-signal. Reroll.
 * - `sequence` warnings are continuityRole bookkeeping issues — they need the
 *   LLM to re-plan scene beats, which a local reroll won't fix. Log only.
 */
export function shouldRerollShot(warning: ContinuityWarning | null): RerollDecision {
  if (!warning) return { reroll: false, hint: '' };

  if (warning.scope === 'position') {
    const suggestion = warning.suggestion ?? '';
    const hint =
      `\n\n<continuity_hint>\n` +
      `Continuity warning at shot ${warning.shotNumber}: ${warning.message}\n` +
      (suggestion ? `Fix: ${suggestion}\n` : '') +
      `Rewrite this shot to bridge the position change — the main subject should ` +
      `not appear to teleport. Prefer a composition that shows motion from the ` +
      `previous position, or explicitly mark this shot as continuityRole='bridge'.\n` +
      `</continuity_hint>`;
    return { reroll: true, hint };
  }

  return { reroll: false, hint: '' };
}
