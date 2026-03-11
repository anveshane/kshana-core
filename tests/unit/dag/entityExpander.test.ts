/**
 * Unit tests for the entity expander.
 */

import { describe, it, expect } from 'vitest';
import {
  validateEntityExtraction,
  buildEntityNodes,
  slugify,
} from '../../../src/core/dag/expanders/entityExpander.js';
import { makeContext } from '../../helpers/dag/DAGTestHelpers.js';

const validEntities = {
  characters: [
    { name: 'Alice', role: 'protagonist', description: 'A brave girl' },
    { name: 'Bob', role: 'antagonist', description: 'A sly fox' },
  ],
  settings: [
    { name: 'Dark Forest', description: 'A spooky forest' },
  ],
  scenes: [
    { number: 1, title: 'The Beginning', characters: ['Alice'], setting: 'Dark Forest', summary: 'Alice enters' },
  ],
};

describe('entityExpander', () => {
  // ===========================================================================
  // slugify
  // ===========================================================================

  describe('slugify', () => {
    it('"Alice" → "alice"', () => {
      expect(slugify('Alice')).toBe('alice');
    });

    it('"Dark Forest" → "dark_forest"', () => {
      expect(slugify('Dark Forest')).toBe('dark_forest');
    });

    it('trims leading/trailing underscores', () => {
      expect(slugify('  Hello  ')).toBe('hello');
    });

    it('handles special characters', () => {
      expect(slugify("O'Brien")).toBe('o_brien');
    });
  });

  // ===========================================================================
  // validateEntityExtraction
  // ===========================================================================

  describe('validateEntityExtraction', () => {
    it('valid JSON passes with correct data shape', () => {
      const result = validateEntityExtraction({ content: JSON.stringify(validEntities) });
      expect(result.valid).toBe(true);
      const data = result.data as { characters: any[]; settings: any[]; scenes: any[] };
      expect(data.characters).toHaveLength(2);
      expect(data.characters[0].name).toBe('Alice');
      expect(data.settings).toHaveLength(1);
      expect(data.scenes).toHaveLength(1);
    });

    it('missing content fails', () => {
      const result = validateEntityExtraction({});
      expect(result.valid).toBe(false);
    });

    it('non-JSON content fails', () => {
      const result = validateEntityExtraction({ content: 'not json' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('JSON');
    });

    it('empty characters array fails', () => {
      const result = validateEntityExtraction({
        content: JSON.stringify({ ...validEntities, characters: [] }),
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('characters');
    });

    it('missing settings array fails', () => {
      const result = validateEntityExtraction({
        content: JSON.stringify({ characters: validEntities.characters, scenes: validEntities.scenes }),
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('settings');
    });

    it('character missing name fails', () => {
      const result = validateEntityExtraction({
        content: JSON.stringify({
          ...validEntities,
          characters: [{ role: 'protagonist', description: 'no name' }],
        }),
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('name or role');
    });

    it('character missing role fails', () => {
      const result = validateEntityExtraction({
        content: JSON.stringify({
          ...validEntities,
          characters: [{ name: 'Alice', description: 'no role' }],
        }),
      });
      expect(result.valid).toBe(false);
    });

    it('unknown character in scene fails (referential integrity)', () => {
      const entities = {
        ...validEntities,
        scenes: [{ number: 1, title: 'Scene', characters: ['Unknown'], setting: 'Dark Forest', summary: 'test' }],
      };
      const result = validateEntityExtraction({ content: JSON.stringify(entities) });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('unknown character');
    });

    it('unknown setting in scene fails (referential integrity)', () => {
      const entities = {
        ...validEntities,
        scenes: [{ number: 1, title: 'Scene', characters: ['Alice'], setting: 'Unknown Place', summary: 'test' }],
      };
      const result = validateEntityExtraction({ content: JSON.stringify(entities) });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('unknown setting');
    });

    it('too many characters (>10) fails', () => {
      const chars = Array.from({ length: 11 }, (_, i) => ({ name: `Char${i}`, role: 'supporting', description: 'd' }));
      const entities = {
        characters: chars,
        settings: validEntities.settings,
        scenes: [{ number: 1, title: 'S', characters: [], setting: 'Dark Forest', summary: 's' }],
      };
      const result = validateEntityExtraction({ content: JSON.stringify(entities) });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Too many characters');
    });

    it('too many scenes (>12) fails', () => {
      const scenes = Array.from({ length: 13 }, (_, i) => ({
        number: i + 1, title: `Scene ${i}`, characters: [], setting: 'Dark Forest', summary: 's',
      }));
      const entities = { characters: validEntities.characters, settings: validEntities.settings, scenes };
      const result = validateEntityExtraction({ content: JSON.stringify(entities) });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Too many scenes');
    });
  });

  // ===========================================================================
  // buildEntityNodes
  // ===========================================================================

  describe('buildEntityNodes', () => {
    it('1 character produces 4 nodes', () => {
      const singleChar = {
        characters: [{ name: 'Jan', role: 'protagonist', description: 'A farmer' }],
        settings: [{ name: 'Village', description: 'A quiet village' }],
        scenes: [{ number: 1, title: 'Morning', characters: ['Jan'], setting: 'Village', summary: 'Wakes up' }],
      };

      const result = { content: JSON.stringify(singleChar), data: singleChar };
      const ctx = makeContext();
      const nodes = buildEntityNodes(result, ctx);

      const charNodes = nodes.filter(n => n.id.startsWith('char_jan_'));
      expect(charNodes).toHaveLength(4);
      expect(charNodes.map(n => n.id)).toEqual([
        'char_jan_generate',
        'char_jan_approve',
        'char_jan_img_prompt',
        'char_jan_img',
      ]);
    });

    it('IDs are slugified', () => {
      const data = {
        characters: [{ name: 'Dark Lord', role: 'antagonist', description: 'd' }],
        settings: [{ name: 'Shadow Realm', description: 'd' }],
        scenes: [{ number: 1, title: 'S', characters: ['Dark Lord'], setting: 'Shadow Realm', summary: 's' }],
      };

      const result = { content: JSON.stringify(data), data };
      const nodes = buildEntityNodes(result, makeContext());

      expect(nodes.some(n => n.id === 'char_dark_lord_generate')).toBe(true);
      expect(nodes.some(n => n.id === 'setting_shadow_realm_generate')).toBe(true);
    });

    it('generate_scenes depends on all approval nodes', () => {
      const data = {
        characters: [
          { name: 'A', role: 'protagonist', description: 'd' },
          { name: 'B', role: 'supporting', description: 'd' },
        ],
        settings: [{ name: 'Place', description: 'd' }],
        scenes: [{ number: 1, title: 'S', characters: ['A'], setting: 'Place', summary: 's' }],
      };

      const result = { content: JSON.stringify(data), data };
      const nodes = buildEntityNodes(result, makeContext());
      const genScenes = nodes.find(n => n.id === 'generate_scenes')!;

      expect(genScenes.dependsOn).toContain('char_a_approve');
      expect(genScenes.dependsOn).toContain('char_b_approve');
      expect(genScenes.dependsOn).toContain('setting_place_approve');
    });

    it('expand_scenes has expanderKey', () => {
      const result = { content: JSON.stringify(validEntities), data: validEntities };
      const nodes = buildEntityNodes(result, makeContext());
      const expandScenes = nodes.find(n => n.id === 'expand_scenes')!;

      expect(expandScenes.expanderKey).toBe('scene_expander');
    });

    it('image nodes have retry error policy', () => {
      const data = {
        characters: [{ name: 'A', role: 'protagonist', description: 'd' }],
        settings: [{ name: 'P', description: 'd' }],
        scenes: [{ number: 1, title: 'S', characters: ['A'], setting: 'P', summary: 's' }],
      };
      const result = { content: JSON.stringify(data), data };
      const nodes = buildEntityNodes(result, makeContext());

      const imgNode = nodes.find(n => n.id === 'char_a_img')!;
      expect(imgNode.errorPolicy?.maxRetries).toBe(3);
      expect(imgNode.errorPolicy?.retryDelayMs).toBe(10000);
    });
  });
});
