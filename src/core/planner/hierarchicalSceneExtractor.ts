/**
 * Hierarchical scene extractor.
 *
 * Replaces the old single-call `clusterBeatsIntoScenes` with a two-stage
 * flow that keeps each LLM call's output small (so none can hang the way
 * a 12k-token JSON-mode response does today):
 *
 *   Stage A (1 call):  story → scene summaries (titles + 80–150 word
 *                      summaries; no beat-level detail). Output is a few
 *                      hundred tokens regardless of story length.
 *
 *   Stage B (N calls): for each scene, the LLM gets the FULL story plus
 *                      that scene's summary, and returns just THAT
 *                      scene's beats. Calls run in parallel. The full
 *                      story is the input (no context loss); the chunking
 *                      is on the OUTPUT.
 *
 *   Stage C (pure):    stitch per-scene beats into a DurationFirstResult
 *                      with globally-renumbered beat ids and per-scene
 *                      durations summed from the beat durations.
 *
 * `runHierarchicalExtraction` is the orchestrator and the only public
 * entry point most callers will need. It wraps every LLM call in
 * `withTimeout` and retries each Stage B call once on failure — so a
 * single hung or rejected scene call doesn't kill the whole extraction.
 *
 * If anything throws (timeout, parse failure, structural validation
 * failure, retry exhausted), the orchestrator throws to the caller so
 * `runDurationFirstExtraction` can fall through to the legacy path.
 */
import type { LLMClient } from '../llm/index.js';
import { withTimeout } from '../llm/withTimeout.js';
import {
  type Beat,
  type BeatExtraction,
  type DurationFirstResult,
  computeBeatDuration,
  parseBeatExtraction,
} from './durationFirstExtractor.js';
import type { StoryEssence } from './storyEssenceExtractor.js';
import { compressOverlongScene, applySceneCompression } from './sceneCompressionPass.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface SceneSummary {
  sceneNumber: number;
  title: string;
  summary: string;
}

export interface HierarchicalConfig {
  /** Wall-clock cap per LLM call (ms). Default 90s — generous for short prompts. */
  perCallTimeoutMs?: number;
  /** Max retries per Stage B scene before giving up. Default 1 (so total ≤2 attempts). */
  maxRetriesPerScene?: number;
  /**
   * Editorial intent for the story. When provided, both Stage A and
   * Stage B prompts inject an `<essence>` block that asks the model
   * to (a) tune scene boundaries / beats to serve the throughline and
   * (b) optionally invent beats the source under-serves if doing so
   * strengthens the throughline. When undefined, the prompts run in
   * their plain "transcribe what's in the source" mode (backwards
   * compatible with the legacy fallback path).
   */
  essence?: StoryEssence;
}

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_RETRIES = 1;

/**
 * Recommend a scene-count range for a given target runtime. The legacy
 * extractor's "guidance, not a strict cap" framing produced 4 scenes for
 * a 60s drama; downstream beat counts then overshot ~5×. This range is
 * the upstream cap that keeps the rest of the pipeline honest.
 */
export function recommendedSceneRange(targetDuration: number): { min: number; max: number } {
  if (targetDuration <= 30) return { min: 1, max: 1 };
  if (targetDuration <= 60) return { min: 1, max: 2 };
  if (targetDuration <= 120) return { min: 2, max: 3 };
  if (targetDuration <= 240) return { min: 3, max: 5 };
  if (targetDuration <= 480) return { min: 4, max: 8 };
  return { min: 6, max: 12 };
}

const AVG_BEAT_SECONDS = 5;

// ── Stage A: scene summaries ────────────────────────────────────────────────

/** Format an essence block for injection into the system prompt. The
 * block grants the editorial license that lifts the extractor from
 * "transcribe the source" to "adapt the source for tone". */
function essenceBlock(e: StoryEssence): string {
  return [
    '<essence>',
    `GENRE: ${e.genre}`,
    `THROUGHLINE: ${e.throughline}`,
    `TONAL NOTES: ${e.tonalNotes}`,
    `DRAMATIC EMPHASIS: ${e.dramaticEmphasis}`,
    '',
    'Tune your output IN SERVICE OF this essence — not as decoration but as the editorial north star. Pick scene boundaries / beats that serve the throughline. Match the tonal weight (a 3-second lingering reaction shot IS a beat for an emotional drama; for an action thriller you\'d skip it).',
    '',
    'Editorial license: you MAY invent scenes or beats that are not literally in the source if doing so strengthens the throughline. The extractor is a screenwriter, not a transcriptionist. Prefer source material when it serves the essence; only invent when the source under-serves the essence and a small added beat (a silent reaction, an atmosphere shot, a brief breath) would make the audience feel what they\'re supposed to feel. Do NOT invent dialogue or major plot events; license is for atmospheric / reaction / connective beats that match the source\'s world.',
    '</essence>',
  ].join('\n');
}

const STAGE_A_SYSTEM_BASE = `You split a source story into the natural number of scenes for a cinematic short, and write a focused summary for each scene. SCENE-SUMMARY-EXTRACTOR-V1

A scene is a contiguous narrative unit: same location and/or contiguous in time. A scene change = location change OR time jump OR major dramatic shift. Decide how many scenes — driven by the story's natural breaks, not a target count. Minimum 1, maximum 12.

For each scene, output:
- "sceneNumber": 1-indexed
- "title": short label, ≤6 words
- "summary": 80–150 words covering location, characters present and their state-change in this scene, central dramatic action, any embedded connective beats named explicitly so the downstream writer can include them as subtext, and what's set up for the next scene.

Anti-patterns to avoid:
- Two adjacent scenes with the same location and similar action → merge.
- A scene whose summary doesn't reference its connective beats → downstream won't include them.

Return ONLY valid JSON, no markdown fences.

<json_schema>
{ "scenes": [
  { "sceneNumber": 1, "title": "Refusal and Flight", "summary": "80-150 word summary..." }
]}
</json_schema>`;

function buildStageASystem(essence?: StoryEssence): string {
  if (!essence) return STAGE_A_SYSTEM_BASE;
  return `${STAGE_A_SYSTEM_BASE}\n\n${essenceBlock(essence)}`;
}

interface StageAResponse {
  scenes: SceneSummary[];
}

function parseStageAResponse(raw: string): StageAResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Stage A returned invalid JSON: ${(err as Error).message}`);
  }
  const obj = parsed as { scenes?: unknown };
  if (!Array.isArray(obj.scenes)) {
    throw new Error('Stage A response missing "scenes" array');
  }
  if (obj.scenes.length === 0) {
    throw new Error('Stage A returned empty scenes array');
  }
  const scenes: SceneSummary[] = [];
  for (const s of obj.scenes) {
    const scene = s as { sceneNumber?: unknown; title?: unknown; summary?: unknown };
    if (typeof scene.sceneNumber !== 'number' ||
        typeof scene.title !== 'string' ||
        typeof scene.summary !== 'string') {
      throw new Error(`Stage A scene malformed: ${JSON.stringify(s)}`);
    }
    scenes.push({
      sceneNumber: scene.sceneNumber,
      title: scene.title.trim(),
      summary: scene.summary.trim(),
    });
  }
  return { scenes };
}

export async function extractSceneSummaries(
  storyContent: string,
  targetDuration: number,
  llm: LLMClient,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  essence?: StoryEssence,
): Promise<SceneSummary[]> {
  const range = recommendedSceneRange(targetDuration);
  const sceneCountLine = range.min === range.max
    ? `RECOMMENDED scene count: ${range.min} scene.`
    : `RECOMMENDED scene count: ${range.min}-${range.max} scenes.`;
  const userMsg = [
    `TARGET DURATION: ${targetDuration} seconds — treat this as a HARD BUDGET. Do not exceed it. Cap scene content so the sum of beat durations across all scenes fits this budget.`,
    sceneCountLine,
    `Pick scene boundaries that serve the story's natural breaks but stay within this range — fewer scenes are better than more for short targets.`,
    '',
    `SOURCE STORY:`,
    storyContent,
  ].join('\n');
  const response = await withTimeout(
    llm.generate({
      messages: [
        { role: 'system', content: buildStageASystem(essence) },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.1,
      responseFormat: { type: 'json_object' },
    }),
    timeoutMs,
    'stage-A-summaries',
  );
  return parseStageAResponse(response.content ?? '').scenes;
}

// ── Stage B: per-scene beats ────────────────────────────────────────────────

function buildStageBSystem(scene: SceneSummary, essence?: StoryEssence): string {
  const base = `You extract the beats that belong to ONE specific scene of a story. PER-SCENE-BEAT-EXTRACTOR-V1

<scene-number>${scene.sceneNumber}</scene-number>
<scene-title>${scene.title}</scene-title>
<scene-summary>${scene.summary}</scene-summary>

You will be given the full source story for context. Extract ONLY the beats that belong to the scene described above — ignore beats that belong to other scenes. The full story is provided so you can see surrounding context (what came before, what comes after) and pick exact dialogue, but do NOT emit beats that fall outside this scene's narrative unit.

A "beat" is one indivisible narrative unit: a single dialogue exchange, one physical action, one location-establishing shot, one reaction, one transition. Capture EVERY beat that belongs to this scene; do not skip beats; do not merge two beats into one. Connective beats (a character travels, time passes, mood shifts) get their own beat object.

For each beat, output:
- "id": "b1", "b2", ... (sequential within THIS scene; the orchestrator will renumber globally)
- "description": one sentence describing what happens
- "type": "dramatic" or "connective"
- "kind": one of: "dialogue", "action", "atmosphere", "reaction", "transition"
- "dialogue": exact spoken words verbatim from source if kind="dialogue", otherwise ""
- "speaker": name of the speaker if kind="dialogue", otherwise ""
- "characters": list of character names physically present in this beat
- "setting": short location label, consistent across beats in the same place

Also emit (deduped, only those who appear ON SCREEN in this scene's beats):
- "characters": deduplicated list of characters in this scene
- "settings": deduplicated list of distinct locations in this scene
- "objects": plot-critical props with consistent appearance (weapons, documents, distinctive artifacts; NEVER generic items)

Return ONLY valid JSON, no markdown fences.

<json_schema>
{
  "beats": [
    { "id": "b1", "description": "...", "type": "dramatic", "kind": "dialogue", "dialogue": "I will not.", "speaker": "Elara", "characters": ["Elara", "Father"], "setting": "family cottage" }
  ],
  "characters": ["Elara", "Father"],
  "settings": ["family cottage"],
  "objects": []
}
</json_schema>`;
  if (!essence) return base;
  return `${base}\n\n${essenceBlock(essence)}`;
}

export async function extractBeatsForScene(
  fullStoryContent: string,
  scene: SceneSummary,
  llm: LLMClient,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  essence?: StoryEssence,
  budgetSeconds?: number,
): Promise<BeatExtraction> {
  const userMsgParts = [`SOURCE STORY (full text, for context):\n${fullStoryContent}`];
  if (typeof budgetSeconds === 'number' && budgetSeconds > 0) {
    const beatCount = Math.max(2, Math.round(budgetSeconds / AVG_BEAT_SECONDS));
    userMsgParts.push(
      '',
      `BUDGET FOR THIS SCENE: ~${budgetSeconds.toFixed(1)} seconds of screen time, which fits roughly ${beatCount} beats at ~${AVG_BEAT_SECONDS}s each.`,
      `Group fine-grained moments into single beats so the total fits this budget. Prefer fewer, weightier beats over many small ones — combine adjacent micro-actions into one beat where they share the same intent.`,
    );
  }
  const response = await withTimeout(
    llm.generate({
      messages: [
        { role: 'system', content: buildStageBSystem(scene, essence) },
        { role: 'user', content: userMsgParts.join('\n') },
      ],
      temperature: 0.1,
      responseFormat: { type: 'json_object' },
    }),
    timeoutMs,
    `stage-B-scene-${scene.sceneNumber}`,
  );
  return parseBeatExtraction(response.content ?? '');
}

async function extractBeatsForSceneWithRetry(
  fullStoryContent: string,
  scene: SceneSummary,
  llm: LLMClient,
  timeoutMs: number,
  maxRetries: number,
  essence?: StoryEssence,
  budgetSeconds?: number,
): Promise<BeatExtraction> {
  let lastErr: Error | null = null;
  // attempts = 1 (initial) + maxRetries (additional tries)
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await extractBeatsForScene(fullStoryContent, scene, llm, timeoutMs, essence, budgetSeconds);
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw new Error(
    `Stage B failed for scene ${scene.sceneNumber} after ${maxRetries + 1} attempt(s): ${lastErr?.message ?? 'unknown'}`,
  );
}

// ── Stage C: stitch ─────────────────────────────────────────────────────────

/**
 * Combine per-scene beat extractions into a DurationFirstResult.
 *
 * - Renumber beats globally (b1, b2, ... continuing across scenes).
 * - Dedupe characters / settings / objects case-insensitively while
 *   preserving the original casing of the first occurrence.
 * - Compute per-beat durations and per-scene estimated durations.
 *
 * Pure — no LLM, no I/O.
 */
export function stitchScenes(
  summaries: SceneSummary[],
  perScene: BeatExtraction[],
  _targetDuration: number,
): DurationFirstResult {
  if (summaries.length !== perScene.length) {
    throw new Error(
      `stitchScenes: summary count (${summaries.length}) does not match per-scene count (${perScene.length})`,
    );
  }

  const allBeats: Beat[] = [];
  const beatDurations = new Map<string, number>();
  const scenes: DurationFirstResult['scenes'] = [];
  const charSet = new Map<string, string>(); // lowercase → original casing
  const settingSet = new Map<string, string>();
  const objectSet = new Map<string, string>();

  let globalCounter = 0;
  for (let i = 0; i < summaries.length; i++) {
    const summary = summaries[i]!;
    const sceneBeats = perScene[i]!;

    const sceneBeatIds: string[] = [];
    let sceneDuration = 0;
    for (const beat of sceneBeats.beats) {
      globalCounter++;
      const newId = `b${globalCounter}`;
      const renumbered: Beat = { ...beat, id: newId };
      const dur = computeBeatDuration(renumbered);
      allBeats.push(renumbered);
      beatDurations.set(newId, dur);
      sceneBeatIds.push(newId);
      sceneDuration += dur;
    }

    for (const c of sceneBeats.characters) {
      const key = c.trim().toLowerCase();
      if (!key || charSet.has(key)) continue;
      charSet.set(key, c.trim());
    }
    for (const s of sceneBeats.settings) {
      const key = s.trim().toLowerCase();
      if (!key || settingSet.has(key)) continue;
      settingSet.set(key, s.trim());
    }
    for (const o of sceneBeats.objects) {
      const key = o.trim().toLowerCase();
      if (!key || objectSet.has(key)) continue;
      objectSet.set(key, o.trim());
    }

    scenes.push({
      sceneNumber: summary.sceneNumber,
      title: summary.title,
      summary: summary.summary,
      beatIds: sceneBeatIds,
      estimatedDuration: sceneDuration,
    });
  }

  const totalEstimatedDuration = scenes.reduce((acc, s) => acc + s.estimatedDuration, 0);

  return {
    beats: allBeats,
    beatDurations,
    scenes,
    characters: Array.from(charSet.values()),
    settings: Array.from(settingSet.values()),
    objects: Array.from(objectSet.values()),
    totalEstimatedDuration,
  };
}

// ── Orchestrator ────────────────────────────────────────────────────────────

export async function runHierarchicalExtraction(
  storyContent: string,
  targetDuration: number,
  llm: LLMClient,
  config?: HierarchicalConfig,
): Promise<DurationFirstResult> {
  const timeoutMs = config?.perCallTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = config?.maxRetriesPerScene ?? DEFAULT_MAX_RETRIES;
  const essence = config?.essence;

  // Stage A
  const summaries = await extractSceneSummaries(storyContent, targetDuration, llm, timeoutMs, essence);

  // Stage B — parallel per-scene extraction with retry. Each scene gets a
  // duration budget = targetDuration / sceneCount (even split). The LLM
  // is told to group fine-grained moments so beat output fits the budget.
  const perSceneBudget = summaries.length > 0 ? targetDuration / summaries.length : undefined;
  const perScene = await Promise.all(
    summaries.map(s =>
      extractBeatsForSceneWithRetry(storyContent, s, llm, timeoutMs, maxRetries, essence, perSceneBudget),
    ),
  );

  // Stage C — stitch
  let result = stitchScenes(summaries, perScene, targetDuration);

  // Stage D — post-stitch compression. If total runtime exceeds the
  // hard ceiling (target + 20s), run a per-scene compression LLM call
  // for each over-budget scene that asks the model to embed connective
  // beats into the prose summary as subtext (no shot, no duration).
  // Re-stitch on the compressed result. Repeat once if still over —
  // beyond that, accept the overshoot rather than spin indefinitely.
  const HARD_CEILING_OVERSHOOT = 20;
  const hardCeiling = targetDuration + HARD_CEILING_OVERSHOOT;
  const beatIndex = new Map(result.beats.map(b => [b.id, b]));
  for (let pass = 0; pass < 2; pass++) {
    if (result.totalEstimatedDuration <= hardCeiling) break;

    // Identify over-budget scenes. Per-scene target is the global
    // target proportional to this scene's share of the current total.
    const overScenes = result.scenes.filter(s => s.estimatedDuration > targetDuration / result.scenes.length + HARD_CEILING_OVERSHOOT);
    const scenesToCompress = overScenes.length > 0 ? overScenes : result.scenes.filter(s => s.estimatedDuration > targetDuration);
    if (scenesToCompress.length === 0) break;

    const perSceneTarget = Math.max(targetDuration / result.scenes.length, 5);

    const compressionResults = await Promise.all(
      scenesToCompress.map(async (scene) => {
        const sceneBeats = scene.beatIds
          .map(id => beatIndex.get(id))
          .filter((b): b is Beat => b !== undefined);
        try {
          const r = await compressOverlongScene({
            scene: { sceneNumber: scene.sceneNumber, title: scene.title, summary: scene.summary },
            beats: sceneBeats,
            beatDurations: result.beatDurations,
            currentSec: scene.estimatedDuration,
            targetSec: perSceneTarget,
            llm,
            ...(typeof timeoutMs === 'number' ? { timeoutMs } : {}),
          });
          return { sceneNumber: scene.sceneNumber, embeds: r.embeddedBeatIds };
        } catch {
          return { sceneNumber: scene.sceneNumber, embeds: [] as string[] };
        }
      }),
    );

    // Apply compressions to the result.scenes (immutably)
    const updatedScenes = result.scenes.map(scene => {
      const cr = compressionResults.find(x => x.sceneNumber === scene.sceneNumber);
      if (!cr || cr.embeds.length === 0) return scene;
      return applySceneCompression(scene, cr.embeds, result.beatDurations);
    });

    // Re-stitch totals; beats list stays the same (we don't drop beats,
    // just reclassify them). beatDurations also stays — embedded beats
    // still have a computed duration, they're just excluded from
    // scene.estimatedDuration sums.
    const newTotal = updatedScenes.reduce((acc, s) => acc + s.estimatedDuration, 0);
    result = {
      ...result,
      scenes: updatedScenes,
      totalEstimatedDuration: newTotal,
    };
  }

  return result;
}
