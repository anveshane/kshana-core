/**
 * Integration test for generate_all_infographics: temp project, placer file, mock runRemotionAgent.
 * Asserts _render_input.json (via captured_input.json) has placements; with mock Remotion build asserts completion.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { join } from 'path';
import { getVideoGenerationTools } from '../../src/tasks/video/tools.js';
import { setCurrentProjectBasePath } from '../../src/tasks/video/index.js';
import type { ComponentCode } from '../../src/tasks/video/remotionAgent.js';
import type { RunRemotionAgentCallback } from '../../src/tasks/video/tools.js';

const ROOT = join(process.cwd());
const FIXTURES = join(ROOT, 'tests', 'fixtures');
const PLACER_FIXTURE = join(FIXTURES, 'infographic-placements.md');

/** Path relative to project base where readProjectFile looks: .kshana/agent/content/infographic-placements.md */
const KSHANA_AGENT_CONTENT = join('.kshana', 'agent', 'content');

const buildMockComponentCode = (placementNumber: number): string =>
  `import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring } from 'remotion';
interface InfographicProps { prompt: string; infographicType: string; data?: Record<string, unknown>; }
export const Infographic${placementNumber}: React.FC<InfographicProps> = ({ prompt, infographicType, data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = spring({ frame, fps, config: { damping: 200 } });
  return <AbsoluteFill style={{ background: 'transparent', justifyContent: 'center', alignItems: 'center' }}><div style={{ opacity }}>{prompt} - {infographicType} - {JSON.stringify(data ?? {})}</div></AbsoluteFill>;
};`;

const MOCK_COMPONENT_CODE: ComponentCode = {
  placements: Array.from({ length: 6 }, (_, index) => {
    const placementNumber = index + 1;
    return {
      placementNumber,
      componentCode: buildMockComponentCode(placementNumber),
    };
  }),
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
    fs.mkdirSync(join(TEMP_REMOTION, 'node_modules', '@remotion', 'renderer'), { recursive: true });
    fs.writeFileSync(
      join(TEMP_REMOTION, 'package.json'),
      JSON.stringify({
        name: 'fake-remotion',
        scripts: {
          build: 'node -e "process.exit(0)"',
          render: `node "${MOCK_SCRIPT}"`,
        },
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

  it('writes _render_input.json with placements, completes with mock Remotion', async () => {
    const mockRunRemotionAgent: RunRemotionAgentCallback = async () => MOCK_COMPONENT_CODE;
    const tools = getVideoGenerationTools({ runRemotionAgent: mockRunRemotionAgent });
    const tool = tools.find((t) => t.name === 'generate_all_infographics');
    expect(tool).toBeDefined();
    expect(tool!.handler).toBeDefined();

    const result = await (tool!.handler! as (args: Record<string, unknown>) => Promise<unknown>)({
      file_path: 'agent/content/infographic-placements.md',
      expand_prompts: false,
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
      placements: Array<{ placementNumber: number; componentName: string }>;
    };
    expect(Array.isArray(renderInput.placements)).toBe(true);
    expect(renderInput.placements.length).toBeGreaterThanOrEqual(1);
    const withComponent = renderInput.placements.find((p) => p.componentName?.startsWith('Infographic'));
    expect(withComponent).toBeDefined();
    expect(withComponent!.componentName).toMatch(/^Infographic\d+$/);

    expect(res.results).toBeDefined();
    expect(Array.isArray(res.results)).toBe(true);
    if (res.results!.length > 0) {
      expect(res.results!.every((r) => r.status === 'success')).toBe(true);
    }
  });

  it('when Remotion package.json is missing, returns error', async () => {
    fs.rmSync(join(TEMP_REMOTION, 'package.json'), { force: true });
    const mockRunRemotionAgent: RunRemotionAgentCallback = async () => MOCK_COMPONENT_CODE;
    const tools = getVideoGenerationTools({ runRemotionAgent: mockRunRemotionAgent });
    const tool = tools.find((t) => t.name === 'generate_all_infographics');
    expect(tool).toBeDefined();

    const result = await (tool!.handler! as (args: Record<string, unknown>) => Promise<unknown>)({
      file_path: 'agent/content/infographic-placements.md',
      expand_prompts: false,
    });

    expect(result).toMatchObject({ status: 'error' });
    expect((result as { error?: string }).error).toMatch(/package not found|not found/);
  });

  it('auto-remediates bundle syntax failure by regenerating only the failing placement', async () => {
    const flakyBuildScript = join(TEMP_REMOTION, 'mock-remotion-build-syntax-error.mjs');
    fs.writeFileSync(
      flakyBuildScript,
      `import fs from 'node:fs';
import path from 'node:path';
const componentPath = path.join(process.cwd(), 'src', 'components', 'Infographic1.tsx');
const content = fs.readFileSync(componentPath, 'utf-8');
if (content.includes('BAD_BUILD_TOKEN')) {
  console.error('Error: Transform failed with 1 error:');
  console.error(\`\${componentPath}:219:20: ERROR: The character ">" is not valid inside a JSX element\`);
  process.exit(1);
}
process.exit(0);`,
      'utf-8',
    );
    fs.writeFileSync(
      join(TEMP_REMOTION, 'package.json'),
      JSON.stringify({
        name: 'fake-remotion',
        scripts: {
          build: `node "${flakyBuildScript}"`,
          render: `node "${MOCK_SCRIPT}"`,
        },
      }),
      'utf-8',
    );

    let callCount = 0;
    const retryOptions: Array<{ failedPlacementNumber?: number; retryAttempt?: number }> = [];
    const mockRunRemotionAgent: RunRemotionAgentCallback = async (placements, _skillsContent, options) => {
      callCount += 1;
      if (options) retryOptions.push({ failedPlacementNumber: options.failedPlacementNumber, retryAttempt: options.retryAttempt });
      const placementNumber = placements[0]?.placementNumber ?? 1;

      if (placementNumber === 1 && !options?.retryAttempt) {
        return {
          placements: [
            {
              placementNumber: 1,
              componentCode:
                "import React from 'react';\\nimport { AbsoluteFill, useCurrentFrame, useVideoConfig, spring } from 'remotion';\\ninterface InfographicProps { prompt: string; infographicType: string; data?: Record<string, unknown>; }\\nexport const Infographic1: React.FC<InfographicProps> = ({ prompt, infographicType, data }) => { const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const opacity = spring({ frame, fps, config: { damping: 200 } }); return <AbsoluteFill style={{ background: 'transparent', justifyContent: 'center', alignItems: 'center' }}><div style={{ opacity }}>BAD_BUILD_TOKEN {prompt} {infographicType} {JSON.stringify(data ?? {})}</div></AbsoluteFill>; };",
            },
          ],
        };
      }

      return {
        placements: [
          {
            placementNumber,
            componentCode:
              `import React from 'react';\nimport { AbsoluteFill, useCurrentFrame, useVideoConfig, spring } from 'remotion';\ninterface InfographicProps { prompt: string; infographicType: string; data?: Record<string, unknown>; }\nexport const Infographic${placementNumber}: React.FC<InfographicProps> = ({ prompt, infographicType, data }) => { const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const opacity = spring({ frame, fps, config: { damping: 200 } }); return <AbsoluteFill style={{ background: 'transparent', justifyContent: 'center', alignItems: 'center' }}><div style={{ opacity }}>{prompt} {infographicType} {JSON.stringify(data ?? {})}</div></AbsoluteFill>; };`,
          },
        ],
      };
    };

    const tools = getVideoGenerationTools({ runRemotionAgent: mockRunRemotionAgent });
    const tool = tools.find((t) => t.name === 'generate_all_infographics');
    expect(tool).toBeDefined();

    const result = await (tool!.handler! as (args: Record<string, unknown>) => Promise<unknown>)({
      file_path: 'agent/content/infographic-placements.md',
      expand_prompts: false,
    });

    expect((result as { status: string }).status).toBe('completed');
    expect(callCount).toBeGreaterThanOrEqual(3);
    expect(retryOptions.some((o) => o.failedPlacementNumber === 1 && o.retryAttempt === 1)).toBe(true);
  });

  it('retries only failed placement when render fails with ReferenceError', async () => {
    const flakyRenderScript = join(TEMP_REMOTION, 'mock-remotion-render-reference-error.mjs');
    fs.writeFileSync(
      flakyRenderScript,
      `import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
let input = '';
let outDir = '';
let output = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--input' && args[i + 1]) input = args[i + 1];
  if (args[i] === '--outDir' && args[i + 1]) outDir = args[i + 1];
  if (args[i] === '--output' && args[i + 1]) output = args[i + 1];
}
const raw = fs.readFileSync(input, 'utf-8');
const data = JSON.parse(raw);
const component2 = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'Infographic2.tsx'), 'utf-8');
if (component2.includes('BAD_WATER')) {
  console.error('ReferenceError: waterGrad is not defined');
  console.error('at Infographic2 (http://localhost:3000/bundle.js:10:10)');
  process.exit(1);
}
const outputs = (data.placements || []).map((p) => path.join(outDir, \`info\${p.placementNumber}_mock\${Date.now().toString(36)}.mp4\`));
if (output) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ outputs }), 'utf-8');
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'captured_input.json'), raw, 'utf-8');`,
      'utf-8',
    );
    fs.writeFileSync(
      join(TEMP_REMOTION, 'package.json'),
      JSON.stringify({
        name: 'fake-remotion',
        scripts: {
          build: 'node -e "process.exit(0)"',
          render: `node "${flakyRenderScript}"`,
        },
      }),
      'utf-8',
    );

    let callCount = 0;
    const retryOptions: Array<{ failedPlacementNumber?: number; retryAttempt?: number }> = [];
    const mockRunRemotionAgent: RunRemotionAgentCallback = async (placements, _skillsContent, options) => {
      callCount += 1;
      if (options) retryOptions.push({ failedPlacementNumber: options.failedPlacementNumber, retryAttempt: options.retryAttempt });
      const placementNumber = placements[0]?.placementNumber ?? 1;

      if (placementNumber === 2 && !options?.retryAttempt) {
        return {
          placements: [
            {
              placementNumber: 2,
              componentCode:
                "import React from 'react';\\nimport { AbsoluteFill, useCurrentFrame, useVideoConfig, spring } from 'remotion';\\ninterface InfographicProps { prompt: string; infographicType: string; data?: Record<string, unknown>; }\\nexport const Infographic2: React.FC<InfographicProps> = ({ prompt }) => { const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const opacity = spring({ frame, fps, config: { damping: 200 } }); return <AbsoluteFill style={{ background: 'transparent' }}><div style={{ opacity }}>BAD_WATER {prompt}</div></AbsoluteFill>; };",
            },
          ],
        };
      }

      return {
        placements: [
          {
            placementNumber,
            componentCode:
              `import React from 'react';\nimport { AbsoluteFill, useCurrentFrame, useVideoConfig, spring } from 'remotion';\ninterface InfographicProps { prompt: string; infographicType: string; data?: Record<string, unknown>; }\nexport const Infographic${placementNumber}: React.FC<InfographicProps> = ({ prompt, infographicType }) => { const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const opacity = spring({ frame, fps, config: { damping: 200 } }); return <AbsoluteFill style={{ background: 'transparent', justifyContent: 'center', alignItems: 'center' }}><div style={{ opacity }}>{prompt} {infographicType}</div></AbsoluteFill>; };`,
          },
        ],
      };
    };

    const tools = getVideoGenerationTools({ runRemotionAgent: mockRunRemotionAgent });
    const tool = tools.find((t) => t.name === 'generate_all_infographics');
    expect(tool).toBeDefined();

    const result = await (tool!.handler! as (args: Record<string, unknown>) => Promise<unknown>)({
      file_path: 'agent/content/infographic-placements.md',
      expand_prompts: false,
    });

    expect((result as { status: string }).status).toBe('completed');
    expect(callCount).toBeGreaterThanOrEqual(3);
    expect(retryOptions.some((o) => o.failedPlacementNumber === 2 && o.retryAttempt === 1)).toBe(true);
  });
});
