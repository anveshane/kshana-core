/**
 * Extract short visual tags for characters in a shot.
 *
 * Purpose: motion directives go to a video model (LTX) that has no idea
 * who "Parvati" or "Isha" are. When a shot contains >=2 characters, the
 * directive needs to disambiguate them with a SHORT visual description
 * ("the older woman in a dusty blue salwar kameez") rather than by
 * name. This module builds those tags from character profile files.
 *
 * Input contract:
 * - refIds list — set of character identifiers visible in the shot
 * - a lookup that resolves refId → character.md file path on disk
 *
 * Output: a prompt-injectable block like
 *   <character_tags>
 *   When naming characters in motion, use these visual descriptions:
 *   - parvati: 35-year-old woman, faded blue salwar kameez, graying bun, canvas bag
 *   - isha: 16-year-old girl, red athletic vest, black shorts, high ponytail
 *   </character_tags>
 *
 * Or an empty string if no tags could be built (file missing, <2 chars,
 * etc.) — motion directive prompts stay as-is in that case.
 */

import { readFileSync, existsSync } from 'fs';

/**
 * Strip markdown formatting and whitespace from a paragraph — turn
 * "**Physical Description:**  \nIsha is a 16-year-old..." into plain
 * prose ready for truncation.
 */
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pull the first N characters of the character's visual-description
 * paragraph. Looks for a header like "Physical Description", then
 * extracts the following block until the next blank line or next header.
 *
 * Returns null if no physical-description section is found — callers
 * skip this character rather than guessing.
 */
export function extractPhysicalDescription(md: string, maxChars = 220): string | null {
  // Find the Physical Description header. Tolerant of varied formatting:
  //   **Physical Description:**
  //   #### Physical Description (Anime Style)
  //   **Physical Description (Anime Style):**
  const headerMatch = md.match(/(?:^|\n)[*#\s]*Physical Description[^\n]*\n/i);
  if (!headerMatch) return null;

  const start = headerMatch.index! + headerMatch[0].length;
  // Take until the next blank line OR the next markdown header
  // (whichever comes first).
  const rest = md.slice(start);
  const blankLine = rest.search(/\n\s*\n/);
  const nextHeader = rest.search(/\n[*#\s]*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*[:\n]/);
  let stop = rest.length;
  if (blankLine >= 0) stop = Math.min(stop, blankLine);
  if (nextHeader >= 0) stop = Math.min(stop, nextHeader);

  const paragraph = stripMarkdown(rest.slice(0, stop));
  if (!paragraph) return null;

  if (paragraph.length <= maxChars) return paragraph;

  // Truncate at a sentence or clause boundary near maxChars so the tag
  // ends cleanly rather than mid-word.
  const truncated = paragraph.slice(0, maxChars);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastComma = truncated.lastIndexOf(',');
  const cut = lastPeriod > maxChars * 0.6
    ? lastPeriod + 1
    : lastComma > maxChars * 0.7
      ? lastComma
      : truncated.lastIndexOf(' ');
  return truncated.slice(0, cut > 0 ? cut : maxChars).trim();
}

/**
 * Read a character profile and extract its visual tag, or null if the
 * file is missing/unreadable/has no physical-description section.
 */
export function readCharacterVisualTag(
  mdPath: string,
  maxChars = 220,
): string | null {
  if (!existsSync(mdPath)) return null;
  try {
    const content = readFileSync(mdPath, 'utf-8');
    return extractPhysicalDescription(content, maxChars);
  } catch {
    return null;
  }
}

export interface CharacterRef {
  refId: string;
  mdPath: string; // absolute path to the character's .md file
}

/**
 * Build a <character_tags> prompt block. Only fires when >=2 characters
 * are in the shot — a single character doesn't need disambiguation, and
 * the motion_directive_guide's standing rule is "no appearance
 * descriptions" for solo shots (the image already carries that).
 *
 * Returns an empty string when fewer than 2 characters are visible or
 * when no tags could be extracted.
 */
export function buildCharacterTagsBlock(chars: CharacterRef[]): string {
  if (chars.length < 2) return '';

  const tags: Array<{ refId: string; tag: string }> = [];
  for (const c of chars) {
    const tag = readCharacterVisualTag(c.mdPath);
    if (tag) tags.push({ refId: c.refId, tag });
  }

  if (tags.length < 2) return '';

  const lines = tags.map(t => `- ${t.refId}: ${t.tag}`).join('\n');
  return `\n\n<character_tags>\nThis shot has ${chars.length} characters. The video model does NOT know these characters by name. When you name any of them in the motion directive, use a SHORT visual tag drawn from these descriptions (e.g. "the older woman in the faded blue salwar"), not the proper name. Keep each tag under ~8 words.\n\n${lines}\n</character_tags>`;
}
