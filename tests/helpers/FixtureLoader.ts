/**
 * Fixture Loader
 *
 * Loads test fixtures from files.
 * Supports both text and JSON fixtures.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class FixtureLoader {
  private static baseDir = join(process.cwd(), 'tests', 'fixtures');

  /**
   * Set a custom base directory for fixtures.
   */
  static setBaseDir(dir: string): void {
    this.baseDir = dir;
  }

  /**
   * Load a text fixture.
   * @param relativePath - Path relative to fixtures directory (e.g., 'inputs/narrative/simple-plot.txt')
   * @returns The file content as a string
   * @throws Error if file doesn't exist
   */
  static load(relativePath: string): string {
    const fullPath = join(this.baseDir, relativePath);

    if (!existsSync(fullPath)) {
      throw new Error(`Fixture not found: ${fullPath}`);
    }

    return readFileSync(fullPath, 'utf-8');
  }

  /**
   * Load a JSON fixture.
   * @param relativePath - Path relative to fixtures directory (e.g., 'mock-responses/narrative/plot-generation.json')
   * @returns The parsed JSON object
   * @throws Error if file doesn't exist or JSON is invalid
   */
  static loadJSON<T = unknown>(relativePath: string): T {
    const content = this.load(relativePath);
    try {
      return JSON.parse(content) as T;
    } catch (error) {
      throw new Error(`Invalid JSON in fixture: ${relativePath}\n${error}`);
    }
  }

  /**
   * Check if a fixture exists.
   * @param relativePath - Path relative to fixtures directory
   * @returns True if the fixture file exists
   */
  static exists(relativePath: string): boolean {
    const fullPath = join(this.baseDir, relativePath);
    return existsSync(fullPath);
  }

  /**
   * Load multiple fixtures by pattern.
   * @param pattern - Glob pattern relative to fixtures directory
   * @returns Array of { path, content } objects
   */
  static loadByPattern(pattern: string): Array<{ path: string; content: string }> {
    const { glob } = require('glob');
    const fullPath = join(this.baseDir, pattern);
    const files = glob.sync(fullPath);

    return files.map(file => ({
      path: file.replace(this.baseDir + '/', ''),
      content: readFileSync(file, 'utf-8'),
    }));
  }

  /**
   * Get the full path for a fixture.
   * @param relativePath - Path relative to fixtures directory
   * @returns Full absolute path
   */
  static getFullPath(relativePath: string): string {
    return join(this.baseDir, relativePath);
  }
}

/**
 * Convenience function to load a text fixture.
 */
export function loadFixture(relativePath: string): string {
  return FixtureLoader.load(relativePath);
}

/**
 * Convenience function to load a JSON fixture.
 */
export function loadJSONFixture<T = unknown>(relativePath: string): T {
  return FixtureLoader.loadJSON<T>(relativePath);
}
