/**
 * Shared file utilities for reading project files and resolving entity paths.
 *
 * Used by both PromptDAGExecutor and ContentDAGExecutor to avoid duplication.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ProjectFile } from '../../tasks/video/workflow/types.js';

/**
 * Safely read a file from the project directory.
 * Returns the content or null if not found.
 */
export function readProjectFile(projectDir: string, relativePath: string): string | null {
  try {
    const fullPath = path.isAbsolute(relativePath)
      ? relativePath
      : path.join(projectDir, relativePath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fs.readFileSync(fullPath, 'utf-8');
    }
  } catch {
    // File not readable
  }
  return null;
}

/**
 * Get the file path for a character profile.
 * Checks the content registry first, falls back to convention-based path.
 */
export function getCharacterFilePath(project: ProjectFile, charName: string): string {
  const itemFiles = project.content?.characters?.itemFiles;
  if (itemFiles?.[charName]) return itemFiles[charName]!;
  const safeName = charName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return `characters/${safeName}.profile.md`;
}

/**
 * Get the file path for a setting profile.
 * Checks the content registry first, falls back to convention-based path.
 */
export function getSettingFilePath(project: ProjectFile, settingName: string): string {
  const itemFiles = project.content?.settings?.itemFiles;
  if (itemFiles?.[settingName]) return itemFiles[settingName]!;
  const safeName = settingName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return `settings/${safeName}.profile.md`;
}
