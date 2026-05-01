/**
 * Classify a file path emitted by ExecutorAgent as 'image' | 'video' | null.
 *
 * Used by the in-process runner to decide whether a `tool_result`
 * event's `result.file_path` should be surfaced as a standalone chat
 * event (so the user sees the just-generated frame / clip in the
 * chat timeline). Replaces the stdout-line scanner that scripts/
 * subprocesses used to need.
 *
 * Pure — no I/O. Returns null when the path doesn't look like an
 * asset of a known type.
 */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov']);

export function classifyExecutorAsset(
  path: string | null | undefined,
): 'image' | 'video' | null {
  if (!path) return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith('/')) return null;
  // Use only the basename's last dot-segment; directory names with
  // dots (e.g. `my.project/foo.png`) shouldn't confuse us.
  const lastSlash = trimmed.lastIndexOf('/');
  const base = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
  const lastDot = base.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === base.length - 1) return null;
  const ext = base.slice(lastDot + 1).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}
