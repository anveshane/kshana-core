/**
 * Tests for collectionExtractor — specifically the JSON shot parsing
 */

import { describe, it, expect } from 'vitest';
import { extractCollectionItems } from '../../src/core/planner/collectionExtractor.js';
import type { ExecutionNode } from '../../src/core/planner/types.js';

// Mock LLM client (not used for scene_video_prompt — JSON parse, no LLM)
const mockLlm = {} as any;

function makeNode(typeId: string, itemId?: string): ExecutionNode {
  return {
    id: itemId ? `${typeId}:${itemId}` : typeId,
    typeId,
    itemId,
    status: 'completed',
    displayName: typeId,
    isExpensive: false,
    isCollection: false,
    dependencies: [],
    dependents: [],
  };
}

describe('collectionExtractor', () => {
  describe('scene_video_prompt → JSON shot extraction', () => {
    it('parses structured JSON with shots', async () => {
      const json = JSON.stringify({
        sceneNumber: 1,
        sceneTitle: 'Memory Extraction',
        totalDuration: 45,
        shots: [
          {
            shotNumber: 1,
            shotType: 'establishing',
            duration: 8,
            description: 'Wide shot of the extraction booth',
            cameraWork: 'Slow dolly push-in',
            characters: ['elara_vance'],
            setting: 'the_dregs',
          },
          {
            shotNumber: 2,
            shotType: 'close_up',
            duration: 5,
            description: 'Close-up of Elara freezing',
            cameraWork: 'Static, rack focus',
            characters: ['elara_vance'],
            setting: null,
          },
          {
            shotNumber: 3,
            shotType: 'medium',
            duration: 7,
            description: 'Halloway slumps in the chair',
            cameraWork: 'Handheld shake',
            characters: ['mr_halloway', 'elara_vance'],
            setting: 'the_dregs',
          },
        ],
      });

      const node = makeNode('scene_video_prompt', 'scene_1');
      const result = await extractCollectionItems(node, json, mockLlm);

      expect(result).not.toBeNull();
      expect(result!.shots).toHaveLength(3);
      expect(result!.shots![0].shotNumber).toBe(1);
      expect(result!.shots![0].shotType).toBe('establishing');
      expect(result!.shots![0].duration).toBe(8);
      expect(result!.shots![0].characters).toEqual(['elara_vance']);
      expect(result!.shots![0].setting).toBe('the_dregs');
      expect(result!.shots![1].setting).toBeNull();
      expect(result!.shots![2].characters).toEqual(['mr_halloway', 'elara_vance']);
    });

    it('returns undefined shots for empty shots array', async () => {
      const json = JSON.stringify({
        sceneNumber: 1,
        shots: [],
      });

      const node = makeNode('scene_video_prompt', 'scene_1');
      const result = await extractCollectionItems(node, json, mockLlm);

      expect(result!.shots).toBeUndefined();
    });

    it('falls back to markdown regex for non-JSON content', async () => {
      const markdown = `
**SHOT 1: THE ESTABLISHING**
Wide shot of the booth

**SHOT 2: THE CLOSE-UP**
Elara's face

**SHOT 3: THE EXIT**
Running through corridor
`;

      const node = makeNode('scene_video_prompt', 'scene_1');
      const result = await extractCollectionItems(node, markdown, mockLlm);

      expect(result).not.toBeNull();
      expect(result!.shots).toHaveLength(3);
      expect(result!.shots![0].shotNumber).toBe(1);
      expect(result!.shots![0].shotType).toContain('establishing');
    });

    it('handles missing optional fields gracefully', async () => {
      const json = JSON.stringify({
        shots: [
          { shotNumber: 1, shotType: 'wide', duration: 10, description: 'A wide shot' },
          { shotNumber: 2, shotType: 'close', duration: 5, description: 'A close shot' },
        ],
      });

      const node = makeNode('scene_video_prompt', 'scene_1');
      const result = await extractCollectionItems(node, json, mockLlm);

      expect(result!.shots).toHaveLength(2);
      expect(result!.shots![0].characters).toBeUndefined();
      expect(result!.shots![0].setting).toBeUndefined();
      expect(result!.shots![0].cameraWork).toBeUndefined();
    });

    it('defaults duration to 5 when missing', async () => {
      const json = JSON.stringify({
        shots: [
          { shotNumber: 1, shotType: 'wide', description: 'A shot' },
        ],
      });

      const node = makeNode('scene_video_prompt', 'scene_1');
      const result = await extractCollectionItems(node, json, mockLlm);

      expect(result!.shots![0].duration).toBe(5);
    });
  });

  describe('non-matching node types', () => {
    it('returns null for unknown node types', async () => {
      const node = makeNode('unknown_type');
      const result = await extractCollectionItems(node, 'some content', mockLlm);
      expect(result).toBeNull();
    });
  });
});
