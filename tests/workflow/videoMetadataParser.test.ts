import { describe, expect, it } from 'vitest';
import {
  deriveVideoMetadata,
  formatVideoMetadataMarkdown,
  parseVideoMetadataJson,
  parseVideoMetadataMarkdown,
} from '../../src/tasks/video/workflow/videoMetadataParser.js';

describe('videoMetadataParser', () => {
  it('parses canonical JSON metadata', () => {
    const parsed = parseVideoMetadataJson(
      JSON.stringify({
        subjectMatter: 'Indus Valley Civilization',
        timePeriod: '2500 BCE - 1500 BCE',
        geographicContext: 'Ancient India',
        visualStyle: 'Historical documentary',
        anachronismsToAvoid: ['plastic', 'smartphones'],
        visualConsistencyRequirements: ['stone architecture', 'period clothing'],
      }),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.subjectMatter).toBe('Indus Valley Civilization');
    expect(parsed?.anachronismsToAvoid).toContain('plastic');
  });

  it('parses markdown metadata mirror', () => {
    const markdown = `# Video Context Metadata

## Subject Matter
Industrial Revolution

## Time Period(s)
1850-1860

## Geographic/Cultural Context
Victorian England

## Visual Style
Historical documentary

## Anachronisms to Avoid
- plastic
- smartphones

## Visual Consistency Requirements
- period clothing
- horse-drawn streets
`;

    const parsed = parseVideoMetadataMarkdown(markdown);
    expect(parsed).not.toBeNull();
    expect(parsed?.timePeriod).toBe('1850-1860');
    expect(parsed?.geographicContext).toBe('Victorian England');
    expect(
      parsed?.visualConsistencyRequirements.some((item) =>
        item.toLowerCase().includes('period clothing'),
      ),
    ).toBe(true);
  });

  it('derives historical defaults when no metadata file exists', () => {
    const derived = deriveVideoMetadata({
      transcriptContent: '- 1 [00:00:00,000 --> 00:00:05,000] In 1850 the city looked very different.',
      contentPlan: '# Visual Content Plan\nOverview of industrial life in 1850-1860 England.',
    });

    expect(derived).not.toBeNull();
    expect(derived?.timePeriod).toContain('1850');
    expect(derived?.anachronismsToAvoid.length).toBeGreaterThan(0);

    const markdown = formatVideoMetadataMarkdown(derived!);
    expect(markdown).toContain('## Subject Matter');
    expect(markdown).toContain('## Anachronisms to Avoid');
  });
});
