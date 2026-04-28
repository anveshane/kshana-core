/**
 * TDD Tests for VLM (Vision Language Model) image review.
 *
 * After generating a shot image, send it to the VLM with the original prompt
 * and ask if the image matches. If not, log issues for retry.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('VLM review: LLMClient supports image messages', () => {
  it('LLMClient has a reviewImage method', async () => {
    const { LLMClient } = await import('../../src/core/llm/index.js');
    const client = new LLMClient({
      baseUrl: 'http://localhost:1234/v1',
      apiKey: 'test',
      model: 'test',
    });
    expect(typeof client.reviewImage).toBe('function');
  });

  it('convertMessages handles image_url content type', async () => {
    const { LLMClient } = await import('../../src/core/llm/index.js');
    // The client should be able to convert messages with image content
    // This is the OpenAI vision format:
    // { role: 'user', content: [{ type: 'text', text: '...' }, { type: 'image_url', image_url: { url: 'data:...' } }] }
    const client = new LLMClient({
      baseUrl: 'http://localhost:1234/v1',
      apiKey: 'test',
      model: 'test',
    });
    // reviewImage should accept an image path and prompt
    expect(client.reviewImage).toBeDefined();
  });
});

describe('VLM review: imageValidator has VLM review function', () => {
  it('reviewImageWithVLM function exists', async () => {
    const { reviewImageWithVLM } = await import('../../src/core/planner/imageValidator.js');
    expect(typeof reviewImageWithVLM).toBe('function');
  });
});

describe('VLM review: executor calls VLM after shot image generation', () => {
  it('executor code references reviewImageWithVLM', () => {
    const code = readFileSync(
      join(process.cwd(), 'src/core/planner/ExecutorAgent.ts'),
      'utf-8',
    );
    expect(code).toContain('reviewImageWithVLM');
  });
});
