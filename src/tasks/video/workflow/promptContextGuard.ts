import type { VideoMetadata } from './videoMetadataParser.js';
import { isLikelyHistoricalTimePeriod } from './videoMetadataParser.js';

const DEFAULT_HISTORICAL_BANNED_TERMS = [
  'plastic',
  'smartphone',
  'mobile phone',
  'concrete highway',
  'electric pole',
  'neon',
  'digital screen',
  'modern car',
  'automobile',
  'skyscraper',
];

export interface PromptGuardInput {
  prompt: string;
  mediaType: 'image' | 'video';
  metadata: VideoMetadata | null;
  placementPrompt: string;
  transcriptSegment: string;
}

export interface PromptGuardResult {
  prompt: string;
  rewritten: boolean;
  usedFallback: boolean;
  reason?: string;
}

function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/^[^a-z0-9]+/, '')
    .replace(/\b(?:no|avoid|without|exclude)\b/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildBannedTerms(metadata: VideoMetadata): string[] {
  const explicit = metadata.anachronismsToAvoid
    .map(normalizeTerm)
    .filter(Boolean);
  const defaults = isLikelyHistoricalTimePeriod(metadata.timePeriod)
    ? DEFAULT_HISTORICAL_BANNED_TERMS
    : [];
  return Array.from(new Set([...explicit, ...defaults]));
}

function findBannedTerm(prompt: string, bannedTerms: string[]): string | null {
  const normalizedPrompt = prompt.toLowerCase();
  for (const term of bannedTerms) {
    if (!term) continue;
    if (normalizedPrompt.includes(term)) {
      return term;
    }
  }
  return null;
}

function rewritePrompt(prompt: string, metadata: VideoMetadata): string {
  const constraintParts = [
    `CRITICAL period context: ${metadata.timePeriod}.`,
    `Geographic/cultural context: ${metadata.geographicContext}.`,
    `Strictly avoid: ${metadata.anachronismsToAvoid.length > 0 ? metadata.anachronismsToAvoid.join(', ') : 'modern/anachronistic artifacts'}.`,
    `Visual style: ${metadata.visualStyle}.`,
  ];
  if (metadata.toneAndMood) {
    constraintParts.push(`Tone: ${metadata.toneAndMood}.`);
  }
  if (metadata.contentCategory) {
    constraintParts.push(`Content category: ${metadata.contentCategory}.`);
  }
  return `${prompt.trim()} ${constraintParts.join(' ')}`.trim();
}

function buildFallbackPrompt(
  mediaType: 'image' | 'video',
  metadata: VideoMetadata,
  placementPrompt: string,
  transcriptSegment: string,
): string {
  const contextLine = transcriptSegment
    ? `Context from narration: ${transcriptSegment}.`
    : metadata.transcriptSummary
      ? `Video context: ${metadata.transcriptSummary.slice(0, 300)}.`
      : 'No local transcript segment available.';

  const topicHint = metadata.keyTopics.length > 0
    ? ` Topics: ${metadata.keyTopics.slice(0, 3).join(', ')}.`
    : '';

  if (mediaType === 'image') {
    return [
      `Documentary-style still image about ${metadata.subjectMatter}.`,
      `Depict ${placementPrompt} in ${metadata.timePeriod}, ${metadata.geographicContext}.`,
      `Include period-accurate props, clothing, and architecture; avoid modern elements.`,
      contextLine,
      topicHint,
      `Visual style: ${metadata.visualStyle}.`,
      'Photorealistic, 16:9, 8K, high detail.',
    ].filter(Boolean).join(' ');
  }

  return [
    `Live-action documentary video footage about ${metadata.subjectMatter}.`,
    `Show ${placementPrompt} in ${metadata.timePeriod}, ${metadata.geographicContext}, with real people performing continuous actions.`,
    `Use static camera, natural environmental motion, and strictly period-accurate details.`,
    contextLine,
    topicHint,
    `Visual style: ${metadata.visualStyle}.`,
    'Live-action video footage, documentary-style video, cinematic realism, photorealistic.',
  ].filter(Boolean).join(' ');
}

export function appendMetadataConstraintsToNegativePrompt(
  negativePrompt: string,
  metadata: VideoMetadata | null,
): string {
  if (!metadata) return negativePrompt;
  const additions = metadata.anachronismsToAvoid
    .map(normalizeTerm)
    .filter(Boolean)
    .map((item) => item.replace(/\s+/g, ' '))
    .join(', ');
  if (!additions) return negativePrompt;

  const merged = `${negativePrompt}, modern elements, anachronistic artifacts, ${additions}`
    .replace(/\s*,\s*/g, ', ')
    .replace(/,\s*,+/g, ', ')
    .trim()
    .replace(/^,/, '');
  return merged;
}

export function applyPromptContextGuard(input: PromptGuardInput): PromptGuardResult {
  const metadata = input.metadata;
  if (!metadata) {
    return { prompt: input.prompt, rewritten: false, usedFallback: false };
  }

  const bannedTerms = buildBannedTerms(metadata);
  if (bannedTerms.length === 0) {
    return { prompt: input.prompt, rewritten: false, usedFallback: false };
  }

  const firstViolation = findBannedTerm(input.prompt, bannedTerms);
  if (!firstViolation) {
    return { prompt: input.prompt, rewritten: false, usedFallback: false };
  }

  const rewrittenPrompt = rewritePrompt(input.prompt, metadata);
  const rewrittenViolation = findBannedTerm(rewrittenPrompt, bannedTerms);
  if (!rewrittenViolation) {
    return {
      prompt: rewrittenPrompt,
      rewritten: true,
      usedFallback: false,
      reason: `rewritten_to_enforce_${firstViolation}`,
    };
  }

  return {
    prompt: buildFallbackPrompt(
      input.mediaType,
      metadata,
      input.placementPrompt,
      input.transcriptSegment,
    ),
    rewritten: true,
    usedFallback: true,
    reason: `fallback_after_violation_${firstViolation}`,
  };
}
