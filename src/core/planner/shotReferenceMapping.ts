/**
 * Shot reference mapping: gathers available reference images from the
 * executor graph and formats them for LLM injection.
 *
 * Replaces the old approach of reading characters/settings from
 * scene_video_prompt JSON. Now simply gathers ALL completed
 * character_image, setting_image, and object_image nodes — the LLM
 * decides which to reference based on the shot description.
 */

export interface AvailableRef {
  imageNumber: number;
  type: 'character' | 'setting' | 'object';
  refId: string;
  label: string;
}

interface MinimalExecutor {
  getAllNodes(): Array<{
    id: string;
    typeId: string;
    itemId?: string;
    status: string;
    outputPath?: string;
  }>;
}

const REF_TYPE_IDS = ['character_image', 'setting_image', 'object_image'] as const;

function typeIdToRefType(typeId: string): 'character' | 'setting' | 'object' {
  if (typeId === 'character_image') return 'character';
  if (typeId === 'setting_image') return 'setting';
  return 'object';
}

/**
 * Gather all completed reference image nodes from the executor graph.
 * Returns them numbered sequentially (image 1, 2, 3...).
 */
export function buildAvailableReferences(executor: MinimalExecutor): { refs: AvailableRef[] } {
  // Include ALL ref nodes (not just completed) — shot_image_prompt only needs
  // the refId identifiers, not actual .png files. Image resolution happens
  // later at shot_image generation time.
  const nodes = executor.getAllNodes().filter(n =>
    (REF_TYPE_IDS as readonly string[]).includes(n.typeId)
    && n.itemId, // Must have an itemId (expanded collection node)
  );

  let imageNum = 1;
  const refs: AvailableRef[] = nodes.map(n => ({
    imageNumber: imageNum++,
    type: typeIdToRefType(n.typeId),
    refId: n.id,
    label: n.itemId ?? n.id.split(':')[1] ?? n.id,
  }));

  return { refs };
}

/**
 * Format available references as an XML block for LLM injection.
 */
export function formatReferencesForPrompt(refs: AvailableRef[]): string {
  if (refs.length === 0) {
    return '\n\n<available_references>\nNo reference images available. Set generationMode to "text_to_image" and references to [].\n</available_references>';
  }

  const refList = refs.map(r =>
    `- image ${r.imageNumber}: ${r.type} "${r.label}" (ref_id: "${r.refId}")`,
  ).join('\n');

  return `\n\n<available_references>\nAvailable reference images for this shot:\n${refList}\n\nUse "from image N" in your imagePrompt. Include each used reference in the "references" array with its ref_id.\n</available_references>`;
}

/**
 * Purposes that require a FRESH composition (no prior-shot chaining).
 * Kept in sync with `crossShotChaining.FRESH_PURPOSES`. Duplicated locally to
 * avoid pulling in cross-shot chain logic as a dependency of ref mapping.
 */
const FRESH_PURPOSES = new Set([
  'set_the_world',
  'show_change',
  'meet_character',
  'set_the_mood',
]);

/**
 * Build a shot context hint block with generation mode directives for the
 * image-anchored shot chain strategy.
 *
 * Policy:
 * - Shot 1 of any scene → fresh (no base image to chain from).
 * - Mid-scene shot with continuityRole entry/exit/bridge → fresh (explicit
 *   location transition; force a new composition).
 * - Mid-scene shot whose purpose is a composition reset (set_the_world,
 *   show_change, meet_character, set_the_mood) → fresh.
 * - All other mid-scene shots → HARD directive to use edit_previous_shot.
 *   This is what maintains visual continuity + character consistency: the
 *   base is the previous shot's last_frame, and character refs are layered
 *   on top by FLUX Klein.
 */
export function buildShotContextHint(
  itemId: string,
  previousShotAvailable: boolean,
  opts: {
    /** Current shot's perspective ('main_subject', 'observer', etc.) */
    currentPerspective?: string;
    /** Previous shot's perspective, if we could read it */
    previousPerspective?: string;
    /** Current shot's continuityRole ('none', 'entry', 'exit', 'bridge') */
    continuityRole?: string;
    /** Current shot's purpose (affects whether to chain or reset) */
    purpose?: string;
  } = {},
): string {
  const shotMatch = itemId.match(/shot_(\d+)/);
  const shotNum = shotMatch?.[1] ? parseInt(shotMatch[1], 10) : 1;

  const lines: string[] = [];
  lines.push(`Shot ${shotNum} of this scene.`);

  if (shotNum === 1) {
    lines.push('This is the first shot in the scene. Use "image_text_to_image" or "text_to_image" — there is no previous shot to chain from.');
    lines.push('last_frame should use generationMode "edit_first_frame".');
  } else if (previousShotAvailable) {
    const isBridge =
      opts.continuityRole === 'entry' ||
      opts.continuityRole === 'exit' ||
      opts.continuityRole === 'bridge';
    const isFreshPurpose = opts.purpose ? FRESH_PURPOSES.has(opts.purpose) : false;

    if (isBridge) {
      lines.push(
        `continuityRole="${opts.continuityRole}" — location transition shot. ` +
        `Use "image_text_to_image" with fresh generation for first_frame.`,
      );
    } else if (isFreshPurpose) {
      lines.push(
        `purpose="${opts.purpose}" — this is a composition reset. ` +
        `Use "image_text_to_image" for first_frame (fresh framing), not edit_previous_shot.`,
      );
    } else {
      // HARD DIRECTIVE — enforce image-anchored shot chain for continuity + consistency.
      lines.push(`Previous shot (shot ${shotNum - 1}) is available.`);
      lines.push(
        `DIRECTIVE: For first_frame you MUST use generationMode "edit_previous_shot". ` +
        `The base image will be the previous shot's last_frame; layer character/setting ` +
        `references on top via the references array. This guarantees visual continuity ` +
        `and character consistency. DO NOT use "image_text_to_image" for this shot.`,
      );
      lines.push(
        `Include every character/setting reference that should remain on screen in the ` +
        `"references" array with format { imageNumber, type, refId }. Use "from image N" ` +
        `phrasing in the imagePrompt for every named subject.`,
      );
    }

    lines.push('last_frame should use generationMode "edit_first_frame".');
  } else {
    lines.push('last_frame should use generationMode "edit_first_frame".');
  }

  lines.push('aspectRatio: "16:9"');
  lines.push('generationStrategy: "flfv" (FML2V is disabled — never emit "fmlfv").');

  return `\n\n<shot_context>\n${lines.join('\n')}\n</shot_context>`;
}

/**
 * Build a fallback motion prompt from shot fields when no motion directive exists.
 * Combines description + cameraWork + audio/soundCue.
 */
export function buildFallbackMotionPrompt(shot: {
  description?: string;
  cameraWork?: string;
  audio?: string;
  soundCue?: string;
  firstFrame?: { description?: string };
}): string {
  const desc = shot.firstFrame?.description ?? shot.description ?? '';
  let prompt = desc;
  if (shot.cameraWork) prompt += ' ' + shot.cameraWork;
  const audioContent = shot.audio || shot.soundCue;
  if (audioContent) prompt += ' ' + audioContent;
  return prompt;
}

/**
 * Validate that no node has dependencies pointing to non-existent nodes.
 * Returns a list of orphaned references.
 */
export function validateNoDanglingDeps(
  nodes: Record<string, { id: string; dependencies: string[] }>,
): Array<{ nodeId: string; missingDep: string }> {
  const orphans: Array<{ nodeId: string; missingDep: string }> = [];
  for (const [nodeId, node] of Object.entries(nodes)) {
    for (const dep of node.dependencies) {
      if (!(dep in nodes)) {
        orphans.push({ nodeId, missingDep: dep });
      }
    }
  }
  return orphans;
}

/**
 * Filter available references based on shot purpose.
 * Returns filtered refs and the suggested generation mode.
 */
export function filterRefsByPurpose(
  allRefs: AvailableRef[],
  purpose: string,
): { refs: AvailableRef[]; generationMode: string } {
  switch (purpose) {
    case 'set_the_world':
    case 'show_passage':
      return { refs: allRefs.filter(r => r.type === 'setting'), generationMode: 'image_text_to_image' };

    case 'set_the_mood':
      return { refs: [], generationMode: 'text_to_image' };

    case 'show_clue':
      // Clue shots may still reference characters/settings (e.g., a phantom, a hand holding an object)
      return { refs: allRefs.filter(r => r.type === 'character' || r.type === 'setting'), generationMode: 'image_text_to_image' };

    case 'meet_character':
      return { refs: allRefs.filter(r => r.type !== 'object'), generationMode: 'image_text_to_image' };

    case 'show_dialogue':
    case 'show_reaction':
    case 'hold_emotion':
    case 'show_tension':
      return { refs: allRefs.filter(r => r.type === 'character' || r.type === 'setting'), generationMode: 'image_text_to_image' };

    case 'show_action':
    case 'show_change':
    case 'punctuate':
    default:
      return { refs: allRefs, generationMode: 'image_text_to_image' };
  }
}
