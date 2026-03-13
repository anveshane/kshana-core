/**
 * PromptChangeDetector — maps prompt files to affected tests.
 *
 * Used in CI or git hooks to determine which tests need re-running
 * with real LLM (not just replay) when prompt files change.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * A mapping from prompt file patterns to test file patterns.
 */
export interface PromptTestMapping {
  /** Glob pattern for prompt files */
  promptPattern: string;
  /** Test files or patterns that should re-run when these prompts change */
  testPatterns: string[];
  /** Description of this mapping */
  description: string;
}

/**
 * Result of detecting prompt changes.
 */
export interface ChangeDetectionResult {
  /** Prompt files that changed */
  changedPrompts: string[];
  /** Test files that should be re-run with real LLM */
  affectedTests: string[];
  /** Recordings that should be re-recorded */
  affectedRecordings: string[];
  /** Whether any prompt changes were detected */
  hasChanges: boolean;
}

/**
 * Default prompt → test mappings.
 */
const DEFAULT_MAPPINGS: PromptTestMapping[] = [
  {
    promptPattern: 'prompts/system/orchestrator.md',
    testPatterns: ['tests/scenarios/**/*.test.ts', 'tests/golden/**/*.test.ts'],
    description: 'Main orchestrator prompt affects all scenario and golden tests',
  },
  {
    promptPattern: 'prompts/system/subagent.md',
    testPatterns: ['tests/scenarios/**/*.test.ts'],
    description: 'Subagent prompt affects scenario tests',
  },
  {
    promptPattern: 'prompts/subagents/*.md',
    testPatterns: ['tests/scenarios/**/*.test.ts', 'tests/evals/**/*.test.ts'],
    description: 'Subagent-specific prompts affect scenarios and evals',
  },
  {
    promptPattern: 'prompts/templates/*/orchestrator.md',
    testPatterns: ['tests/scenarios/**/*.test.ts', 'tests/golden/**/*.test.ts'],
    description: 'Template orchestrator prompts affect scenarios and golden tests',
  },
  {
    promptPattern: 'prompts/system/classification/*.md',
    testPatterns: ['tests/evals/classification/**/*.test.ts'],
    description: 'Classification prompts affect classification evals',
  },
];

/**
 * Detects which prompt files have changed and maps them to affected tests.
 */
export class PromptChangeDetector {
  private projectRoot: string;
  private mappings: PromptTestMapping[];

  constructor(projectRoot: string, mappings?: PromptTestMapping[]) {
    this.projectRoot = projectRoot;
    this.mappings = mappings ?? DEFAULT_MAPPINGS;
  }

  /**
   * Detect changes against a git ref (default: HEAD~1).
   */
  detectChanges(gitRef: string = 'HEAD~1'): ChangeDetectionResult {
    const changedFiles = this.getChangedFiles(gitRef);
    const changedPrompts = changedFiles.filter(f => f.startsWith('prompts/'));

    if (changedPrompts.length === 0) {
      return {
        changedPrompts: [],
        affectedTests: [],
        affectedRecordings: [],
        hasChanges: false,
      };
    }

    const affectedTests = new Set<string>();
    const affectedRecordings = new Set<string>();

    for (const prompt of changedPrompts) {
      for (const mapping of this.mappings) {
        if (matchesPattern(prompt, mapping.promptPattern)) {
          for (const testPattern of mapping.testPatterns) {
            const matches = this.findMatchingFiles(testPattern);
            for (const match of matches) {
              affectedTests.add(match);
            }
          }
        }
      }

      // Any prompt change invalidates all recordings
      const recordings = this.findMatchingFiles('tests/recordings/**/*.recording.json');
      for (const rec of recordings) {
        affectedRecordings.add(rec);
      }
    }

    return {
      changedPrompts,
      affectedTests: [...affectedTests],
      affectedRecordings: [...affectedRecordings],
      hasChanges: true,
    };
  }

  /**
   * Get the list of files changed since a git ref.
   */
  private getChangedFiles(gitRef: string): string[] {
    try {
      const output = execSync(`git diff --name-only ${gitRef}`, {
        cwd: this.projectRoot,
        encoding: 'utf-8',
      });
      return output
        .trim()
        .split('\n')
        .filter(f => f.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Find files matching a glob-like pattern (simple implementation).
   */
  private findMatchingFiles(pattern: string): string[] {
    // Simple glob support: ** for recursive, * for single level
    const parts = pattern.split('/');
    return this.walkAndMatch(this.projectRoot, parts, 0);
  }

  private walkAndMatch(dir: string, parts: string[], partIndex: number): string[] {
    if (!existsSync(dir)) return [];

    const results: string[] = [];
    const part = parts[partIndex];
    const isLast = partIndex === parts.length - 1;

    if (part === '**') {
      // Recursive: match zero or more directories
      // Try matching the next part at this level
      if (partIndex + 1 < parts.length) {
        results.push(...this.walkAndMatch(dir, parts, partIndex + 1));
      }
      // And recurse into subdirectories
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          results.push(...this.walkAndMatch(join(dir, entry.name), parts, partIndex));
        }
      }
    } else if (part) {
      // Match specific pattern at this level
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (matchesGlob(entry.name, part)) {
          const fullPath = join(dir, entry.name);
          if (isLast) {
            if (entry.isFile()) {
              results.push(relative(this.projectRoot, fullPath));
            }
          } else if (entry.isDirectory()) {
            results.push(...this.walkAndMatch(fullPath, parts, partIndex + 1));
          }
        }
      }
    }

    return results;
  }

  /**
   * Add a custom mapping.
   */
  addMapping(mapping: PromptTestMapping): void {
    this.mappings.push(mapping);
  }

  /**
   * Get current mappings.
   */
  getMappings(): PromptTestMapping[] {
    return this.mappings;
  }
}

/**
 * Simple glob matching for file/directory names.
 */
function matchesGlob(name: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern.startsWith('*.')) {
    return name.endsWith(pattern.slice(1));
  }
  if (pattern.endsWith('*')) {
    return name.startsWith(pattern.slice(0, -1));
  }
  return name === pattern;
}

/**
 * Check if a file path matches a prompt pattern (simple matching).
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  if (pattern.includes('*')) {
    const prefix = pattern.split('*')[0]!;
    const suffix = pattern.split('*').pop()!;
    return filePath.startsWith(prefix) && filePath.endsWith(suffix);
  }
  return filePath === pattern;
}
