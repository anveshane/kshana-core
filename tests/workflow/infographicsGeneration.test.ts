/**
 * Tests for infographics generation: render --output contract and (optional) render.mts e2e.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { sanitizeGeneratedComponentCode } from '../../src/tasks/video/tools.js';

const ROOT = join(process.cwd());
const FIXTURES = join(ROOT, 'tests', 'fixtures');
const REMOTION = join(ROOT, 'remotion-infographics');
const BUILD = join(REMOTION, 'build');

function runMockRender(inputPath: string, outDir: string, outputPath: string): { status: number; error?: unknown } {
  const r = spawnSync('node', [join(FIXTURES, 'mock-remotion-render.mjs'), '--input', inputPath, '--outDir', outDir, '--output', outputPath], {
    encoding: 'utf-8',
    cwd: ROOT,
  });
  if (r.error) return { status: -1, error: r.error };
  return { status: r.status ?? -1 };
}

describe('infographicsGeneration', () => {
  const TEMP = join(process.cwd(), 'test-temp-infographics');

  beforeEach(() => {
    if (existsSync(TEMP)) rmSync(TEMP, { recursive: true, force: true });
    mkdirSync(TEMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEMP)) rmSync(TEMP, { recursive: true, force: true });
  });

  describe('render --output contract (mock)', () => {
    it('mock script writes { outputs } to --output and exits 0', () => {
      const inputPath = join(TEMP, '_render_input.json');
      const outDir = join(TEMP, 'out');
      const outputPath = join(TEMP, '_render_output.json');
      const placements = [
        { placementNumber: 1, startTime: '0:00', endTime: '0:05', infographicType: 'statistic', prompt: 'Test.' },
        { placementNumber: 2, startTime: '0:05', endTime: '0:10', infographicType: 'list', prompt: 'Two.' },
      ];
      writeFileSync(inputPath, JSON.stringify({ placements }), 'utf-8');
      mkdirSync(outDir, { recursive: true });

      const { status } = runMockRender(inputPath, outDir, outputPath);
      expect(status).toBe(0);
      expect(existsSync(outputPath)).toBe(true);

      const out = JSON.parse(readFileSync(outputPath, 'utf-8')) as { outputs?: string[] };
      expect(Array.isArray(out.outputs)).toBe(true);
      expect(out.outputs).toHaveLength(2);
      expect(out.outputs![0]).toMatch(/info1_.*\.mp4$/);
      expect(out.outputs![1]).toMatch(/info2_.*\.mp4$/);
    });

    it('mock script with 0 placements writes { outputs: [] }', () => {
      const inputPath = join(TEMP, '_render_input.json');
      const outDir = join(TEMP, 'out');
      const outputPath = join(TEMP, '_render_output.json');
      writeFileSync(inputPath, JSON.stringify({ placements: [] }), 'utf-8');

      const { status } = runMockRender(inputPath, outDir, outputPath);
      expect(status).toBe(0);
      expect(existsSync(outputPath)).toBe(true);

      const out = JSON.parse(readFileSync(outputPath, 'utf-8')) as { outputs?: string[] };
      expect(out.outputs).toEqual([]);
    });
  });

  describe('generated component sanitization', () => {
    it('rewrites SVG id variable references into url(#id) strings', () => {
      const code = `const A = () => (
  <svg>
    <defs>
      <linearGradient id="waterGrad"><stop offset="0%" stopColor="#fff" /></linearGradient>
    </defs>
    <rect width="100" height="100" fill={waterGrad} />
  </svg>
);`;

      const sanitized = sanitizeGeneratedComponentCode(code);
      expect(sanitized).toContain('fill="url(#waterGrad)"');
      expect(sanitized).not.toContain('fill={waterGrad}');
    });
  });

  describe('render.mts e2e', () => {
    it('render.mts writes --output and produces outputs (skip if no build or SKIP_REMOTION_E2E)', () => {
      if (process.env.SKIP_REMOTION_E2E === '1') {
        return;
      }
      if (!existsSync(BUILD) || !existsSync(join(BUILD, 'index.html'))) {
        return;
      }

      const inputPath = join(TEMP, '_render_input.json');
      const outDir = join(TEMP, 'out');
      const outputPath = join(TEMP, '_render_output.json');
      const placements = [
        { placementNumber: 1, startTime: '0:00', endTime: '0:05', infographicType: 'statistic', prompt: 'E2E test.' },
      ];
      writeFileSync(inputPath, JSON.stringify({ placements }), 'utf-8');
      mkdirSync(outDir, { recursive: true });

      const r = spawnSync(
        'pnpm',
        ['run', 'render', '--', '--input', inputPath, '--outDir', outDir, '--output', outputPath],
        { encoding: 'utf-8', cwd: REMOTION, timeout: 120_000 }
      );

      expect(r.status).toBe(0);
      expect(r.error).toBeUndefined();
      expect(existsSync(outputPath)).toBe(true);

      const out = JSON.parse(readFileSync(outputPath, 'utf-8')) as { outputs?: string[] };
      expect(Array.isArray(out.outputs)).toBe(true);
      expect(out.outputs!.length).toBeGreaterThanOrEqual(1);
      const mp4 = out.outputs![0];
      expect(mp4).toMatch(/\.mp4$/);
      expect(existsSync(mp4)).toBe(true);
    });
  });
});
