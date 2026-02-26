import { parseImagePlacementsWithErrors } from './imagePlacementsParser.js';
import { parseVideoPlacementsWithErrors } from './videoPlacementsParser.js';
import type { AssetInfo } from './types.js';

export type PlacementMediaKind = 'image' | 'video';
export type PlacementAssetType = 'scene_image' | 'scene_video';

export interface ParsedPlacementNumbersResult {
  numbers: number[];
  parseable: boolean;
}

export interface PlacementProgressSummary {
  total: number;
  completed: number;
  pending: number;
  percentage: number;
  completedNumbers: number[];
  missingNumbers: number[];
}

function normalizePlacementNumbers(numbers: number[]): number[] {
  return [...new Set(numbers.filter((value) => Number.isFinite(value) && value > 0))]
    .map((value) => Math.floor(value))
    .sort((left, right) => left - right);
}

function parseNumericPlacement(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

export function parsePlacementNumbersFromMarkdown(
  kind: PlacementMediaKind,
  content: string,
): ParsedPlacementNumbersResult {
  try {
    if (kind === 'image') {
      const result = parseImagePlacementsWithErrors(content, false, {
        validateOverlaps: true,
      });
      return {
        numbers: normalizePlacementNumbers(
          result.placements.map((placement) => placement.placementNumber),
        ),
        parseable: !(result.errors.length > 0 && result.placements.length === 0),
      };
    }

    const result = parseVideoPlacementsWithErrors(content, false, {
      validateOverlaps: true,
      validationConfig: {
        // Keep 1s placements (including AUTO GAP entries) when computing totals.
        minDurationSeconds: 1,
      },
    });
    return {
      numbers: normalizePlacementNumbers(
        result.placements.map((placement) => placement.placementNumber),
      ),
      parseable: !(result.errors.length > 0 && result.placements.length === 0),
    };
  } catch {
    return {
      numbers: [],
      parseable: false,
    };
  }
}

export function getGeneratedPlacementNumbersFromAssets(
  assets: AssetInfo[],
  assetType: PlacementAssetType,
): number[] {
  const numbers: number[] = [];
  for (const asset of assets) {
    if (asset.type !== assetType) continue;
    const rawPlacement = asset.metadata?.['placementNumber'] ?? asset.scene_number;
    const placementNumber = parseNumericPlacement(rawPlacement);
    if (placementNumber !== null && placementNumber > 0) {
      numbers.push(placementNumber);
    }
  }
  return normalizePlacementNumbers(numbers);
}

export function buildPlacementProgressFromNumbers(
  expectedPlacementNumbers: number[],
  generatedPlacementNumbers: number[],
): PlacementProgressSummary {
  const expected = normalizePlacementNumbers(expectedPlacementNumbers);
  const generated = new Set<number>(normalizePlacementNumbers(generatedPlacementNumbers));

  const completedNumbers: number[] = [];
  const missingNumbers: number[] = [];
  for (const placementNumber of expected) {
    if (generated.has(placementNumber)) {
      completedNumbers.push(placementNumber);
    } else {
      missingNumbers.push(placementNumber);
    }
  }

  const total = expected.length;
  const completed = completedNumbers.length;
  const pending = missingNumbers.length;
  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);

  return {
    total,
    completed,
    pending,
    percentage,
    completedNumbers,
    missingNumbers,
  };
}
