/**
 * Scene compression pass — Stage D of the hierarchical scene extractor.
 *
 * Runs ONE LLM call per overlong scene asking the model to identify
 * connective beats whose content can be carried in the scene's prose
 * summary as subtext rather than as their own shots. Those beats move
 * from `scene.beatIds[]` to `scene.embeddedBeatIds[]` and contribute
 * zero seconds to the scene's runtime.
 *
 * Constraints enforced post-LLM (validated in code, not just prompted):
 *   - Only beats with `type === 'connective'` may be embedded.
 *   - Dialogue beats (kind === 'dialogue') stay full regardless of
 *     type — they carry character voice.
 *   - All embedded beat IDs must be real beats from this scene.
 *
 * Background: when total stitched runtime exceeds `target + 20s`, the
 * legacy duration-first flow ran a single global compression call.
 * The hierarchical flow runs PER-SCENE compression so each call is
 * small, focused, and parallelizable.
 */
import type { LLMClient } from '../llm/index.js';
import { withTimeout } from '../llm/withTimeout.js';
import type { Beat } from './durationFirstExtractor.js';

const DEFAULT_TIMEOUT_MS = 90_000;

export interface SceneCompressionInput {
  scene: { sceneNumber: number; title: string; summary: string };
  /** All beats currently in this scene (full beats — embedded ones are
   * already filtered out by the caller before passing in). */
  beats: Beat[];
  /** Pure-code-computed durations for every beat in `beats`. */
  beatDurations: Map<string, number>;
  /** Current scene runtime in seconds (sum of beat durations). */
  currentSec: number;
  /** Target scene runtime in seconds. */
  targetSec: number;
  llm: LLMClient;
  timeoutMs?: number;
}

export interface SceneCompressionResult {
  /** Beat IDs the LLM chose to embed. Empty if the LLM judged no
   * compression possible. The caller should use `applySceneCompression`
   * to apply this result to a `DurationFirstResult.scenes[]` entry. */
  embeddedBeatIds: string[];
}

const SYSTEM_PROMPT = `You compress an overlong scene by moving connective beats from the scene's shot list into its prose-summary subtext. SCENE-COMPRESSION-V1

You will be given:
- The scene's title and summary
- The list of beats in this scene, each with id, type ("dramatic" or "connective"), kind ("dialogue", "action", "atmosphere", "reaction", "transition"), and duration in seconds
- The scene's CURRENT total runtime
- The scene's TARGET runtime

Your job: pick the connective beats whose content can be conveyed in the summary as a single mention or implication, freeing their seconds from the scene's runtime budget. These beats become "embedded" — they are referenced in the prose summary as subtext but produce NO separate shot.

HARD RULES:
- ONLY beats with type="connective" may be embedded. Dramatic beats stay full — they carry the scene's emotional spine.
- NEVER embed beats with kind="dialogue" — even connective dialogue lines carry character voice and must remain audible.
- Every embedded beat must be a real id from the input list.
- If you can compress to (or below) target by embedding qualifying beats, do so. If the scene is so dramatic-heavy that compression is impossible, return embeddedBeatIds=[] — better to overshoot the target than to lose dramatic content.

PRIORITY for embedding:
1. transition beats (highest priority — they're literally pacing connectors)
2. atmosphere beats with low information density
3. action connective beats whose content is implied by the next dramatic beat
4. reaction connective beats whose content is implied by the surrounding shots

Return ONLY valid JSON:

{
  "embeddedBeatIds": ["b3", "b7", ...]
}`;

interface CompressionResponse {
  embeddedBeatIds: string[];
}

function parseCompressionResponse(raw: string): CompressionResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`scene-compression returned invalid JSON: ${(err as Error).message}`);
  }
  const obj = parsed as { embeddedBeatIds?: unknown };
  if (!Array.isArray(obj.embeddedBeatIds)) {
    throw new Error('scene-compression response missing "embeddedBeatIds" array');
  }
  for (const id of obj.embeddedBeatIds) {
    if (typeof id !== 'string') {
      throw new Error(`scene-compression embeddedBeatIds must be strings, got: ${typeof id}`);
    }
  }
  return { embeddedBeatIds: obj.embeddedBeatIds as string[] };
}

function validateEmbedList(
  embeddedBeatIds: string[],
  beats: Beat[],
): void {
  const beatIndex = new Map(beats.map(b => [b.id, b]));
  for (const id of embeddedBeatIds) {
    const beat = beatIndex.get(id);
    if (!beat) {
      throw new Error(`scene-compression: unknown beat id "${id}" — not in this scene's beats`);
    }
    if (beat.type !== 'connective') {
      throw new Error(`scene-compression: cannot embed beat "${id}" — only connective beats may be embedded (got type=${beat.type})`);
    }
    if (beat.kind === 'dialogue') {
      throw new Error(`scene-compression: cannot embed beat "${id}" — dialogue beats carry character voice and must remain full`);
    }
  }
}

export async function compressOverlongScene(
  input: SceneCompressionInput,
): Promise<SceneCompressionResult> {
  const beatTable = input.beats
    .map(b => `  - ${b.id} [type=${b.type}, kind=${b.kind}, dur=${input.beatDurations.get(b.id) ?? '?'}s]: ${b.description}`)
    .join('\n');

  const userMsg = [
    `SCENE: #${input.scene.sceneNumber} — "${input.scene.title}"`,
    `SUMMARY: ${input.scene.summary}`,
    '',
    `CURRENT runtime: ${input.currentSec.toFixed(1)}s`,
    `TARGET runtime: ${input.targetSec.toFixed(1)}s`,
    `OVERSHOOT: ${(input.currentSec - input.targetSec).toFixed(1)}s`,
    '',
    'BEATS in this scene:',
    beatTable,
    '',
    `Pick which connective non-dialogue beats to embed so the runtime fits as close to target as possible.`,
  ].join('\n');

  const response = await withTimeout(
    input.llm.generate({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.1,
      responseFormat: { type: 'json_object' },
    }),
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    `scene-compression-${input.scene.sceneNumber}`,
  );

  const parsed = parseCompressionResponse(response.content ?? '');
  validateEmbedList(parsed.embeddedBeatIds, input.beats);
  return { embeddedBeatIds: parsed.embeddedBeatIds };
}

// ── Pure code helper to apply a compression result to a scene entry ──

export interface SceneEntry {
  sceneNumber: number;
  title: string;
  summary: string;
  beatIds: string[];
  embeddedBeatIds?: string[];
  estimatedDuration: number;
}

/**
 * Apply a list of `embeddedBeatIds` to a scene: move them out of
 * `beatIds` into `embeddedBeatIds` and recompute the scene's
 * `estimatedDuration` from remaining `beatIds`. Returns a NEW scene
 * object — does not mutate the input.
 *
 * Beats already in `embeddedBeatIds` (from prior passes) are preserved.
 */
export function applySceneCompression(
  scene: SceneEntry,
  newEmbeds: string[],
  beatDurations: Map<string, number>,
): SceneEntry {
  const newEmbedSet = new Set(newEmbeds);
  const remainingBeatIds = scene.beatIds.filter(id => !newEmbedSet.has(id));
  const allEmbedded = [...(scene.embeddedBeatIds ?? []), ...newEmbeds];
  const newDuration = remainingBeatIds.reduce(
    (acc, id) => acc + (beatDurations.get(id) ?? 0),
    0,
  );
  return {
    sceneNumber: scene.sceneNumber,
    title: scene.title,
    summary: scene.summary,
    beatIds: remainingBeatIds,
    embeddedBeatIds: allEmbedded,
    estimatedDuration: newDuration,
  };
}
