/**
 * Resolves the ffmpeg / ffprobe binaries kshana-core should invoke.
 *
 * Why env-var-driven: packaged Electron apps can't depend on system
 * ffmpeg. macOS GUI apps don't inherit the user's shell $PATH, and
 * Windows users may not have ffmpeg installed at all. The desktop
 * wrapper bundles binaries via @ffmpeg-installer / @ffprobe-installer
 * and points kshana-core at them by setting these env vars before
 * kshana-core is imported.
 *
 * Server / CLI environments leave the env vars unset and fall back
 * to whichever `ffmpeg` / `ffprobe` is on PATH.
 *
 * Read at call time so the desktop can set the vars after kshana-core
 * has loaded if needed.
 */

export const FFMPEG_PATH_ENV = 'KSHANA_FFMPEG_PATH';
export const FFPROBE_PATH_ENV = 'KSHANA_FFPROBE_PATH';

export function getFfmpegPath(): string {
  const override = process.env[FFMPEG_PATH_ENV];
  return override && override.trim().length > 0 ? override : 'ffmpeg';
}

export function getFfprobePath(): string {
  const override = process.env[FFPROBE_PATH_ENV];
  return override && override.trim().length > 0 ? override : 'ffprobe';
}
