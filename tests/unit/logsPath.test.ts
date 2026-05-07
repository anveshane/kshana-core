/**
 * `getLogsDir` / `setLogsDir` — single source of truth for where loggers
 * write. Each logger used to hardcode `./logs` relative to cwd, which
 * meant a packaged Electron app (cwd = .app bundle, read-only on macOS)
 * silently dropped logs. This module gives the host (kshana-desktop) a
 * single knob to point everything at `app.getPath('userData')/logs` or
 * any other writable dir.
 *
 * Resolution order (highest → lowest):
 *   1. value set via `setLogsDir(absPath)` at runtime
 *   2. `KSHANA_LOGS_DIR` env var (handy for tests / CI)
 *   3. fallback: `<repoRoot>/logs` for dev (preserves today's behavior)
 *   4. ultimate fallback: `<cwd>/logs`
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getLogsDir,
  setLogsDir,
  resetLogsDirForTest,
} from '../../src/utils/logsPath.js';

let priorEnv: string | undefined;

beforeEach(() => {
  priorEnv = process.env['KSHANA_LOGS_DIR'];
  delete process.env['KSHANA_LOGS_DIR'];
  resetLogsDirForTest();
});

afterEach(() => {
  if (priorEnv === undefined) delete process.env['KSHANA_LOGS_DIR'];
  else process.env['KSHANA_LOGS_DIR'] = priorEnv;
  resetLogsDirForTest();
});

describe('getLogsDir', () => {
  it('returns an absolute path', () => {
    const dir = getLogsDir();
    expect(isAbsolute(dir)).toBe(true);
  });

  it('honors KSHANA_LOGS_DIR when set and no runtime override is in place', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'kshana-logs-env-'));
    try {
      process.env['KSHANA_LOGS_DIR'] = tmp;
      resetLogsDirForTest();
      expect(getLogsDir()).toBe(tmp);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('expands a leading ~ in KSHANA_LOGS_DIR', () => {
    process.env['KSHANA_LOGS_DIR'] = '~/kshana-test-logs';
    resetLogsDirForTest();
    const out = getLogsDir();
    expect(out.startsWith('~')).toBe(false);
    expect(isAbsolute(out)).toBe(true);
    expect(out.endsWith('/kshana-test-logs')).toBe(true);
  });

  it('lets setLogsDir override the env var', () => {
    const envDir = mkdtempSync(join(tmpdir(), 'kshana-logs-env-'));
    const overrideDir = mkdtempSync(join(tmpdir(), 'kshana-logs-override-'));
    try {
      process.env['KSHANA_LOGS_DIR'] = envDir;
      resetLogsDirForTest();
      setLogsDir(overrideDir);
      expect(getLogsDir()).toBe(overrideDir);
    } finally {
      rmSync(envDir, { recursive: true, force: true });
      rmSync(overrideDir, { recursive: true, force: true });
    }
  });

  it('rejects a relative path passed to setLogsDir', () => {
    expect(() => setLogsDir('relative/logs')).toThrow(/absolute/i);
  });

  it('falls back to a path that exists when nothing is configured', () => {
    // No env, no override — exercise the fallback. Must return a real dir
    // so loggers can append to files inside it.
    const dir = getLogsDir();
    // The fallback creates the dir if needed (loggers expect it to exist).
    expect(existsSync(dir)).toBe(true);
  });
});
