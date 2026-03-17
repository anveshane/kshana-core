/**
 * Parses scene labels and durations from a generated scene breakdown markdown.
 *
 * Handles multiple format variants produced by the content creator:
 *   1. `**Scene N**` + `**Scene Title:** Title` + `**Duration Estimate:** N seconds`
 *   2. `## SCENE N: TITLE` + `**Duration:** N seconds`
 *   3. `**Scene N: Title**` + `**Duration:** 0:00 - 0:25 (25 seconds)`
 */

export interface ParsedScene {
  label: string;
  suggestedDuration?: number;
}

/**
 * Extract scene labels and durations from a scene breakdown markdown string.
 * Returns an empty array if no scenes could be parsed.
 */
export function parseSceneBreakdown(markdown: string): ParsedScene[] {
  const scenes: ParsedScene[] = [];

  // Split into scene blocks by looking for scene header patterns
  // Patterns: `## SCENE N: TITLE`, `**Scene N: Title**`, `**Scene N**`
  const sceneHeaderPattern = /(?:^|\n)(?:#{1,3}\s+SCENE\s+(\d+)[:\s]*([^\n]*)|(?:\*\*Scene\s+(\d+)(?::\s*([^*]*))?)\*\*)/gi;

  let match: RegExpExecArray | null;
  const headers: { index: number; number: number; title: string }[] = [];

  while ((match = sceneHeaderPattern.exec(markdown)) !== null) {
    const sceneNum = parseInt(match[1] ?? match[3] ?? '0', 10);
    const title = (match[2] ?? match[4] ?? '').trim();
    if (sceneNum > 0) {
      headers.push({ index: match.index, number: sceneNum, title });
    }
  }

  // Deduplicate: if we see "**Scene 2**" and then "**Scene Number:** 2" + "**Scene Title:** X",
  // keep only the first header per scene number but enrich with title from body
  const uniqueScenes = new Map<number, { index: number; number: number; title: string }>();
  for (const h of headers) {
    if (!uniqueScenes.has(h.number)) {
      uniqueScenes.set(h.number, h);
    } else if (!uniqueScenes.get(h.number)!.title && h.title) {
      uniqueScenes.get(h.number)!.title = h.title;
    }
  }

  // For each scene, extract the block of text until the next scene
  const sortedScenes = [...uniqueScenes.values()].sort((a, b) => a.index - b.index);

  for (let i = 0; i < sortedScenes.length; i++) {
    const scene = sortedScenes[i]!;
    const nextIndex = i + 1 < sortedScenes.length ? sortedScenes[i + 1]!.index : markdown.length;
    const block = markdown.substring(scene.index, nextIndex);

    // Try to extract title from body if not in header
    let label = scene.title;
    if (!label) {
      const titleMatch = block.match(/\*\*Scene Title:\*\*\s*(.+)/i);
      if (titleMatch) {
        label = titleMatch[1]!.trim();
      }
    }

    // Build the final label
    const finalLabel = label
      ? `Scene ${scene.number}: ${label}`
      : `Scene ${scene.number}`;

    // Extract duration from various patterns
    let duration: number | undefined;

    // Pattern: "**Duration Estimate:** N seconds" or "**Duration:** N seconds"
    const simpleDuration = block.match(/\*\*Duration(?:\s+Estimate)?:\*\*\s*(\d+)\s*seconds/i);
    if (simpleDuration) {
      duration = parseInt(simpleDuration[1]!, 10);
    }

    // Pattern: "**Duration:** 0:00 - 0:25 (25 seconds)"
    if (!duration) {
      const rangeDuration = block.match(/\*\*Duration:\*\*.*?\((\d+)\s*seconds?\)/i);
      if (rangeDuration) {
        duration = parseInt(rangeDuration[1]!, 10);
      }
    }

    scenes.push({ label: finalLabel, suggestedDuration: duration });
  }

  return scenes;
}
