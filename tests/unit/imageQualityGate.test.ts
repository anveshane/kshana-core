/**
 * TDD Tests for Image Quality Gate (Change 5)
 *
 * After each shot image generation, validate the image before proceeding to video.
 * Basic validation (always on): file exists, valid format, correct dimensions.
 * Vision review (configurable): LLM reviews image against prompt.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ──────────────────────────────────────────────────────────────────────────────
// imageValidator is called by executor after shot image generation
// ──────────────────────────────────────────────────────────────────────────────

describe('Image quality gate: validation integration', () => {
  it('validateGeneratedImage returns valid for a real PNG file', async () => {
    const { validateGeneratedImage } = await import('../../src/core/planner/imageValidator.js');

    // Create a minimal valid PNG
    const dir = join(tmpdir(), `img-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const pngPath = join(dir, 'test.png');

    // Minimal 1x1 PNG
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, // width: 1
      0x00, 0x00, 0x00, 0x01, // height: 1
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, // rest of IHDR
    ]);
    writeFileSync(pngPath, pngHeader);

    const result = await validateGeneratedImage(pngPath, 'test prompt');
    expect(result.valid).toBe(true);

    rmSync(dir, { recursive: true });
  });

  it('validateGeneratedImage rejects non-existent file', async () => {
    const { validateGeneratedImage } = await import('../../src/core/planner/imageValidator.js');
    const result = await validateGeneratedImage('/nonexistent/path.png', 'test');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('validateGeneratedImage rejects wrong dimensions', async () => {
    const { validateGeneratedImage } = await import('../../src/core/planner/imageValidator.js');

    const dir = join(tmpdir(), `img-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const pngPath = join(dir, 'test.png');

    // 1x1 PNG
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01,
      0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
    ]);
    writeFileSync(pngPath, pngHeader);

    const result = await validateGeneratedImage(pngPath, 'test', { width: 848, height: 480 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Dimension mismatch');

    rmSync(dir, { recursive: true });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Executor calls validateGeneratedImage after shot image generation
// ──────────────────────────────────────────────────────────────────────────────

describe('Image quality gate: executor integration', () => {
  it('ExecutorAgent imports and uses validateGeneratedImage', async () => {
    // Verify the executor code references the validator
    const { readFileSync } = await import('fs');
    const executorCode = readFileSync(
      join(process.cwd(), 'src/core/planner/ExecutorAgent.ts'),
      'utf-8',
    );
    expect(executorCode).toContain('validateGeneratedImage');
  });

  it('executor validates image after generation and logs result', async () => {
    const { readFileSync } = await import('fs');
    const executorCode = readFileSync(
      join(process.cwd(), 'src/core/planner/ExecutorAgent.ts'),
      'utf-8',
    );
    // Should call validateGeneratedImage and check result.valid
    expect(executorCode).toMatch(/validateGeneratedImage.*result\.valid|valid.*validateGeneratedImage/s);
  });
});
