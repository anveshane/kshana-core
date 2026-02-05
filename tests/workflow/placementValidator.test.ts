import { describe, it, expect } from 'vitest';
import {
  validatePlacementSets,
  validateSinglePlacementAgainstExisting,
} from '../../src/tasks/video/workflow/PlacementValidator.js';
import { parseImagePlacementsWithErrors } from '../../src/tasks/video/workflow/imagePlacementsParser.js';

function toSeconds(time: string): number {
  const parts = time.split(':').map((part) => Number.parseInt(part, 10) || 0);
  if (parts.length === 3) {
    return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  }
  if (parts.length === 2) {
    return parts[0]! * 60 + parts[1]!;
  }
  return parts[0] ?? 0;
}

describe('PlacementValidator', () => {
  it('resolves cross-type overlaps from the reported timeline', () => {
    const imagePlacements = [
      { placementNumber: 2, startTime: '0:31', endTime: '0:47', prompt: 'image-2' },
      { placementNumber: 6, startTime: '2:33', endTime: '2:51', prompt: 'image-6' },
    ];
    const videoPlacements = [
      { placementNumber: 2, startTime: '0:38', endTime: '0:47', prompt: 'video-2', videoType: 'cinematic_realism' as const, duration: 9 },
      { placementNumber: 4, startTime: '1:47', endTime: '1:57', prompt: 'video-4', videoType: 'cinematic_realism' as const, duration: 10 },
      { placementNumber: 5, startTime: '1:57', endTime: '2:02', prompt: 'video-5', videoType: 'cinematic_realism' as const, duration: 5 },
      { placementNumber: 6, startTime: '2:33', endTime: '2:43', prompt: 'video-6', videoType: 'cinematic_realism' as const, duration: 10 },
      { placementNumber: 7, startTime: '2:43', endTime: '2:51', prompt: 'video-7', videoType: 'cinematic_realism' as const, duration: 8 },
    ];
    const infographicPlacements = [
      { placementNumber: 3, startTime: '1:47', endTime: '2:02', infographicType: 'diagram' as const, prompt: 'info-3' },
    ];

    const validated = validatePlacementSets({
      imagePlacements,
      videoPlacements,
      infographicPlacements,
    });

    const merged = [
      ...validated.imagePlacements.map((p) => ({ start: toSeconds(p.startTime), end: toSeconds(p.endTime), kind: 'image' })),
      ...validated.videoPlacements.map((p) => ({ start: toSeconds(p.startTime), end: toSeconds(p.endTime), kind: 'video' })),
      ...validated.infographicPlacements.map((p) => ({ start: toSeconds(p.startTime), end: toSeconds(p.endTime), kind: 'infographic' })),
    ].sort((a, b) => a.start - b.start);

    for (let i = 1; i < merged.length; i++) {
      expect(merged[i]!.start - merged[i - 1]!.end).toBeGreaterThanOrEqual(0);
    }
    expect(validated.warnings.length).toBeGreaterThan(0);
  });

  it('adjusts new placement against existing windows', () => {
    const result = validateSinglePlacementAgainstExisting({
      placementType: 'video',
      placementNumber: 5,
      startTimeSeconds: 20,
      endTimeSeconds: 28,
      existing: [
        {
          placementType: 'image',
          placementNumber: 1,
          startTimeSeconds: 15,
          endTimeSeconds: 22,
        },
      ],
    });

    expect(result.accepted).toBe(true);
    expect(result.startTimeSeconds).toBeGreaterThanOrEqual(22);
    expect(result.warnings.length).toBe(1);
  });

  it('rejects single placement if adjustment makes it too short', () => {
    const result = validateSinglePlacementAgainstExisting({
      placementType: 'image',
      placementNumber: 9,
      startTimeSeconds: 10,
      endTimeSeconds: 12,
      existing: [
        {
          placementType: 'video',
          placementNumber: 1,
          startTimeSeconds: 9,
          endTimeSeconds: 11.5,
        },
      ],
    });

    expect(result.accepted).toBe(false);
    expect(result.warnings.some((w) => w.includes('Rejected'))).toBe(true);
  });

  it('image parser applies overlap validation when enabled', () => {
    const content = `IMAGE_PLACER:
- Placement 1: 0:00-0:10 | One
- Placement 2: 0:05-0:12 | Two`;

    const parsed = parseImagePlacementsWithErrors(content, false, { validateOverlaps: true });
    expect(parsed.placements.length).toBe(2);
    expect(parsed.warnings.some((w) => w.includes('Dropped') || w.includes('Shifted') || w.includes('Trimmed'))).toBe(true);
  });

  it('keeps adjacent boundaries without forcing any gap', () => {
    const validated = validatePlacementSets({
      imagePlacements: [
        { placementNumber: 1, startTime: '1:48', endTime: '1:50', prompt: 'first' },
        { placementNumber: 2, startTime: '1:49', endTime: '1:55', prompt: 'second' },
      ],
      videoPlacements: [],
      infographicPlacements: [],
    });

    expect(validated.imagePlacements[0]?.endTime).toBe('1:50');
    expect(validated.imagePlacements[1]?.startTime).toBe('1:50');
  });

  it('preserves later infographic placement on tie by trimming earlier', () => {
    const validated = validatePlacementSets({
      imagePlacements: [],
      videoPlacements: [],
      infographicPlacements: [
        { placementNumber: 1, startTime: '0:10', endTime: '0:20', infographicType: 'diagram', prompt: 'one' },
        { placementNumber: 2, startTime: '0:18', endTime: '0:24', infographicType: 'diagram', prompt: 'two' },
      ],
    });

    const first = validated.infographicPlacements.find((p) => p.placementNumber === 1);
    const second = validated.infographicPlacements.find((p) => p.placementNumber === 2);

    expect(first?.endTime).toBe('0:18');
    expect(second?.startTime).toBe('0:18');
    expect(second?.endTime).toBe('0:24');
  });
});
