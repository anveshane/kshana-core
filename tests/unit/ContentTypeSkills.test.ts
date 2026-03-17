import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadContentTypeSkills, clearPromptTemplateCache } from '../../src/core/prompts/loader.js';

describe('loadContentTypeSkills', () => {
  beforeEach(() => {
    clearPromptTemplateCache();
  });

  // ── Built-in skills ──────────────────────────────────────────────────────

  it('loads zimage skill for character_image_prompt with comfyui + zimage context', () => {
    const { content, loadedFiles } = loadContentTypeSkills('character_image_prompt', {
      providerId: 'comfyui',
      workflowName: 'zimage',
    });
    expect(content).toBeTruthy();
    expect(content).toContain('Z-Image Turbo');
    expect(content).toContain('Positive-only control');
    expect(loadedFiles).toContain('character_image_prompt.comfyui.zimage.md');
  });

  it('loads zimage skill for setting_image_prompt with comfyui + zimage context', () => {
    const { content } = loadContentTypeSkills('setting_image_prompt', {
      providerId: 'comfyui',
      workflowName: 'zimage',
    });
    expect(content).toBeTruthy();
    expect(content).toContain('Z-Image Turbo');
    expect(content).toContain('Setting Image Prompting');
  });

  it('loads flux2_klein_edit skill for scene_image_prompt', () => {
    const { content, loadedFiles } = loadContentTypeSkills('scene_image_prompt', {
      providerId: 'comfyui',
      workflowName: 'flux2_klein_edit',
    });
    expect(content).toBeTruthy();
    expect(content).toContain('FLUX 2 Klein');
    expect(content).toContain('image 1');
    expect(content).toContain('Multi-Reference Patterns');
    expect(loadedFiles).toContain('scene_image_prompt.comfyui.flux2_klein_edit.md');
  });

  it('loads flux2_klein_edit skill for shot_image_prompt', () => {
    const { content } = loadContentTypeSkills('shot_image_prompt', {
      providerId: 'comfyui',
      workflowName: 'flux2_klein_edit',
    });
    expect(content).toBeTruthy();
    expect(content).toContain('FLUX 2 Klein');
    expect(content).toContain('image 1');
  });

  it('loads cascading skills (base + provider + workflow)', () => {
    const { content } = loadContentTypeSkills('character_image_prompt', {
      providerId: 'comfyui',
      workflowName: 'zimage',
    });
    expect(content).toContain('Z-Image Turbo');
  });

  it('returns empty content for unknown content type', () => {
    const { content, loadedFiles } = loadContentTypeSkills('unknown_type', {
      providerId: 'comfyui',
      workflowName: 'zimage',
    });
    expect(content).toBe('');
    expect(loadedFiles).toEqual([]);
  });

  it('returns empty content when no context provided and no base skill exists', () => {
    const { content } = loadContentTypeSkills('character_image_prompt');
    expect(content).toBe('');
  });

  // ── Project-level skills ─────────────────────────────────────────────────

  const TEST_PROJECT_DIR = join(process.cwd(), 'tests', '.tmp-skill-test-project');

  afterEach(() => {
    if (existsSync(TEST_PROJECT_DIR)) {
      rmSync(TEST_PROJECT_DIR, { recursive: true });
    }
  });

  it('loads project-level skills from projectDir/skills/content-type/', () => {
    const skillDir = join(TEST_PROJECT_DIR, 'skills', 'content-type');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'character_image_prompt.comfyui.zimage.md'),
      '# My Custom Character Prompting Guide\n\nCustom guidance for character prompts.',
    );

    const { content, loadedFiles } = loadContentTypeSkills(
      'character_image_prompt',
      { providerId: 'comfyui', workflowName: 'zimage' },
      TEST_PROJECT_DIR,
    );

    expect(content).toContain('Z-Image Turbo'); // built-in
    expect(content).toContain('My Custom Character Prompting Guide'); // project-level
    expect(loadedFiles).toContain('project:character_image_prompt.comfyui.zimage.md');
  });

  it('project-level skills are appended after built-in skills', () => {
    const skillDir = join(TEST_PROJECT_DIR, 'skills', 'content-type');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'character_image_prompt.comfyui.zimage.md'),
      'PROJECT_SKILL_MARKER',
    );

    const { content } = loadContentTypeSkills(
      'character_image_prompt',
      { providerId: 'comfyui', workflowName: 'zimage' },
      TEST_PROJECT_DIR,
    );

    const builtinIndex = content.indexOf('Z-Image Turbo');
    const projectIndex = content.indexOf('PROJECT_SKILL_MARKER');
    expect(builtinIndex).toBeGreaterThanOrEqual(0);
    expect(projectIndex).toBeGreaterThan(builtinIndex);
  });

  it('loads project-level base skill without provider context', () => {
    const skillDir = join(TEST_PROJECT_DIR, 'skills', 'content-type');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'character_image_prompt.md'),
      '# Base Character Skill\n\nBase guidance.',
    );

    const { content } = loadContentTypeSkills(
      'character_image_prompt',
      undefined,
      TEST_PROJECT_DIR,
    );

    expect(content).toContain('Base Character Skill');
  });

  it('returns only built-in skills when projectDir has no skills directory', () => {
    const { content } = loadContentTypeSkills(
      'character_image_prompt',
      { providerId: 'comfyui', workflowName: 'zimage' },
      '/nonexistent/path',
    );

    expect(content).toContain('Z-Image Turbo');
  });

  it('cascading resolution works for project-level skills', () => {
    const skillDir = join(TEST_PROJECT_DIR, 'skills', 'content-type');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'character_image_prompt.md'), 'BASE_LEVEL');
    writeFileSync(join(skillDir, 'character_image_prompt.comfyui.md'), 'PROVIDER_LEVEL');
    writeFileSync(join(skillDir, 'character_image_prompt.comfyui.zimage.md'), 'WORKFLOW_LEVEL');

    const { content, loadedFiles } = loadContentTypeSkills(
      'character_image_prompt',
      { providerId: 'comfyui', workflowName: 'zimage' },
      TEST_PROJECT_DIR,
    );

    expect(content).toContain('BASE_LEVEL');
    expect(content).toContain('PROVIDER_LEVEL');
    expect(content).toContain('WORKFLOW_LEVEL');
    expect(loadedFiles).toHaveLength(4); // 1 built-in + 3 project-level
  });
});
