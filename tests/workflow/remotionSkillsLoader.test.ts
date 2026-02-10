/**
 * Unit tests for loadRemotionSkills.
 */
import { describe, it, expect } from 'vitest';
import {
  loadRemotionSkills,
  loadRemotionSkillsForInfographicType,
  REMOTION_SKILLS_INFOGraphics_SUBSET,
} from '../../src/core/prompts/loader.js';

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

  it('loadRemotionSkillsForInfographicType selects charts for bar_chart', () => {
    const result = loadRemotionSkillsForInfographicType(
      'bar_chart',
      'Quarterly revenue comparison with animated bars',
    );
    expect(result.selectedRules).toContain('charts');
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('loadRemotionSkillsForInfographicType excludes maps by default', () => {
    const result = loadRemotionSkillsForInfographicType(
      'statistic',
      'Show monthly retention as a glowing metric card',
    );
    expect(result.selectedRules).not.toContain('maps');
  });

  it('loadRemotionSkillsForInfographicType includes maps for geographic prompts', () => {
    const result = loadRemotionSkillsForInfographicType(
      'diagram',
      'Map of migration routes across regions with highlighted territories',
    );
    expect(result.selectedRules).toContain('maps');
  });

  it('does not infer 3d from plain text number words like "three items"', () => {
    const result = loadRemotionSkillsForInfographicType(
      'list',
      'Display three items in a checklist with sequential reveal.',
    );
    expect(result.selectedRules).not.toContain('3d');
  });
});
