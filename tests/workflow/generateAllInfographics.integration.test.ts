/**
 * Integration test for generate_all_infographics: temp project, placer file, mock runRemotionAgent.
 * Asserts _render_input.json (via captured_input.json) has placements and animationHints; with mock Remotion build asserts completion and manifest.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { join } from 'path';
import { getVideoGenerationTools } from '../../src/tasks/video/tools.js';
import { setCurrentProjectBasePath } from '../../src/tasks/video/index.js';
import type { AnimationRecommendations } from '../../src/tasks/video/remotionAgent.js';
import type { RunRemotionAgentCallback } from '../../src/tasks/video/tools.js';

const ROOT = join(process.cwd());
const FIXTURES = join(ROOT, 'tests', 'fixtures');
const PLACER_FIXTURE = join(FIXTURES, 'infographic-placements.md');

/** Path relative to project base where readProjectFile looks: .kshana/agent/content/infographic-placements.md */
const KSHANA_AGENT_CONTENT = join('.kshana', 'agent', 'content');

const MOCK_RECOMMENDATIONS: AnimationRecommendations = {
  placements: [
    {
      placementNumber: 1,
      animationHints: {
        ruleRefs: ['animations.md'],
        suggestion: 'Use spring for headline.',
        timingCurve: 'spring',
        enhancedPrompt: 'Enhanced statistic prompt.',
      },
    },
    {
      placementNumber: 2,
      animationHints: {
        ruleRefs: ['lists.md'],
        suggestion: 'Stagger list items.',
        enhancedPrompt: 'Enhanced list prompt.',
      },
    },
  ],
};

describe('generate_all_infographics integration', () => {
  const TEMP_PROJECT = join(ROOT, 'test-temp-infographics-integration');
  const TEMP_REMOTION = join(TEMP_PROJECT, 'fake-remotion');
  const PLACER_DIR = join(TEMP_PROJECT, KSHANA_AGENT_CONTENT);
  const MOCK_SCRIPT = join(FIXTURES, 'mock-remotion-render.mjs');
  const originalEnv = process.env['KSHANA_REMOTION_INFographics_DIR'];

  beforeEach(() => {
    if (fs.existsSync(TEMP_PROJECT)) fs.rmSync(TEMP_PROJECT, { recursive: true, force: true });
    fs.mkdirSync(PLACER_DIR, { recursive: true });
    fs.copyFileSync(PLACER_FIXTURE, join(PLACER_DIR, 'infographic-placements.md'));

    fs.mkdirSync(join(TEMP_REMOTION, 'build'), { recursive: true });
    fs.writeFileSync(
      join(TEMP_REMOTION, 'package.json'),
      JSON.stringify({
        name: 'fake-remotion',
        scripts: { render: `node "${MOCK_SCRIPT}"` },
      }),
      'utf-8'
    );
    fs.writeFileSync(join(TEMP_REMOTION, 'build', 'index.html'), '<!DOCTYPE html><html></html>', 'utf-8');

    process.env['KSHANA_REMOTION_INFographics_DIR'] = TEMP_REMOTION;
    setCurrentProjectBasePath(TEMP_PROJECT);
  });

  afterEach(() => {
    if (originalEnv !== undefined) process.env['KSHANA_REMOTION_INFographics_DIR'] = originalEnv;
    else delete process.env['KSHANA_REMOTION_INFographics_DIR'];
    setCurrentProjectBasePath(ROOT);
    if (fs.existsSync(TEMP_PROJECT)) fs.rmSync(TEMP_PROJECT, { recursive: true, force: true });
  });

  it('writes _render_input.json with placements and animationHints, completes with mock Remotion', async () => {
    const mockRunRemotionAgent: RunRemotionAgentCallback = async () => MOCK_RECOMMENDATIONS;
    const tools = getVideoGenerationTools({ runRemotionAgent: mockRunRemotionAgent });
    const tool = tools.find((t) => t.name === 'generate_all_infographics');
    expect(tool).toBeDefined();
    expect(tool!.handler).toBeDefined();

    const result = await (tool!.handler! as (args: Record<string, unknown>) => Promise<unknown>)({
      file_path: 'agent/content/infographic-placements.md',
    });

    const res = result as {
      status: string;
      error?: string;
      suggestion?: string;
      results?: Array<{ status: string; filePath?: string }>;
    };
    if (res.status === 'error') {
      expect.fail(`Tool returned error: ${res.error ?? ''} ${res.suggestion ?? ''}`);
    }
    expect(res.status).toBe('completed');

    const outDir = join(TEMP_PROJECT, '.kshana', 'agent', 'infographic-placements');
    const capturedPath = join(outDir, 'captured_input.json');
    expect(fs.existsSync(capturedPath)).toBe(true);
    const renderInput = JSON.parse(fs.readFileSync(capturedPath, 'utf-8')) as {
      placements: Array<Record<string, unknown>>;
    };
    expect(Array.isArray(renderInput.placements)).toBe(true);
    expect(renderInput.placements.length).toBeGreaterThanOrEqual(1);
    const withHints = renderInput.placements.find(
      (p) => p.animationHints && typeof (p.animationHints as Record<string, unknown>).suggestion === 'string'
    );
    expect(withHints).toBeDefined();
    expect((withHints as { animationHints: { suggestion: string } }).animationHints.suggestion).toBe(
      'Use spring for headline.'
    );

    expect(res.results).toBeDefined();
    expect(Array.isArray(res.results)).toBe(true);
    if (res.results!.length > 0) {
      expect(res.results!.every((r) => r.status === 'success')).toBe(true);
    }
  });

  it('when Remotion build missing, returns error', async () => {
    fs.rmSync(join(TEMP_REMOTION, 'build'), { recursive: true, force: true });
    const mockRunRemotionAgent: RunRemotionAgentCallback = async () => MOCK_RECOMMENDATIONS;
    const tools = getVideoGenerationTools({ runRemotionAgent: mockRunRemotionAgent });
    const tool = tools.find((t) => t.name === 'generate_all_infographics');
    expect(tool).toBeDefined();

    const result = await (tool!.handler! as (args: Record<string, unknown>) => Promise<unknown>)({
      file_path: 'agent/content/infographic-placements.md',
    });

    expect(result).toMatchObject({ status: 'error' });
    expect((result as { error?: string }).error).toMatch(/Remotion bundle failed|not found/);
  });
});
