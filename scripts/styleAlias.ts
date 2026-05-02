/**
 * Resolve user-friendly style aliases to canonical names.
 *
 *   live / live_action / realism / realistic / cinematic / cinematic_realism → cinematic_realism
 *   anime / animation / animated / cartoon → anime
 *
 * Returns null for unknown values; caller prints usage and exits.
 *
 * Lives in its own module so unit tests can import the helper without
 * triggering new-project.ts's CLI entry point.
 */
export function resolveStyle(input: string): string | null {
  const lower = input.toLowerCase().trim();
  const liveAction = new Set([
    'live', 'live-action', 'live_action', 'liveaction',
    'realism', 'realistic', 'cinematic', 'cinematic_realism',
    'photorealistic', 'real',
  ]);
  const animation = new Set([
    'anime', 'animation', 'animated', 'cartoon', '2d', 'illustrated',
  ]);
  if (liveAction.has(lower)) return 'cinematic_realism';
  if (animation.has(lower)) return 'anime';
  return null;
}
