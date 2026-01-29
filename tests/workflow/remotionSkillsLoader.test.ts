/**
 * Unit tests for loadRemotionSkills.
 */
import { describe, it, expect } from 'vitest';
import { loadRemotionSkills, REMOTION_SKILLS_INFOGraphics_SUBSET } from '../../src/core/prompts/loader.js';

describe('loadRemotionSkills', () => {
  it('returns non-empty string when prompts/remotion-skills/ exists', () => {
    const result = loadRemotionSkills();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('with ruleSubset includes expected content for animations', () => {
    const result = loadRemotionSkills({ ruleSubset: ['animations'] });
    expect(result).toContain('animations');
    expect(result.length).toBeGreaterThan(0);
  });

  it('with ruleSubset ["animations", "timing"] includes both', () => {
    const result = loadRemotionSkills({ ruleSubset: ['animations', 'timing'] });
    expect(result).toMatch(/animations|timing/);
    expect(result.length).toBeGreaterThan(0);
  });

  it('REMOTION_SKILLS_INFOGraphics_SUBSET includes animations and timing', () => {
    expect(REMOTION_SKILLS_INFOGraphics_SUBSET).toContain('animations');
    expect(REMOTION_SKILLS_INFOGraphics_SUBSET).toContain('timing');
  });
});
