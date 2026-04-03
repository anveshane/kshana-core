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

const shotSchema = z.object({
  shotNumber: z.number(),
  shotType: z.string().optional(),
  duration: z.number().optional(),
  generationStrategy: z.string().optional(),
  videoGenerationMode: z.string().optional(),
  firstFrame: frameDescriptionSchema.optional(),
  lastFrame: frameDescriptionSchema.optional(),
  // Legacy format: description at top level
  description: z.string().optional(),
  cameraWork: z.string().optional(),
  soundCue: z.string().optional(),
  transition: z.string().optional(),
  dialogue: z.string().nullable().optional(),
  characters: z.array(z.string()).optional(),
  setting: z.string().nullable().optional(),
}).refine(
  (shot) => shot.firstFrame?.description || shot.description,
  { message: 'Shot must have either firstFrame.description or description' },
);

export const sceneVideoPromptSchema = z.object({
  sceneNumber: z.number().optional(),
  sceneTitle: z.string().optional(),
  totalDuration: z.number().optional(),
  shots: z.array(shotSchema).min(1, 'shots array must not be empty'),
});

// ── Shot Image Prompt (single-frame) ─────────────────────────────────────────

const referenceSchema = z.object({
  imageNumber: z.number(),
  type: z.enum(['character', 'setting']),
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
  scenes: z.array(z.object({
    sceneNumber: z.number(),
    title: z.string(),
    summary: z.string().optional(),
  })).optional().default([]),
});

// ── Schema registry ──────────────────────────────────────────────────────────

export const JSON_SCHEMAS: Record<string, z.ZodSchema> = {
  scene_video_prompt: sceneVideoPromptSchema,
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
  const PROMPT_SCHEMAS: Record<string, string> = {
    scene_video_prompt: `<json_schema>
{
  "sceneNumber": number,
  "sceneTitle": "string",
  "totalDuration": number,
  "shots": [
    {
      "shotNumber": number,
      "shotType": "string (establishing, tracking, medium, close_up, wide, extreme_close_up)",
      "duration": number,
      "generationStrategy": "i2v | flfv | fmlfv | i2v_late_entry",
      "firstFrame": {
        "description": "string (detailed cinematographer prose)",
        "characters": ["character_id"],
        "setting": "setting_id"
      },
      "lastFrame": {
        "description": "string (optional — only when end state differs from start)",
        "characters": ["character_id"],
        "setting": "setting_id"
      },
      "cameraWork": "string",
      "soundCue": "string",
      "transition": "cut | crossfade | dip_to_black | fade"
    }
  ]
}
</json_schema>`,
    shot_image_prompt: `<json_schema>
For single-frame shots (i2v):
{
  "imagePrompt": "string (80-250 words, flowing prose)",
  "negativePrompt": "string",
  "aspectRatio": "16:9",
  "generationMode": "image_text_to_image | text_to_image",
  "references": [{ "imageNumber": number, "type": "character | setting", "refId": "string" }]
}

For multi-frame shots (flfv — first + last):
{
  "shotNumber": number,
  "frames": {
    "first_frame": { "imagePrompt": "string", "generationMode": "image_text_to_image", "references": [...] },
    "last_frame": { "imagePrompt": "string (delta only)", "generationMode": "edit_first_frame", "references": [] }
  },
  "negativePrompt": "string",
  "aspectRatio": "16:9"
}

For multi-frame shots (fmlfv — first + mid + last):
{
  "shotNumber": number,
  "frames": {
    "first_frame": { "imagePrompt": "string", "generationMode": "image_text_to_image", "references": [...] },
    "mid_frame": { "imagePrompt": "string (delta from first)", "generationMode": "edit_first_frame", "references": [] },
    "last_frame": { "imagePrompt": "string (delta from first)", "generationMode": "edit_first_frame", "references": [] }
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
  };

  return PROMPT_SCHEMAS[nodeTypeId] ?? null;
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
    // Auto-classify if both are missing
    if (!shot.videoGenerationMode && !shot.generationStrategy) {
      const hasCharsFirst = (shot.firstFrame?.characters?.length ?? 0) > 0;
      const hasCharsLast = (shot.lastFrame?.characters?.length ?? 0) > 0;
      if (!hasCharsFirst && !hasCharsLast) shot.generationStrategy = 'i2v'; // was t2v, now always i2v
      else if (hasCharsFirst) shot.generationStrategy = 'i2v';
      else shot.generationStrategy = 'i2v_late_entry';
    }
    // Normalize: copy videoGenerationMode → generationStrategy
    if (shot.videoGenerationMode && !shot.generationStrategy) {
      shot.generationStrategy = shot.videoGenerationMode;
    }
  }
}
