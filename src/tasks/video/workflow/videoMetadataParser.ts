/**
 * Video-level metadata utilities used by image/video prompt preparation.
 * Canonical source is JSON (agent/metadata/video-context.json), with optional markdown mirror.
 */

export interface VideoMetadata {
  subjectMatter: string;
  timePeriod: string;
  geographicContext: string;
  visualStyle: string;
  anachronismsToAvoid: string[];
  visualConsistencyRequirements: string[];
  /** Detailed summary of the transcript content (not truncated). */
  transcriptSummary: string;
  /** Emotional/informational tone: educational, inspirational, serious, humorous, etc. */
  toneAndMood: string;
  /** Main topics/themes extracted from the transcript. */
  keyTopics: string[];
  /** People, books, concepts, brands, or other named entities mentioned. */
  keyEntities: string[];
  /** Content domain/genre: self-help, history, science, technology, etc. */
  contentCategory: string;
}

const DEFAULT_VISUAL_STYLE = 'Documentary educational style, photorealistic, historically grounded when relevant.';
const DEFAULT_CONSISTENCY = [
  'Documentary realism over stylization',
  'Period-accurate props, clothing, and architecture when historical',
  '16:9 composition suitable for educational video',
];
const DEFAULT_HISTORICAL_ANACHRONISMS = [
  'plastic materials',
  'modern vehicles',
  'concrete highways and modern infrastructure',
  'smartphones and digital screens',
  'electric neon lighting',
  'synthetic fabrics',
];

function normalizeString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,\n]/)
      .map((item) => item.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean);
  }
  return [];
}

export function isLikelyHistoricalTimePeriod(timePeriod: string): boolean {
  const normalized = timePeriod.toLowerCase();
  if (!normalized) return false;
  if (
    normalized.includes('bce') ||
    normalized.includes('bc') ||
    normalized.includes('century') ||
    normalized.includes('medieval') ||
    normalized.includes('ancient') ||
    normalized.includes('victorian')
  ) {
    return true;
  }

  const years = [...normalized.matchAll(/\b(\d{3,4})\b/g)]
    .map((match) => Number.parseInt(match[1] ?? '', 10))
    .filter((year) => Number.isFinite(year));
  if (years.length === 0) return false;
  return years.some((year) => year < 1950);
}

export function normalizeVideoMetadata(raw: Partial<VideoMetadata>): VideoMetadata {
  const subjectMatter = normalizeString(raw.subjectMatter) || 'Video subject not explicitly specified';
  const timePeriod = normalizeString(raw.timePeriod) || 'Time period not explicitly specified';
  const geographicContext = normalizeString(raw.geographicContext) || 'Geographic context not explicitly specified';
  const visualStyle = normalizeString(raw.visualStyle) || DEFAULT_VISUAL_STYLE;

  let anachronismsToAvoid = normalizeStringArray(raw.anachronismsToAvoid);
  if (anachronismsToAvoid.length === 0 && isLikelyHistoricalTimePeriod(timePeriod)) {
    anachronismsToAvoid = [...DEFAULT_HISTORICAL_ANACHRONISMS];
  }

  const visualConsistencyRequirements =
    normalizeStringArray(raw.visualConsistencyRequirements).length > 0
      ? normalizeStringArray(raw.visualConsistencyRequirements)
      : [...DEFAULT_CONSISTENCY];

  const transcriptSummary = normalizeString(raw.transcriptSummary) || '';
  const toneAndMood = normalizeString(raw.toneAndMood) || '';
  const keyTopics = normalizeStringArray(raw.keyTopics);
  const keyEntities = normalizeStringArray(raw.keyEntities);
  const contentCategory = normalizeString(raw.contentCategory) || '';

  return {
    subjectMatter,
    timePeriod,
    geographicContext,
    visualStyle,
    anachronismsToAvoid,
    visualConsistencyRequirements,
    transcriptSummary,
    toneAndMood,
    keyTopics,
    keyEntities,
    contentCategory,
  };
}

export function parseVideoMetadataJson(content: string | null): VideoMetadata | null {
  if (!content || !content.trim()) return null;
  try {
    const parsed = JSON.parse(content) as Partial<VideoMetadata>;
    if (!parsed || typeof parsed !== 'object') return null;
    return normalizeVideoMetadata(parsed);
  } catch {
    return null;
  }
}

function getMarkdownSection(content: string, heading: string): string {
  const lines = content.split(/\r?\n/);
  const targetHeading = `## ${heading}`.toLowerCase();

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim().toLowerCase() === targetHeading) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return '';

  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (lines[i]?.trim().startsWith('## ')) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

export function parseVideoMetadataMarkdown(content: string | null): VideoMetadata | null {
  if (!content || !content.trim()) return null;

  const subjectMatter = getMarkdownSection(content, 'Subject Matter');
  const timePeriod = getMarkdownSection(content, 'Time Period(s)');
  const geographicContext = getMarkdownSection(content, 'Geographic/Cultural Context');
  const visualStyle = getMarkdownSection(content, 'Visual Style');
  const anachronismsToAvoid = normalizeStringArray(getMarkdownSection(content, 'Anachronisms to Avoid'));
  const visualConsistencyRequirements = normalizeStringArray(
    getMarkdownSection(content, 'Visual Consistency Requirements'),
  );
  const transcriptSummary = getMarkdownSection(content, 'Transcript Summary');
  const toneAndMood = getMarkdownSection(content, 'Tone and Mood');
  const keyTopics = normalizeStringArray(getMarkdownSection(content, 'Key Topics'));
  const keyEntities = normalizeStringArray(getMarkdownSection(content, 'Key Entities'));
  const contentCategory = getMarkdownSection(content, 'Content Category');

  if (!subjectMatter && !timePeriod && !geographicContext && !visualStyle) {
    return null;
  }

  return normalizeVideoMetadata({
    subjectMatter,
    timePeriod,
    geographicContext,
    visualStyle,
    anachronismsToAvoid,
    visualConsistencyRequirements,
    transcriptSummary,
    toneAndMood,
    keyTopics,
    keyEntities,
    contentCategory,
  });
}

function extractPrimarySubject(contentPlan: string): string {
  const firstHeading = contentPlan.match(/^#\s+(.+)$/m);
  if (firstHeading && firstHeading[1]) return firstHeading[1].trim();

  const overviewLine = contentPlan
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 30 && !line.startsWith('#') && !line.startsWith('-'));
  if (overviewLine) {
    return overviewLine.slice(0, 160);
  }
  return '';
}

function extractTimePeriod(sourceText: string): string {
  const patterns = [
    /\b(\d{3,4}\s*(?:BCE|BC|CE|AD))\s*[-–]\s*(\d{1,4}\s*(?:BCE|BC|CE|AD)?)\b/i,
    /\b(1[5-9]\d{2}|20\d{2}|21\d{2})\s*[-–]\s*(1[5-9]\d{2}|20\d{2}|21\d{2})\b/,
    /\b(\d{1,2}(?:st|nd|rd|th)\s+century)\b/i,
    /\b(ancient|medieval|victorian|bronze age|iron age)\b/i,
  ];
  for (const pattern of patterns) {
    const match = sourceText.match(pattern);
    if (match && match[0]) return match[0].trim();
  }
  return '';
}

function extractGeographicContext(sourceText: string): string {
  const knownGeos = [
    'india',
    'china',
    'europe',
    'england',
    'britain',
    'united states',
    'america',
    'africa',
    'middle east',
    'indus valley',
    'delhi',
    'punjab',
    'new york',
  ];
  const normalized = sourceText.toLowerCase();
  const hits = knownGeos.filter((geo) => normalized.includes(geo));
  if (hits.length === 0) return '';
  return `Primary context: ${hits.slice(0, 3).join(', ')}`;
}

function cleanTranscriptText(transcript: string): string {
  return transcript
    .replace(/^-\s*\d+\s*\[[^\]]+\]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeTranscriptTopic(transcript: string): string {
  const cleaned = cleanTranscriptText(transcript);
  if (!cleaned) return '';
  return cleaned.slice(0, 180);
}

function buildTranscriptSummary(transcript: string): string {
  const cleaned = cleanTranscriptText(transcript);
  if (!cleaned) return '';
  // Use a generous limit to preserve meaningful context for downstream prompts
  return cleaned.slice(0, 2000);
}

/**
 * Regex-based fallback for deriving metadata when LLM is not available.
 * Prefer `deriveVideoMetadataWithLLM` for richer extraction.
 */
export function deriveVideoMetadata(params: {
  transcriptContent: string | null;
  contentPlan: string | null;
}): VideoMetadata | null {
  const transcript = (params.transcriptContent ?? '').trim();
  const contentPlan = (params.contentPlan ?? '').trim();
  if (!transcript && !contentPlan) return null;

  const sourceText = `${contentPlan}\n${transcript}`.trim();
  const subjectMatter = extractPrimarySubject(contentPlan) || summarizeTranscriptTopic(transcript);
  const timePeriod = extractTimePeriod(sourceText) || 'Time period not explicitly specified';
  const geographicContext = extractGeographicContext(sourceText) || 'Geographic context not explicitly specified';
  const transcriptSummary = buildTranscriptSummary(transcript);

  return normalizeVideoMetadata({
    subjectMatter,
    timePeriod,
    geographicContext,
    visualStyle: DEFAULT_VISUAL_STYLE,
    anachronismsToAvoid: [],
    visualConsistencyRequirements: [...DEFAULT_CONSISTENCY],
    transcriptSummary,
    toneAndMood: '',
    keyTopics: [],
    keyEntities: [],
    contentCategory: '',
  });
}

export function formatVideoMetadataMarkdown(metadata: VideoMetadata): string {
  const lines: string[] = [];
  lines.push('# Video Context Metadata');
  lines.push('');
  lines.push('## Subject Matter');
  lines.push(metadata.subjectMatter);
  lines.push('');
  lines.push('## Transcript Summary');
  lines.push(metadata.transcriptSummary || '(not available)');
  lines.push('');
  lines.push('## Content Category');
  lines.push(metadata.contentCategory || '(not specified)');
  lines.push('');
  lines.push('## Tone and Mood');
  lines.push(metadata.toneAndMood || '(not specified)');
  lines.push('');
  lines.push('## Key Topics');
  if (metadata.keyTopics.length === 0) {
    lines.push('- (none)');
  } else {
    for (const item of metadata.keyTopics) {
      lines.push(`- ${item}`);
    }
  }
  lines.push('');
  lines.push('## Key Entities');
  if (metadata.keyEntities.length === 0) {
    lines.push('- (none)');
  } else {
    for (const item of metadata.keyEntities) {
      lines.push(`- ${item}`);
    }
  }
  lines.push('');
  lines.push('## Time Period(s)');
  lines.push(metadata.timePeriod);
  lines.push('');
  lines.push('## Geographic/Cultural Context');
  lines.push(metadata.geographicContext);
  lines.push('');
  lines.push('## Visual Style');
  lines.push(metadata.visualStyle);
  lines.push('');
  lines.push('## Anachronisms to Avoid');
  if (metadata.anachronismsToAvoid.length === 0) {
    lines.push('- (none)');
  } else {
    for (const item of metadata.anachronismsToAvoid) {
      lines.push(`- ${item}`);
    }
  }
  lines.push('');
  lines.push('## Visual Consistency Requirements');
  if (metadata.visualConsistencyRequirements.length === 0) {
    lines.push('- (none)');
  } else {
    for (const item of metadata.visualConsistencyRequirements) {
      lines.push(`- ${item}`);
    }
  }
  lines.push('');
  return `${lines.join('\n').trim()}\n`;
}
