/**
 * Tests for infographic-placements.md parser.
 */
import { describe, it, expect } from 'vitest';
import {
  parseInfographicPlacementsWithErrors,
  parseInfographicPlacements,
  type ParsedInfographicPlacement,
} from '../../src/tasks/video/workflow/infographicPlacementsParser.js';

describe('infographicPlacementsParser', () => {
  describe('parseInfographicPlacementsWithErrors', () => {
    it('parses standard format with bullet and type=statistic|list|diagram', () => {
      const content = `INFOGRAPHIC_PLACER:
- Placement 1: 0:25-0:35 | type=statistic | "The 2-Minute Rule (David Allen): If it takes 2 minutes to do, get it done right now." Bold text, clean design.
- Placement 2: 0:45-0:54 | type=list | "Quick 2-Minute Tasks: Organize your desk, Water plants, Clip nails." Simple bulleted list.
- Placement 3: 1:31-1:48 | type=diagram | "Comparing the 2-Minute Rules." Side-by-side comparison.`;
      const result = parseInfographicPlacementsWithErrors(content, false);
      expect(result.placements).toHaveLength(3);
      expect(result.errors).toHaveLength(0);

      expect(result.placements[0]).toMatchObject({
        placementNumber: 1,
        startTime: '0:25',
        endTime: '0:35',
        infographicType: 'statistic',
        prompt: expect.stringContaining('2-Minute Rule'),
      });
      expect(result.placements[1]).toMatchObject({
        placementNumber: 2,
        startTime: '0:45',
        endTime: '0:54',
        infographicType: 'list',
        prompt: expect.stringContaining('Quick 2-Minute Tasks'),
      });
      expect(result.placements[2]).toMatchObject({
        placementNumber: 3,
        startTime: '1:31',
        endTime: '1:48',
        infographicType: 'diagram',
        prompt: expect.stringContaining('Comparing the 2-Minute Rules'),
      });
    });

    it('parses real-world infographic-placements.md sample', () => {
      const content = `INFOGRAPHIC_PLACER:
- Placement 1: 0:25-0:35 | type=statistic | "The 2-Minute Rule (David Allen): If it takes 2 minutes to do, get it done right now." Bold text, clean design, focus on the rule.
- Placement 2: 0:45-0:54 | type=list | "Quick 2-Minute Tasks: Organize your desk, Water plants, Clip nails." Simple bulleted list, clear icons for each item, modern sans-serif font.
- Placement 3: 1:31-1:48 | type=diagram | "Comparing the 2-Minute Rules: Rule 1 (David Allen): If it takes 2 minutes, do it now. Rule 2 (James Clear): Simplify tasks to 2 minutes or less to start." Side-by-side comparison, clear headings for each rule, concise text, minimalist design.`;
      const result = parseInfographicPlacementsWithErrors(content, false);
      expect(result.placements).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
      expect(result.placements[0]!.infographicType).toBe('statistic');
      expect(result.placements[1]!.infographicType).toBe('list');
      expect(result.placements[2]!.infographicType).toBe('diagram');
    });

    it('normalizes infographic types (bar_chart, line_chart, stat)', () => {
      const content = `INFOGRAPHIC_PLACER:
- Placement 1: 0:00-0:10 | type=bar_chart | Bar chart prompt.
- Placement 2: 0:10-0:20 | type=line | Line chart prompt.
- Placement 3: 0:20-0:30 | type=stat | Stat prompt.`;
      const result = parseInfographicPlacementsWithErrors(content, false);
      expect(result.placements).toHaveLength(3);
      expect(result.placements[0]!.infographicType).toBe('bar_chart');
      expect(result.placements[1]!.infographicType).toBe('line_chart');
      expect(result.placements[2]!.infographicType).toBe('statistic');
    });

    it('allows • bullet and optional leading bullet', () => {
      const content = `INFOGRAPHIC_PLACER:
• Placement 1: 0:00-0:05 | type=statistic | One.
- Placement 2: 0:05-0:10 | type=list | Two.`;
      const result = parseInfographicPlacementsWithErrors(content, false);
      expect(result.placements).toHaveLength(2);
    });

    it('sorts placements by placement number', () => {
      const content = `INFOGRAPHIC_PLACER:
- Placement 3: 0:20-0:30 | type=statistic | Third.
- Placement 1: 0:00-0:10 | type=statistic | First.
- Placement 2: 0:10-0:20 | type=statistic | Second.`;
      const result = parseInfographicPlacementsWithErrors(content, false);
      expect(result.placements.map((p) => p.placementNumber)).toEqual([1, 2, 3]);
      expect(result.placements[0]!.prompt).toBe('First.');
      expect(result.placements[1]!.prompt).toBe('Second.');
      expect(result.placements[2]!.prompt).toBe('Third.');
    });

    it('returns zero placements for empty or header-only content', () => {
      expect(parseInfographicPlacementsWithErrors('', false).placements).toHaveLength(0);
      expect(parseInfographicPlacementsWithErrors('INFOGRAPHIC_PLACER:', false).placements).toHaveLength(0);
      expect(
        parseInfographicPlacementsWithErrors('INFOGRAPHIC_PLACER:\n\n\n', false).placements
      ).toHaveLength(0);
    });

    it('skips lines without Placement (non-strict)', () => {
      const content = `INFOGRAPHIC_PLACER:
- Placement 1: 0:00-0:05 | type=statistic | One.
Some random line.
- Placement 2: 0:05-0:10 | type=list | Two.`;
      const result = parseInfographicPlacementsWithErrors(content, false);
      expect(result.placements).toHaveLength(2);
    });

    it('reports duplicate placement numbers as warnings', () => {
      const content = `INFOGRAPHIC_PLACER:
- Placement 1: 0:00-0:05 | type=statistic | One.
- Placement 1: 0:05-0:10 | type=list | Also one.`;
      const result = parseInfographicPlacementsWithErrors(content, false);
      expect(result.placements).toHaveLength(2);
      expect(result.warnings.some((w) => w.includes('Duplicate placement number 1'))).toBe(true);
    });

    it('handles time formats M:SS and MM:SS', () => {
      const content = `INFOGRAPHIC_PLACER:
- Placement 1: 0:05-1:30 | type=statistic | Short to long.
- Placement 2: 1:0-1:15 | type=list | One minute.`;
      const result = parseInfographicPlacementsWithErrors(content, false);
      expect(result.placements).toHaveLength(2);
      expect(result.placements[0]).toMatchObject({ startTime: '0:05', endTime: '1:30' });
    });

    it('rejects invalid time range (start >= end) in strict mode', () => {
      const content = `INFOGRAPHIC_PLACER:
- Placement 1: 0:10-0:05 | type=statistic | Bad range.`;
      const result = parseInfographicPlacementsWithErrors(content, true);
      expect(result.placements).toHaveLength(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.reason.includes('Start time') || e.reason.includes('time range'))).toBe(
        true
      );
    });

    it('rejects invalid time range format in strict mode', () => {
      const content = `INFOGRAPHIC_PLACER:
- Placement 1: 0:10 - 0:15 | type=statistic | Spaces ok.`;
      const result = parseInfographicPlacementsWithErrors(content, false);
      expect(result.placements).toHaveLength(1);
      const bad = `INFOGRAPHIC_PLACER:
- Placement 1: abc-def | type=statistic | Bad.`;
      const badResult = parseInfographicPlacementsWithErrors(bad, true);
      expect(badResult.placements).toHaveLength(0);
      expect(badResult.errors.length).toBeGreaterThan(0);
    });

    it('rejects missing type= or malformed pattern in strict mode', () => {
      const content = `INFOGRAPHIC_PLACER:
- Placement 1: 0:00-0:05 | no type here | Prompt.`;
      const result = parseInfographicPlacementsWithErrors(content, true);
      expect(result.placements).toHaveLength(0);
      expect(result.errors.some((e) => e.reason.includes('match') || e.reason.includes('pattern'))).toBe(true);
    });
  });

  describe('parseInfographicPlacements', () => {
    it('returns only placements array', () => {
      const content = `INFOGRAPHIC_PLACER:
- Placement 1: 0:00-0:05 | type=statistic | One.`;
      const placements = parseInfographicPlacements(content);
      expect(Array.isArray(placements)).toBe(true);
      expect(placements).toHaveLength(1);
      expect(placements[0]).toMatchObject({
        placementNumber: 1,
        startTime: '0:00',
        endTime: '0:05',
        infographicType: 'statistic',
        prompt: 'One.',
      });
    });

    it('returns empty array for no valid placements', () => {
      expect(parseInfographicPlacements('')).toEqual([]);
      expect(parseInfographicPlacements('INFOGRAPHIC_PLACER:\n\n')).toEqual([]);
    });
  });
});
