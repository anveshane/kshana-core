/**
 * Resume a collection's per-item list from on-disk content files,
 * deterministically — no LLM call.
 *
 * Why this exists:
 *
 * `expandPendingCollections` in ExecutorAgent has three strategies for
 * deciding which items belong to a collection node (character, setting,
 * scene, object):
 *
 *   A — find upstream per-item nodes already in the in-memory graph
 *   B — parse item names out of an upstream type-level node's content
 *   C — call the LLM to extract from the source story
 *
 * Strategy A fails after a hard restart if the previous process was
 * killed before flushing per-item nodes to executorState. Strategy B
 * only works when the upstream had a flat-list output. So Strategy C —
 * an LLM call — fires, and re-extracts. The new extraction is
 * **non-deterministic**: the same prompt at the same temperature against
 * the same upstream provider can produce 5 scenes one run and 3 the
 * next. When this happens after the user has already generated
 * downstream artifacts (shot prompts named `scene_3_shot_*` against the
 * old 3-scene split), the new 5-scene plan does not align with what's
 * on disk and you end up with a hybrid mess.
 *
 * The fix: BEFORE Strategy C, list the per-item content files that
 * already exist in the type's `filePattern` directory and rebuild the
 * item list from them. Same files in, same items out — alignment with
 * downstream artifacts is preserved.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { ArtifactTypeDefinition } from '../templates/types.js';

export interface ResumedItem {
  itemId: string;
  name: string;
}

/**
 * Scan the type's `filePattern` directory for existing per-item files
 * and return one `ResumedItem` per file. Returns `[]` when:
 *   - typeDef has no filePattern
 *   - the target dir doesn't exist
 *   - no files match the pattern's extension
 *
 * Display name comes from the file's first markdown heading
 * (`^# ...`) when present; otherwise the filename stem with
 * underscores → spaces.
 */
export function listCollectionItemsFromDisk(
  projectDir: string,
  typeDef: ArtifactTypeDefinition,
): ResumedItem[] {
  if (!typeDef.filePattern) return [];

  // The `filePattern` is shaped like `characters/{{name}}.md` or
  // `chapters/{{chapter}}/scenes/{{name}}.md`. Substitute `{{chapter}}`
  // (multi-chapter support is not yet wired through), strip the
  // `/{{name}}.<ext>` suffix to get the directory, and capture the ext.
  const concreted = typeDef.filePattern.replace(/\{\{chapter\}\}/g, 'chapter_1');
  const match = concreted.match(/^(.*)\/\{\{name\}\}\.([^./]+)$/);
  if (!match) return [];
  const [, dirRel, ext] = match;
  if (!dirRel || !ext) return [];

  const fullDir = join(projectDir, dirRel);
  if (!existsSync(fullDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(fullDir);
  } catch {
    return [];
  }

  const dotExt = `.${ext}`;
  // For markdown collections, ignore well-known sidecar metadata files
  // (manifest.json etc.) even when they happen to share a stem with a
  // real item — they're sidecar data, not items themselves.
  const SIDECAR_NAMES = new Set(['manifest.json', 'index.md', '.DS_Store']);

  const items: ResumedItem[] = [];
  for (const filename of entries) {
    if (SIDECAR_NAMES.has(filename)) continue;
    if (!filename.toLowerCase().endsWith(dotExt.toLowerCase())) continue;

    const fullPath = join(fullDir, filename);
    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }

    const stem = filename.slice(0, filename.length - dotExt.length);
    let displayName = stem.replace(/_/g, ' ');

    // Markdown files: prefer the first H1 as display name. Skip JSON/
    // other formats — there's no convention there.
    if (dotExt === '.md') {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        const headingMatch = content.match(/^#\s+(.+)$/m);
        if (headingMatch && headingMatch[1]) displayName = headingMatch[1].trim();
      } catch {
        // Fall through to stem-based name.
      }
    }

    items.push({ itemId: stem, name: displayName });
  }

  items.sort((a, b) => a.itemId.localeCompare(b.itemId));
  return items;
}
