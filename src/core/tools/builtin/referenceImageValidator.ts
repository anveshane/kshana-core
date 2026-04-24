/**
 * Post-generation validator for reference image paths in generated content.
 * Strips hallucinated paths that don't exist on disk.
 */
import fs from 'fs';
import { tryPathVariants } from './contentCreatorTools.js';
import {
  projectExists,
  projectRelativePath,
} from '../../../tasks/video/workflow/projectFileIO.js';

interface ShotEntry {
  referenceImages?: string[];
  [key: string]: unknown;
}

interface SceneVideoPrompt {
  referenceImages?: string[];
  shots?: ShotEntry[];
  [key: string]: unknown;
}

function referencePathExists(imgPath: string): boolean {
  const resolved = tryPathVariants(imgPath);
  if (resolved) return true;
  if (fs.existsSync(imgPath)) return true;

  try {
    return projectExists(projectRelativePath(imgPath));
  } catch {
    return projectExists(imgPath);
  }
}

/**
 * Validate and sanitize reference image paths in scene_video_prompt JSON content.
 * Removes paths that don't exist on disk.
 *
 * @param jsonContent - Raw JSON string of the generated content
 * @returns sanitized JSON string and list of removed paths
 */
export function validateAndSanitizeReferenceImages(
  jsonContent: string
): { sanitized: string; removedPaths: string[] } {
  const removedPaths: string[] = [];

  try {
    const parsed: SceneVideoPrompt = JSON.parse(jsonContent);

    // Validate top-level referenceImages
    if (Array.isArray(parsed.referenceImages)) {
      parsed.referenceImages = parsed.referenceImages.filter((imgPath: string) => {
        if (typeof imgPath !== 'string') return false;
        if (referencePathExists(imgPath)) return true;
        removedPaths.push(imgPath);
        return false;
      });
    }

    // Validate per-shot referenceImages
    if (Array.isArray(parsed.shots)) {
      for (const shot of parsed.shots) {
        if (Array.isArray(shot.referenceImages)) {
          shot.referenceImages = shot.referenceImages.filter((imgPath: string) => {
            if (typeof imgPath !== 'string') return false;
            if (referencePathExists(imgPath)) return true;
            // Only add to removedPaths if not already tracked
            if (!removedPaths.includes(imgPath)) {
              removedPaths.push(imgPath);
            }
            return false;
          });
        }
      }
    }

    // Caller is responsible for logging removedPaths

    return {
      sanitized: JSON.stringify(parsed, null, 2),
      removedPaths,
    };
  } catch {
    // If JSON parsing fails, return as-is
    // JSON parsing failed, skip validation
    return { sanitized: jsonContent, removedPaths: [] };
  }
}
