/**
 * Video-render strategy resolver.
 *
 * Two strategies coexist:
 *
 *   - `prompt_relay` (default) — render a whole scene as one mp4 via
 *     LTX 2.3 + kijai/ComfyUI-PromptRelay. Each shot in the scene is a
 *     segment anchored by its first_frame; the model is patched with a
 *     temporal prompt schedule. Last frames are NOT generated in this
 *     mode (they're useless for relay rendering).
 *
 *   - `per_shot` — the existing FL2V flow: each shot is rendered
 *     independently with first + last frame anchors and a motion
 *     directive, then the per-shot mp4s are concatenated by FFmpeg.
 *
 * Selection: `KSHANA_VIDEO_STRATEGY=per_shot` opts out of the default.
 * Anything else (including the empty string and typos) resolves to
 * prompt_relay so a stray env value never crashes the pipeline.
 */

export type VideoStrategy = 'prompt_relay' | 'per_shot';

const DEFAULT_STRATEGY: VideoStrategy = 'prompt_relay';

export function getVideoStrategy(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): VideoStrategy {
  const raw = env['KSHANA_VIDEO_STRATEGY'];
  if (!raw) return DEFAULT_STRATEGY;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'per_shot') return 'per_shot';
  if (normalized === 'prompt_relay') return 'prompt_relay';
  return DEFAULT_STRATEGY;
}

export function isPromptRelayMode(env?: Record<string, string | undefined>): boolean {
  return getVideoStrategy(env) === 'prompt_relay';
}
