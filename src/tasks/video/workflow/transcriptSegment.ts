/**
 * Transcript segment extraction for placement prompt expansion.
 * Parses agent/content/transcript.md format and returns text for a given time range.
 *
 * Transcript format: - N [HH:MM:SS,mmm --> HH:MM:SS,mmm] text
 * Placement times: M:SS or MM:SS (e.g. "0:15", "1:23")
 */

/**
 * Convert placement time string (M:SS or MM:SS) to seconds.
 */
function placementTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    const hours = parseInt(parts[0] ?? '0', 10) || 0;
    const minutes = parseInt(parts[1] ?? '0', 10) || 0;
    const seconds = parseInt(parts[2] ?? '0', 10) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (parts.length === 2) {
    const minutes = parseInt(parts[0] ?? '0', 10) || 0;
    const seconds = parseInt(parts[1] ?? '0', 10) || 0;
    return minutes * 60 + seconds;
  }
  return parseInt(timeStr, 10) || 0;
}

/**
 * Parse transcript timecode (HH:MM:SS,mmm) to seconds.
 */
function parseTimecodeToSeconds(timecode: string): number {
  const match = timecode.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!match) return 0;
  const [, hh, mm, ss, ms] = match;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms) / 1000;
}

interface TranscriptEntry {
  startTime: number;
  endTime: number;
  text: string;
}

/**
 * Parse transcript markdown content into entries with start/end seconds.
 */
function parseTranscriptEntries(content: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('- ') || !trimmed.includes('-->')) continue;
    const match = trimmed.match(/^-\s*\d+\s*\[\s*(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})\s*\]\s*(.*)$/);
    if (!match || !match[1] || !match[2]) continue;
    const startTime = parseTimecodeToSeconds(match[1]);
    const endTime = parseTimecodeToSeconds(match[2]);
    const text = (match[3] ?? '').trim();
    if (text) entries.push({ startTime, endTime, text });
  }

  return entries;
}

/**
 * Get concatenated transcript text for entries overlapping [startTime, endTime].
 * startTimeStr/endTimeStr use placement format (M:SS or MM:SS).
 * Returns empty string if transcript is missing, empty, or parse fails.
 */
export function getTranscriptSegmentForTimeRange(
  transcriptContent: string | null,
  startTimeStr: string,
  endTimeStr: string
): string {
  if (!transcriptContent || !transcriptContent.trim()) return '';

  let entries: TranscriptEntry[];
  try {
    entries = parseTranscriptEntries(transcriptContent);
  } catch {
    return '';
  }
  if (entries.length === 0) return '';

  const rangeStart = placementTimeToSeconds(startTimeStr);
  const rangeEnd = placementTimeToSeconds(endTimeStr);
  const overlapping = entries.filter(
    (e) => e.startTime < rangeEnd && e.endTime > rangeStart
  );
  return overlapping.map((e) => e.text).join(' ').trim();
}
