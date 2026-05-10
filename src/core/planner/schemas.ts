/**
 * Zod schemas for all JSON-output node types.
 *
 * Single source of truth — used for:
 * 1. Runtime validation of LLM JSON output (replaces hardcoded if/else chains)
 * 2. Generating <json_schema> blocks injected into system prompts
 * 3. Auto-normalization (e.g., videoGenerationMode → generationStrategy)
 */

import { z } from 'zod';

// ── Frame description (shared by firstFrame / lastFrame / midFrame) ──────────

const frameDescriptionSchema = z.object({
  description: z.string().min(1),
  characters: z.array(z.string()).optional().default([]),
  setting: z.string().nullable().optional(),
});

// ── Scene Video Prompt ───────────────────────────────────────────────────────

// Shot purpose — WHY this shot exists in the story
export const purposeValues = [
  'set_the_world', 'set_the_mood', 'meet_character', 'show_tension',
  'show_action', 'show_reaction', 'show_dialogue', 'show_clue',
  'show_passage', 'hold_emotion', 'show_change', 'punctuate',
] as const;

const purposeEnum = z.enum(purposeValues);

// Perspective — whose POV the shot is from
export const perspectiveValues = [
  'main_subject',       // POV or OTS of the scene's main subject
  'secondary_subject',  // POV or OTS of the secondary subject
  'overhead',           // high-angle, looking down
  'god',                // impossible omniscient viewpoint (extreme wide / birds_eye)
  'observer',           // neutral third-person, not tied to any character
] as const;

const perspectiveEnum = z.enum(perspectiveValues);

// Continuity role — how the shot bridges to adjacent shots for the main subject
export const continuityRoleValues = [
  'entry',   // main subject enters this shot (new location arrival)
  'exit',    // main subject leaves this shot (rising, walking to door)
  'bridge',  // travel/montage beat between locations
  'none',    // not a bridging shot
] as const;

const continuityRoleEnum = z.enum(continuityRoleValues);

// Focus — what's sharp vs blurred in the frame
const focusSchema = z.object({
  primary: z.string().min(1),                              // razor-sharp subject (refId or prose name)
  background: z.array(z.string()).optional().default([]), // visible but blurred elements
  lurking: z.string().nullable().optional(),              // planted defocused element for a later focus-pull
});

const shotSchema = z.object({
  shotNumber: z.number(),
  purpose: purposeEnum.optional(),
  // shotType removed — cameraWork already contains framing info as natural prose
  // secondaryPurpose removed — description captures dual-intent naturally
  shotType: z.string().optional(), // legacy compat only, not used by code
  duration: z.number().optional(),
  generationStrategy: z.string().optional(),
  videoGenerationMode: z.string().optional(),
  firstFrame: frameDescriptionSchema.optional(),
  lastFrame: frameDescriptionSchema.optional(),
  // Legacy format: description at top level
  description: z.string().optional(),
  cameraWork: z.string().optional(),
  soundCue: z.string().optional(),
  audio: z.string().optional(),
  transition: z.string().optional(),
  dialogue: z.string().nullable().optional(),
  characters: z.array(z.string()).optional(),
  setting: z.string().nullable().optional(),
  // Perspective: whose POV this shot is from (required for show_action/meet_character)
  perspective: perspectiveEnum.optional(),
  // refId of whose POV/OTS — defaults to scene.mainSubject when perspective is main_subject
  perspectiveOf: z.string().nullable().optional(),
  // Focus: what's sharp vs blurred in the frame
  focus: focusSchema.optional(),
  // How this shot bridges locations for the main subject (prevents teleporting)
  continuityRole: continuityRoleEnum.optional().default('none'),
}).refine(
  (shot) => shot.firstFrame?.description || shot.description,
  { message: 'Shot must have either firstFrame.description or description' },
).refine(
  (shot) => {
    // show_action and meet_character shots must specify perspective
    if (shot.purpose === 'show_action' || shot.purpose === 'meet_character') {
      return !!shot.perspective;
    }
    return true;
  },
  { message: 'show_action and meet_character shots must specify perspective' },
);

// Stage B output: a single fully-expanded shot. Same shape as the entries
// in sceneVideoPromptSchema.shots; exported so the executor can validate
// per-shot LLM output without going through the full scene wrapper.
export const singleShotSchema = shotSchema;

// Stage A output: the lightweight shot plan emitted by the scene_shot_plan
// LLM call. One entry per shot — pacing/structure decisions only, no prose.
// The collection-expansion step uses this to spawn one shot_breakdown node
// per planned shot.
export const shotPlanEntrySchema = z.object({
  shotNumber: z.number(),
  purpose: purposeEnum,
  duration: z.number(),
  oneLineSummary: z.string().min(1),
  perspective: perspectiveEnum.optional(),
  continuityRole: continuityRoleEnum.optional(),
});

export const shotPlanSchema = z.object({
  sceneNumber: z.number(),
  sceneTitle: z.string(),
  totalDuration: z.number(),
  mainSubject: z.string(),
  secondarySubject: z.string().nullable().optional(),
  entry: z.string().optional(),
  exit: z.string().optional(),
  shotPlan: z.array(shotPlanEntrySchema).min(1, 'shotPlan must not be empty'),
});

export const sceneVideoPromptSchema = z.object({
  sceneNumber: z.number().optional(),
  sceneTitle: z.string().optional(),
  totalDuration: z.number().optional(),
  // The character whose arc this scene follows — shot perspectives are relative to this
  mainSubject: z.string().optional(),
  // Optional second pivotal character (for dialogue/reaction reversals)
  secondarySubject: z.string().nullable().optional(),
  // Scene transitions (Layer C1). Each scene declares how it visually
  // picks up from the prior scene (`entry`) and how it sets up the next
  // (`exit`). The image pipeline uses these to chain scene_N_shot_1's
  // first_frame on scene_(N-1)'s last shot's last_frame.
  entry: z.string().optional(),
  exit: z.string().optional(),
  shots: z.array(shotSchema).min(1, 'shots array must not be empty'),
}).refine(
  (svp) => {
    // If any shot uses main_subject perspective, scene must declare mainSubject
    const needsMain = svp.shots.some(s => s.perspective === 'main_subject');
    if (needsMain && !svp.mainSubject) return false;
    // Same for secondary_subject
    const needsSecondary = svp.shots.some(s => s.perspective === 'secondary_subject');
    if (needsSecondary && !svp.secondarySubject) return false;
    return true;
  },
  { message: 'Scene must declare mainSubject/secondarySubject when shots reference those perspectives' },
);

// ── Shot Image Prompt (single-frame) ─────────────────────────────────────────

const referenceSchema = z.object({
  imageNumber: z.number(),
  type: z.enum(['character', 'setting', 'object']),
  refId: z.string(),
});

const singleFrameImagePromptSchema = z.object({
  imagePrompt: z.string().min(1),
  negativePrompt: z.string().optional().default(''),
  aspectRatio: z.string().optional().default('16:9'),
  generationMode: z.string(),
  references: z.array(referenceSchema).optional().default([]),
});

// ── Shot Image Prompt (multi-frame: FLFV / FMLFV) ───────────────────────────

const framePromptSchema = z.object({
  imagePrompt: z.string().min(1),
  generationMode: z.string(),
  references: z.array(referenceSchema).optional().default([]),
});

const multiFrameImagePromptSchema = z.object({
  shotNumber: z.number().optional(),
  generationStrategy: z.string().optional(),
  frames: z.object({
    first_frame: framePromptSchema,
    mid_frame: framePromptSchema.optional(),
    last_frame: framePromptSchema.optional(),
  }),
  negativePrompt: z.string().optional().default(''),
  aspectRatio: z.string().optional().default('16:9'),
});

// Combined: accepts either single-frame or multi-frame
export const shotImagePromptSchema = z.union([
  multiFrameImagePromptSchema,
  singleFrameImagePromptSchema,
]);

// ── Character / Setting Image ────────────────────────────────────────────────

export const imagePromptSchema = z.object({
  imagePrompt: z.string().min(1, 'imagePrompt is required'),
  negativePrompt: z.string().min(1, 'negativePrompt is required'),
  aspectRatio: z.string().min(1, 'aspectRatio is required'),
});

// ── Collection Extraction ────────────────────────────────────────────────────

export const collectionExtractionSchema = z.object({
  characters: z.array(z.string()).optional().default([]),
  settings: z.array(z.string()).optional().default([]),
  objects: z.array(z.string()).optional().default([]),
  scenes: z.array(z.object({
    sceneNumber: z.number(),
    title: z.string(),
    summary: z.string().optional(),
  })).optional().default([]),
});

// ── Schema registry ──────────────────────────────────────────────────────────

export const JSON_SCHEMAS: Record<string, z.ZodSchema> = {
  scene_video_prompt: sceneVideoPromptSchema,
  scene_shot_plan: shotPlanSchema,
  shot_breakdown: singleShotSchema,
  shot_image_prompt: shotImagePromptSchema,
  character_image: imagePromptSchema,
  setting_image: imagePromptSchema,
};

// ── Prompt schema text generation ────────────────────────────────────────────

/**
 * Generate a <json_schema> block for injection into LLM system prompts.
 * Derived from the Zod schemas — always in sync with validation.
 */
export function getPromptSchema(nodeTypeId: string): string | null {
  // Schemas are GENERATED from shared constants (purposeValues, shotTypeValues)
  // so they can never drift from the guide or validation logic.
  const PROMPT_SCHEMAS: Record<string, string> = {
    scene_video_prompt: `<json_schema>
{
  "sceneNumber": number,
  "sceneTitle": "string",
  "totalDuration": number,
  "mainSubject": "string (refId of the character whose arc this scene follows — e.g., 'vikram')",
  "secondarySubject": "string (optional refId of a second pivotal character — e.g., 'laila')",
  "shots": [
    {
      "shotNumber": number,
      "purpose": "${purposeValues.join(' | ')}",
      "duration": number,
      "description": "string (1-2 sentence brief of what happens in this shot)",
      "cameraWork": "string (start with framing: wide/medium/close-up/extreme close-up, then angle and movement)",
      "perspective": "${perspectiveValues.join(' | ')} (REQUIRED for show_action and meet_character; whose POV we see the shot from)",
      "perspectiveOf": "string (optional refId — who owns the POV/OTS; defaults to mainSubject for main_subject perspective)",
      "focus": {
        "primary": "string (refId or prose — what is razor-sharp in the frame)",
        "background": ["string (visible but blurred elements)"],
        "lurking": "string | null (defocused element planted for a later focus-pull — optional)"
      },
      "continuityRole": "${continuityRoleValues.join(' | ')} (entry/exit/bridge for location transitions of mainSubject; 'none' otherwise)",
      "audio": "string (dialogue prefixed with CHARACTER NAME: + ambient sounds)",
      "transition": "cut | crossfade | fade | dip_to_black | flash_to_white | circle_close | circle_open | wipe_left | wipe_right"
    }
  ]
}
</json_schema>`,
    shot_image_prompt: `<json_schema>
{
  "shotNumber": number,
  "generationStrategy": "flfv",
  "frames": {
    "first_frame": {
      "imagePrompt": "string (flowing prose, frozen instant, no motion verbs)",
      "generationMode": "image_text_to_image | edit_previous_shot | text_to_image",
      "references": [{ "imageNumber": number, "type": "character | setting | object", "refId": "string" }]
    },
    "last_frame": {
      "imagePrompt": "string (describe the END STATE — what has changed by the end of this shot, per <last_frame_changes>)",
      "generationMode": "edit_first_frame",
      "references": []
    }
  },
  "negativePrompt": "string",
  "aspectRatio": "16:9"
}
</json_schema>`,
    character_image: `<json_schema>
{
  "imagePrompt": "string (80-250 words, flowing prose, full character description)",
  "negativePrompt": "string",
  "aspectRatio": "1:1"
}
</json_schema>`,
    setting_image: `<json_schema>
{
  "imagePrompt": "string (flowing prose, full environment description with 3 spatial layers)",
  "negativePrompt": "string",
  "aspectRatio": "1:1"
}
</json_schema>`,
    scene_shot_plan: `<json_schema>
{
  "sceneNumber": number,
  "sceneTitle": "string",
  "totalDuration": number,
  "mainSubject": "string (refId of the character whose arc this scene follows — e.g., 'vikram')",
  "secondarySubject": "string | null (optional refId of a second pivotal character — e.g., 'laila'; null/omit if none)",
  "entry": "string (one-sentence description of how this scene visually picks up from the prior scene)",
  "exit": "string (one-sentence description of how this scene sets up the next scene)",
  "shotPlan": [
    {
      "shotNumber": number,
      "purpose": "${purposeValues.join(' | ')}",
      "duration": number,
      "oneLineSummary": "string (one sentence: what happens in this shot)",
      "perspective": "${perspectiveValues.join(' | ')} (optional at plan stage; required for show_action / meet_character)",
      "continuityRole": "${continuityRoleValues.join(' | ')} (optional — entry/exit/bridge for location transitions of mainSubject; 'none' otherwise)"
    }
  ]
}
</json_schema>`,
    shot_breakdown: `<json_schema>
{
  "shotNumber": number,
  "purpose": "${purposeValues.join(' | ')}",
  "duration": number,
  "description": "string (1-2 sentence brief of what happens in this shot — expand the plan's oneLineSummary)",
  "cameraWork": "string (start with framing: wide/medium/close-up/extreme close-up, then angle and movement)",
  "perspective": "${perspectiveValues.join(' | ')} (REQUIRED for show_action and meet_character; whose POV we see the shot from)",
  "perspectiveOf": "string (optional refId — who owns the POV/OTS; defaults to mainSubject for main_subject perspective)",
  "focus": {
    "primary": "string (refId or prose — what is razor-sharp in the frame)",
    "background": ["string (visible but blurred elements)"],
    "lurking": "string | null (defocused element planted for a later focus-pull — optional)"
  },
  "continuityRole": "${continuityRoleValues.join(' | ')} (entry/exit/bridge for location transitions of mainSubject; 'none' otherwise)",
  "audio": "string (dialogue prefixed with CHARACTER NAME: + ambient sounds)",
  "transition": "cut | crossfade | fade | dip_to_black | flash_to_white | circle_close | circle_open | wipe_left | wipe_right"
}
</json_schema>`,
  };

  return PROMPT_SCHEMAS[nodeTypeId] ?? null;
}

// ── Token budget for JSON-output nodes ───────────────────────────────────────

/**
 * maxTokens budget for JSON-output LLM calls.
 *
 * Legacy: scene_video_prompt with 5–7 shots regularly exceeded 5000 tokens,
 * producing mid-stream truncation and "Unexpected end of JSON input" parse
 * errors. Bumped to 12000 specifically for that node type. (To be removed
 * once the hierarchical path is the only path — scene_video_prompt becomes
 * a deterministic assembler with no LLM call.)
 *
 * New (hierarchical):
 *  - scene_shot_plan (Stage A): emits a small plan, ~500-1500 tokens. 3000 budget is generous.
 *  - shot_breakdown (Stage B): one shot at a time, ~600-1000 tokens. 3000 budget is generous.
 *
 * Other JSON nodes (shot_image_prompt, character_image, setting_image) are
 * single-frame or tightly bounded and stay at 5000.
 */
export function maxTokensForJsonNode(nodeTypeId: string): number {
  if (nodeTypeId === 'scene_video_prompt') return 12000;
  if (nodeTypeId === 'scene_shot_plan') return 3000;
  if (nodeTypeId === 'shot_breakdown') return 3000;
  return 5000;
}

// ── Validation helper ────────────────────────────────────────────────────────

/**
 * Validate parsed JSON against the schema for a given node type.
 * Returns { valid: true, data } on success, { valid: false, error } on failure.
 */
export function validateWithSchema(
  nodeTypeId: string,
  parsed: unknown,
): { valid: true; data: unknown } | { valid: false; error: string } {
  const schema = JSON_SCHEMAS[nodeTypeId];
  if (!schema) {
    // No schema defined — accept anything
    return { valid: true, data: parsed };
  }

  const result = schema.safeParse(parsed);
  if (result.success) {
    return { valid: true, data: result.data };
  }

  // Format Zod errors into a readable string
  const errors = result.error.issues.map(issue => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return { valid: false, error: errors.join('; ') };
}

/**
 * Auto-normalize scene_video_prompt data after validation.
 * Copies videoGenerationMode → generationStrategy for backward compat.
 */
export function normalizeSceneVideoPrompt(parsed: z.infer<typeof sceneVideoPromptSchema>): void {
  for (const shot of parsed.shots) {
    // Normalize: copy videoGenerationMode → generationStrategy for backward compat
    if (shot.videoGenerationMode && !shot.generationStrategy) {
      shot.generationStrategy = shot.videoGenerationMode;
    }
    // Note: generationStrategy is now determined by shot_image_prompt, not scene_video_prompt.
    // Don't default to flfv here — let the downstream reader check shot_image_prompt output.
  }
}

/**
 * Auto-normalize shot_image_prompt data after validation.
 *
 * For edit_first_frame / edit_previous_shot frames, MERGE first_frame's
 * references into the frame's references so that:
 *   - Empty references → inherit all of first_frame's refs
 *   - Non-empty references (e.g., last_frame introducing a NEW character)
 *     → keep the explicit refs AND add first_frame's refs that aren't
 *       already present (preserves continuity of existing subjects).
 *
 * Dedup is by `refId`. Order: last_frame's explicit refs first (preserving
 * their imageNumber for prose correspondence), then inherited refs after.
 */
export function normalizeShotImagePrompt(parsed: unknown): void {
  if (!parsed || typeof parsed !== 'object') return;
  const p = parsed as { frames?: Record<string, { generationMode?: string; references?: unknown[] }> };
  if (!p.frames || typeof p.frames !== 'object') return;

  const firstFrame = p.frames['first_frame'];
  const firstRefs = (Array.isArray(firstFrame?.references) ? firstFrame!.references : []) as Array<{ refId?: string }>;
  if (firstRefs.length === 0) return; // nothing to inherit

  for (const [frameId, frame] of Object.entries(p.frames)) {
    if (frameId === 'first_frame' || !frame) continue;
    const mode = frame.generationMode;
    if (mode !== 'edit_first_frame' && mode !== 'edit_previous_shot') continue;

    const currentRefs = (Array.isArray(frame.references) ? frame.references : []) as Array<{ refId?: string }>;
    if (currentRefs.length === 0) {
      // Fully inherit
      frame.references = [...firstRefs];
      continue;
    }

    // Merge: keep explicit refs first, then append first_frame refs missing by refId
    const existingIds = new Set(
      currentRefs.map(r => r?.refId).filter((id): id is string => typeof id === 'string'),
    );
    const toAdd = firstRefs.filter(r => r?.refId && !existingIds.has(r.refId));
    if (toAdd.length > 0) {
      frame.references = [...currentRefs, ...toAdd];
    }
  }
}
