/**
 * Build the `<story-essence>` block injected into per-scene prose
 * generation prompts. ExecutorAgent's `buildPromptContext` calls this
 * for `scene` typeId nodes when `prompts/story_essence.json` has been
 * generated.
 *
 * Returns an empty string when essence is absent — the block is purely
 * additive, so legacy projects (and the current main branch) keep
 * producing prose exactly as before until they get an essence file.
 */
import type { StoryEssence } from './storyEssenceExtractor.js';

/**
 * Genre-tuned guidance — one short paragraph per genre that tells the
 * scene-prose writer how this kind of story wants to be told. Match is
 * case-insensitive substring; first hit wins. Unknown genres fall back
 * to the generic guidance below.
 */
const GENRE_GUIDANCE: Array<{ pattern: RegExp; advice: string }> = [
  {
    pattern: /emotional drama|drama|literary|character study|domestic/i,
    advice:
      'Linger on quiet moments. Let silence between dialogue carry weight. Show internal state through small physical detail — a held look, a hand that hovers, a breath that doesn\'t come. Prefer specificity over abstraction.',
  },
  {
    pattern: /action|thriller|chase|kinetic/i,
    advice:
      'Keep prose punchy. Verb-first sentences. Cut quick between beats. Tight, kinetic, no breathing room — the camera should feel restless.',
  },
  {
    pattern: /erotica|sensual|intimate|romance/i,
    advice:
      'Slow build. Sensory specificity over plot — texture, weight, breath, touch. Pacing favours intimacy. Let small moments hold.',
  },
  {
    pattern: /horror|dread|unsettling/i,
    advice:
      'Build dread through what\'s NOT shown. Negative space. The prose should feel like the camera is afraid to turn around. Sound and silence both carry threat.',
  },
  {
    pattern: /comedy|comedic|farce/i,
    advice:
      'Timing is everything. Tight set-ups, surprising payoffs. Specific physical detail beats abstraction every time — the prose should hand the camera concrete, visible bits.',
  },
  {
    pattern: /sci-?fi|science fiction|speculative/i,
    advice:
      'Ground the speculative in tactile, physical detail — wires, metal, light, breath. Make the unfamiliar feel inhabited. Avoid lore-dumps; show the world through use.',
  },
];

const GENERIC_GUIDANCE =
  'Write the prose in service of the throughline and tonal notes above. Match the tone the essence describes — pacing, register, what the camera dwells on. The essence is the editorial north star; let it shape every line.';

function pickGuidance(genre: string): string {
  for (const { pattern, advice } of GENRE_GUIDANCE) {
    if (pattern.test(genre)) return advice;
  }
  return GENERIC_GUIDANCE;
}

function buildNarrationDirective(essence: StoryEssence): string {
  const n = essence.narration;
  if (!n || n.mode === 'none') return '';

  const scopeLine = n.mode === 'pervasive'
    ? 'A narrator carries load-bearing exposition through this video. Use narration where the camera and dialogue genuinely cannot show interior content — but do not over-narrate; if a moment can land visually, prefer the image.'
    : 'A narrator appears sparingly — only at scene transitions or for one or two key exposition beats that camera and dialogue cannot carry. Default to scene-and-dialogue; reach for narration only when interior content or compression genuinely demands it.';

  return [
    '',
    `NARRATION: ${n.mode}. Voice: ${n.voice}.`,
    scopeLine,
    'Format narration as explicit, marked blocks so downstream tooling (TTS pipeline, subtitles) can extract them. Use the marker `**NARRATION (V.O.):**` followed by the spoken line in plain quotes. Example:',
    '    **NARRATION (V.O.):** "She had told her daughter the shoes were a gift. A lie. A necessary, beautiful lie."',
    'Narration earns its place when it tells the audience something the visuals genuinely cannot — interior thought, retrospective context, time-jump anchors. Do NOT use narration to summarize what the next shot will show.',
  ].join('\n');
}

export function buildStoryEssenceBlock(essence: StoryEssence | null | undefined): string {
  if (!essence) return '';
  const guidance = pickGuidance(essence.genre);
  const narrationDirective = buildNarrationDirective(essence);
  const lines: string[] = [
    '',
    '<story-essence>',
    `GENRE: ${essence.genre}`,
    `THROUGHLINE: ${essence.throughline}`,
    `TONAL NOTES: ${essence.tonalNotes}`,
    `DRAMATIC EMPHASIS: ${essence.dramaticEmphasis}`,
    '',
    `Write this scene's prose IN SERVICE OF the essence above. ${guidance}`,
  ];
  if (narrationDirective) {
    // narrationDirective starts with a leading blank line for separation
    lines.push(narrationDirective);
  }
  lines.push('</story-essence>');
  return lines.join('\n');
}
