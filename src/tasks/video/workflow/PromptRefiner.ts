/**
 * PromptRefiner - Handles conversational prompt refinement with comparison.
 * Uses LLM to generate refined prompts based on user feedback.
 */

import type { LLMClient } from '../../../core/llm/LLMClient.js';
import type { ArtifactState, PromptVersion, PromptRefinement, PromptComparison } from './types.js';
import { ArtifactManager } from './ArtifactManager.js';
import type { Message } from '../../../core/llm/types.js';

export class PromptRefiner {
  private artifactManager: ArtifactManager;
  private llm: LLMClient;

  constructor(artifactManager: ArtifactManager, llm: LLMClient) {
    this.artifactManager = artifactManager;
    this.llm = llm;
  }

  /**
   * Refine a prompt based on user feedback.
   */
  async refine(artifactId: string, feedback: string): Promise<PromptRefinement> {
    const artifact = this.artifactManager.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    const currentPrompt = artifact.prompt;
    const currentVersion = artifact.promptVersion;

    const refinedPrompt = await this.generateRefinement(currentPrompt, feedback);

    const changes = this.detectChanges(currentPrompt, refinedPrompt);

    const proposedVersion = this.artifactManager.addPromptVersion(
      artifactId,
      refinedPrompt,
      feedback
    );

    return {
      currentVersion,
      proposedVersion,
      proposedPrompt: refinedPrompt,
      changes,
      explanation: this.explainChanges(changes),
    };
  }

  /**
   * Generate a refined prompt using the LLM.
   */
  private async generateRefinement(currentPrompt: string, feedback: string): Promise<string> {
    const systemMessage: Message = {
      role: 'system',
      content: `You are a prompt engineering expert. Your task is to refine prompts based on user feedback.

Rules:
1. Preserve the core content and structure of the original prompt
2. Only change elements specifically mentioned in the feedback
3. Make minimal, targeted modifications
4. Keep the same level of detail and specificity
5. Return ONLY the refined prompt, no explanations

Example:
Original: "A wide shot of a sports complex with a running track"
Feedback: "Make it more dramatic"
Refined: "A dramatic wide shot of a sports complex with a running track, golden hour lighting, long shadows"`,
    };

    const userMessage: Message = {
      role: 'user',
      content: `Original prompt:
${currentPrompt}

User feedback:
${feedback}

Refined prompt:`,
    };

    const response = await this.llm.generate({
      messages: [systemMessage, userMessage],
      maxTokens: 2000,
    });

    return response.content || currentPrompt;
  }

  /**
   * Detect what changed between two prompts.
   */
  private detectChanges(original: string, refined: string): string[] {
    const changes: string[] = [];

    const originalLower = original.toLowerCase();
    const refinedLower = refined.toLowerCase();

    const lightingKeywords = [
      'golden hour',
      'dramatic',
      'bright',
      'dim',
      'dark',
      'shadow',
      'lighting',
      'sunset',
      'sunrise',
      'daylight',
    ];
    for (const keyword of lightingKeywords) {
      if (refinedLower.includes(keyword) && !originalLower.includes(keyword)) {
        changes.push(`Added: ${keyword}`);
      }
    }

    const moodKeywords = [
      'epic',
      'dramatic',
      'serene',
      'tense',
      'peaceful',
      'vibrant',
      'muted',
      'colorful',
    ];
    for (const keyword of moodKeywords) {
      if (refinedLower.includes(keyword) && !originalLower.includes(keyword)) {
        changes.push(`Mood: ${keyword}`);
      } else if (originalLower.includes(keyword) && !refinedLower.includes(keyword)) {
        changes.push(`Removed mood: ${keyword}`);
      }
    }

    const perspectiveKeywords = [
      'wide shot',
      'close-up',
      'medium shot',
      'aerial',
      'drone',
      'eye level',
      'low angle',
      'high angle',
    ];
    for (const keyword of perspectiveKeywords) {
      if (refinedLower.includes(keyword) && !originalLower.includes(keyword)) {
        changes.push(`Perspective: ${keyword}`);
      }
    }

    if (changes.length === 0) {
      changes.push('Subtle refinements made');
    }

    return changes;
  }

  /**
   * Generate a human-readable explanation of changes.
   */
  private explainChanges(changes: string[]): string {
    if (changes.length === 0) {
      return 'No significant changes detected.';
    }
    return `Changes: ${changes.join(', ')}.`;
  }

  /**
   * Get side-by-side comparison of two versions.
   */
  getComparison(artifactId: string, versionA: number, versionB: number): PromptComparison {
    const version1 = this.artifactManager.getVersion(artifactId, versionA);
    const version2 = this.artifactManager.getVersion(artifactId, versionB);

    if (!version1 || !version2) {
      throw new Error(`One or both versions not found for artifact ${artifactId}`);
    }

    const diff = this.generateDiff(version1.prompt, version2.prompt);

    return {
      versionA: version1,
      versionB: version2,
      diff,
    };
  }

  /**
   * Generate a simple diff between two prompts.
   */
  private generateDiff(promptA: string, promptB: string): string {
    const linesA = promptA.split('\n');
    const linesB = promptB.split('\n');
    const diffLines: string[] = [];

    const maxLines = Math.max(linesA.length, linesB.length);

    for (let i = 0; i < maxLines; i++) {
      const lineA = linesA[i] || '';
      const lineB = linesB[i] || '';

      if (lineA !== lineB) {
        if (lineA && lineB) {
          diffLines.push(`- ${lineA}`);
          diffLines.push(`+ ${lineB}`);
        } else if (lineA) {
          diffLines.push(`- ${lineA}`);
        } else {
          diffLines.push(`+ ${lineB}`);
        }
      }
    }

    return diffLines.join('\n') || 'No visible differences';
  }

  /**
   * Approve a specific version.
   */
  approveVersion(artifactId: string, version: number): void {
    const artifact = this.artifactManager.get(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    const versionEntry = this.artifactManager.getVersion(artifactId, version);
    if (!versionEntry) {
      throw new Error(`Version ${version} not found for artifact ${artifactId}`);
    }

    versionEntry.approvedAt = Date.now();

    if (version === artifact.promptVersion) {
      artifact.status = 'complete';
      artifact.approvedAt = Date.now();
    }

    this.artifactManager.update(artifactId, {
      status: artifact.status,
      approvedAt: artifact.approvedAt,
    });
  }

  /**
   * Generate comparison summary for display.
   */
  generateComparisonSummary(comparison: PromptComparison): string {
    const { versionA, versionB, diff } = comparison;

    const lines = diff.split('\n');
    const additions = lines.filter(l => l.startsWith('+')).length;
    const removals = lines.filter(l => l.startsWith('-')).length;

    return `Version ${versionA.version} → Version ${versionB.version}
${additions} additions, ${removals} changes`;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createPromptRefiner(
  artifactManager: ArtifactManager,
  llm: LLMClient
): PromptRefiner {
  return new PromptRefiner(artifactManager, llm);
}
