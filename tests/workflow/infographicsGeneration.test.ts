/**
 * Tests for infographics generation: render --output contract and (optional) render.mts e2e.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import {
  classifyInfographicQualityFailures,
  normalizeRemotionProgress,
  sanitizeGeneratedComponentCode,
  validateInfographicQuality,
} from '../../src/tasks/video/tools.js';

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

  describe('generated component quality validation', () => {
    it('accepts valid transparent, prompt-driven frame animation component', () => {
      const code = `
import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
type Props = {prompt: string; infographicType: string; data?: Record<string, unknown>};
export const Infographic1: React.FC<Props> = ({prompt, infographicType, data}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = spring({frame, fps, config: {damping: 200}});
  return (
    <AbsoluteFill style={{background: 'transparent'}}>
      <div style={{opacity}}>{prompt} {infographicType} {JSON.stringify(data ?? {})}</div>
    </AbsoluteFill>
  );
};`;

      const result = validateInfographicQuality(code);
      expect(result.valid).toBe(true);
      expect(result.failures).toEqual([]);
    });

    it('rejects remote assets and CSS keyframe/transition animation', () => {
      const code = `
import React from 'react';
export const Infographic2: React.FC<{prompt: string}> = ({prompt}) => {
  return (
    <div style={{backgroundColor: 'transparent', animation: 'pulse 1s linear infinite', transition: 'all .2s'}}>
      <img src="https://example.com/logo.png" />
      <span>{prompt}</span>
    </div>
  );
};`;

      const result = validateInfographicQuality(code);
      expect(result.valid).toBe(false);
      expect(result.failures).toContain('contains remote URL asset');
      expect(result.failures).toContain(
        'contains CSS animation/transition instead of frame-driven motion',
      );
    });

    it('allows SVG namespace URLs while still validating quality rules', () => {
      const code = `
import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
type Props = {prompt: string; infographicType: string};
export const InfographicSvg: React.FC<Props> = ({prompt, infographicType}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = spring({frame, fps, config: {damping: 200}});
  return (
    <AbsoluteFill style={{background: 'transparent'}}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
        <rect x="0" y="0" width="10" height="10" fill="currentColor" />
      </svg>
      <div style={{opacity}}>{prompt} {infographicType}</div>
    </AbsoluteFill>
  );
};`;

      const result = validateInfographicQuality(code);
      expect(result.valid).toBe(true);
      expect(result.failures).toEqual([]);
    });

    it('rejects static output that does not render prompt/type/data content', () => {
      const code = `
import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
type Props = {prompt: string; infographicType: string; data?: Record<string, unknown>};
export const Infographic3: React.FC<Props> = ({prompt, infographicType, data}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = spring({frame, fps, config: {damping: 200}});
  return (
    <AbsoluteFill style={{background: 'transparent'}}>
      <div style={{opacity}}>Static hardcoded text only</div>
    </AbsoluteFill>
  );
};`;

      const result = validateInfographicQuality(code);
      expect(result.valid).toBe(false);
      expect(result.failures).toContain('does not render prompt, infographicType, or data-driven content');
    });

    it('rejects Math.random usage for deterministic rendering', () => {
      const code = `
import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, spring} from 'remotion';
type Props = {prompt: string; infographicType: string};
export const Infographic4: React.FC<Props> = ({prompt}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = spring({frame, fps, config: {damping: 200}});
  const randomX = Math.random() * 100;
  return <AbsoluteFill style={{background: 'transparent'}}><div style={{opacity, left: randomX}}>{prompt}</div></AbsoluteFill>;
};`;

      const result = validateInfographicQuality(code);
      expect(result.valid).toBe(false);
      expect(result.failures).toContain('contains Math.random(); use remotion random() with a static seed');
    });

    it('accepts prompt usage when helper functions return JSX before main return', () => {
      const code = `
import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
const Badge: React.FC<{label: string}> = ({label}) => {
  return <span>{label}</span>;
};
type Props = {prompt: string; infographicType: string};
export const Infographic5: React.FC<Props> = ({prompt, infographicType}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const opacity = spring({frame, fps, config: {damping: 200}});
  const heading = prompt.trim();
  const displayHeading = heading.toUpperCase();
  return (
    <AbsoluteFill style={{background: 'transparent'}}>
      <div style={{opacity}}>
        <Badge label={infographicType} />
        <h1>{displayHeading}</h1>
      </div>
    </AbsoluteFill>
  );
};`;

      const result = validateInfographicQuality(code);
      expect(result.valid).toBe(true);
    });
  });

  describe('quality failure classification', () => {
    it('classifies hard and soft quality failures correctly', () => {
      const failures = [
        'does not render prompt, infographicType, or data-driven content',
        'contains CSS animation/transition instead of frame-driven motion',
        'missing transparent root background',
        'contains Math.random(); use remotion random() with a static seed',
      ];
      const classified = classifyInfographicQualityFailures(failures);
      expect(classified.soft).toEqual([
        'does not render prompt, infographicType, or data-driven content',
        'contains CSS animation/transition instead of frame-driven motion',
      ]);
      expect(classified.hard).toEqual([
        'missing transparent root background',
        'contains Math.random(); use remotion random() with a static seed',
      ]);
    });
  });

  describe('progress normalization', () => {
    it('normalizes fraction progress values', () => {
      expect(normalizeRemotionProgress(0.33)).toBeCloseTo(0.33, 5);
    });

    it('normalizes legacy percent values', () => {
      expect(normalizeRemotionProgress(33)).toBeCloseTo(0.33, 5);
    });

    it('clamps out-of-range values', () => {
      expect(normalizeRemotionProgress(-1)).toBe(0);
      expect(normalizeRemotionProgress(120)).toBe(1);
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

      const stderr = `${r.stderr ?? ''}\n${r.stdout ?? ''}`;
      if (r.status !== 0 && /listen EPERM|operation not permitted.*tsx|tsx-\d+\/.+\.pipe/i.test(stderr)) {
        return;
      }

      expect(r.status).toBe(0);
      expect(r.error).toBeUndefined();
      expect(existsSync(outputPath)).toBe(true);

      const out = JSON.parse(readFileSync(outputPath, 'utf-8')) as { outputs?: string[] };
      expect(Array.isArray(out.outputs)).toBe(true);
      expect(out.outputs!.length).toBeGreaterThanOrEqual(1);
      const webm = out.outputs![0];
      expect(webm).toMatch(/\.webm$/);
      expect(existsSync(webm)).toBe(true);
    });
  });
});
