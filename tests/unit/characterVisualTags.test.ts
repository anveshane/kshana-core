/**
 * characterVisualTags — turns full character.md profiles into short
 * visual tags usable in motion directives for multi-character shots.
 * The video model has no notion of "Parvati" vs "Isha"; the tag is
 * what disambiguates two figures in the same frame.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  extractPhysicalDescription,
  readCharacterVisualTag,
  buildCharacterTagsBlock,
} from '../../src/core/planner/characterVisualTags.js';

describe('extractPhysicalDescription', () => {
  it('extracts the paragraph after a "Physical Description" header', () => {
    const md = `### Character Profile: Parvati

#### Physical Description (Anime Style)
In vibrant anime aesthetics, Parvati is depicted as a 35-year-old woman with a sturdy frame, standing at 5'4". She wears a faded dusty blue salwar kameez with sleeves rolled up.

#### Personality
Quiet resilience and selfless ferocity.`;
    const out = extractPhysicalDescription(md, 500);
    expect(out).toContain('35-year-old woman');
    expect(out).toContain('dusty blue salwar kameez');
    expect(out).not.toContain('Personality');
  });

  it('handles bold-header variant "**Physical Description:**"', () => {
    const md = `**Character Profile: Isha**

**Physical Description (Anime Style):**
Isha is a 16-year-old athletic prodigy with a tall, lean runner's physique, sun-kissed brown skin, high black ponytail, vibrant red athletic vest and black shorts.

**Personality:**
Driven.`;
    const out = extractPhysicalDescription(md, 500);
    expect(out).toContain('16-year-old athletic prodigy');
    expect(out).toContain('red athletic vest');
    expect(out).not.toContain('Driven');
  });

  it('truncates at a sentence boundary near maxChars', () => {
    const longPara =
      'A 35-year-old woman in a dusty blue salwar kameez with sleeves rolled up. Her hair is pulled into a practical bun with graying strands. She carries a canvas bag slung over one shoulder. Her calloused hands are yellow-stained from bleaching powder.';
    const md = `#### Physical Description\n${longPara}\n\n#### Personality\nquiet.`;
    const out = extractPhysicalDescription(md, 100);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(100);
    // Must end at a clean boundary — not mid-word.
    expect(out!).toMatch(/[.,]$/);
  });

  it('returns null when no Physical Description section exists', () => {
    const md = `### Character Profile: Unknown\n\n#### Personality\nJust personality.`;
    expect(extractPhysicalDescription(md)).toBeNull();
  });

  it('strips markdown bold and italic formatting', () => {
    const md = `**Physical Description:**
She has **black hair** tied in a *disheveled* bun and wears \`old chappals\`.

**Personality:**`;
    const out = extractPhysicalDescription(md, 500);
    expect(out).not.toContain('**');
    expect(out).not.toContain('`');
    expect(out).toContain('black hair');
  });
});

describe('readCharacterVisualTag', () => {
  it('reads a real file and extracts the description', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cvt-'));
    const path = join(dir, 'parvati.md');
    writeFileSync(
      path,
      `#### Physical Description
35-year-old woman in faded blue salwar kameez, hair in graying bun, canvas bag over shoulder.

#### Personality
Resilient.`,
    );
    const tag = readCharacterVisualTag(path, 500);
    expect(tag).toContain('35-year-old');
    expect(tag).toContain('salwar kameez');
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when file does not exist', () => {
    expect(readCharacterVisualTag('/tmp/does-not-exist-XXXYYY.md')).toBeNull();
  });
});

describe('buildCharacterTagsBlock', () => {
  it('returns empty string for 0 or 1 characters (no disambiguation needed)', () => {
    expect(buildCharacterTagsBlock([])).toBe('');
    const dir = mkdtempSync(join(tmpdir(), 'cvt-'));
    writeFileSync(
      join(dir, 'solo.md'),
      `#### Physical Description\nA lone figure in a trench coat.\n\n#### X\n`,
    );
    expect(buildCharacterTagsBlock([{ refId: 'solo', mdPath: join(dir, 'solo.md') }])).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });

  it('builds a block for 2+ characters with valid tags', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cvt-'));
    writeFileSync(
      join(dir, 'parvati.md'),
      `#### Physical Description\n35-year-old woman in faded blue salwar kameez, graying bun.\n\n#### Personality\nResilient.`,
    );
    writeFileSync(
      join(dir, 'isha.md'),
      `#### Physical Description\n16-year-old girl in red athletic vest, high ponytail.\n\n#### Personality\nDriven.`,
    );
    const out = buildCharacterTagsBlock([
      { refId: 'parvati', mdPath: join(dir, 'parvati.md') },
      { refId: 'isha', mdPath: join(dir, 'isha.md') },
    ]);
    expect(out).toContain('<character_tags>');
    expect(out).toContain('</character_tags>');
    expect(out).toContain('parvati:');
    expect(out).toContain('isha:');
    expect(out).toContain('salwar kameez');
    expect(out).toContain('red athletic vest');
    expect(out).toContain('SHORT visual tag');
    rmSync(dir, { recursive: true, force: true });
  });

  it('drops a character whose profile is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cvt-'));
    writeFileSync(
      join(dir, 'parvati.md'),
      `#### Physical Description\n35-year-old woman in faded blue salwar.\n\n#### X\n`,
    );
    writeFileSync(
      join(dir, 'isha.md'),
      `#### Physical Description\n16-year-old girl in red vest.\n\n#### X\n`,
    );
    const out = buildCharacterTagsBlock([
      { refId: 'parvati', mdPath: join(dir, 'parvati.md') },
      { refId: 'isha', mdPath: join(dir, 'isha.md') },
      { refId: 'ghost', mdPath: join(dir, 'does-not-exist.md') },
    ]);
    expect(out).toContain('parvati');
    expect(out).toContain('isha');
    expect(out).not.toContain('ghost');
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty string if fewer than 2 valid profiles resolve', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cvt-'));
    writeFileSync(
      join(dir, 'parvati.md'),
      `#### Physical Description\n35-year-old woman in blue.\n\n#### X\n`,
    );
    // isha's file is missing, ghost's file is missing — only parvati has a tag
    const out = buildCharacterTagsBlock([
      { refId: 'parvati', mdPath: join(dir, 'parvati.md') },
      { refId: 'isha', mdPath: join(dir, 'isha-missing.md') },
    ]);
    expect(out).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });
});
