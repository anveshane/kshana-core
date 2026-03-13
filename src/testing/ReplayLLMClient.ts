/**
 * ReplayLLMClient — replays recorded LLM responses with drift detection.
 *
 * Used in Layer 0 (Recorded Replay Tests) to deterministically replay
 * conversations that were recorded during golden flow runs. Detects
 * when the messages sent to the LLM have drifted from the recording,
 * indicating that code changes have altered prompt construction.
 */
import { readFileSync } from 'node:fs';
import type {
  Message,
  LLMResponse,
  GenerateOptions,
  StreamChunk,
} from '../core/llm/types.js';
import type { ConversationRecording, RecordedTurn } from './ConversationRecorder.js';

/**
 * How strictly to compare incoming messages against recorded messages.
 */
export type DriftTolerance = 'strict' | 'structural' | 'lenient';

/**
 * Result of comparing a single turn's messages against the recording.
 */
export interface DriftReport {
  turnIndex: number;
  score: number; // 0.0 = identical, 1.0 = completely different
  details: DriftDetail[];
}

export interface DriftDetail {
  field: string;
  type: 'added' | 'removed' | 'changed' | 'reordered';
  description: string;
}

/**
 * Options for the replay client.
 */
export interface ReplayOptions {
  /** How strictly to compare messages. Default: 'structural' */
  tolerance: DriftTolerance;
  /** Maximum drift score before failing. Default: 0.3 for structural */
  maxDriftScore?: number;
  /** If true, collect drift reports without failing. Default: false */
  reportOnly?: boolean;
}

const DEFAULT_THRESHOLDS: Record<DriftTolerance, number> = {
  strict: 0.01,
  structural: 0.3,
  lenient: 0.7,
};

/**
 * Error thrown when message drift exceeds the configured threshold.
 */
export class DriftError extends Error {
  constructor(
    public readonly report: DriftReport,
    public readonly threshold: number
  ) {
    super(
      `Drift detected at turn ${report.turnIndex}: score ${report.score.toFixed(3)} exceeds threshold ${threshold.toFixed(3)}\n` +
        report.details.map(d => `  [${d.type}] ${d.field}: ${d.description}`).join('\n')
    );
    this.name = 'DriftError';
  }
}

/**
 * Replays recorded LLM responses, comparing incoming messages against
 * the recording to detect drift from code changes.
 */
export class ReplayLLMClient {
  private recording: ConversationRecording;
  private currentTurn = 0;
  private options: Required<ReplayOptions>;
  private driftReports: DriftReport[] = [];

  constructor(recording: ConversationRecording, options?: Partial<ReplayOptions>) {
    this.recording = recording;
    const tolerance = options?.tolerance ?? 'structural';
    this.options = {
      tolerance,
      maxDriftScore: options?.maxDriftScore ?? DEFAULT_THRESHOLDS[tolerance],
      reportOnly: options?.reportOnly ?? false,
    };
  }

  /**
   * Load a recording from a JSON file and create a replay client.
   */
  static fromFile(filePath: string, options?: Partial<ReplayOptions>): ReplayLLMClient {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    return new ReplayLLMClient(data, options);
  }

  /**
   * Replay the next recorded response, checking for drift.
   */
  async generate(options: GenerateOptions): Promise<LLMResponse> {
    if (this.currentTurn >= this.recording.turns.length) {
      throw new Error(
        `Replay exhausted: received call ${this.currentTurn + 1} but recording only has ${this.recording.turns.length} turns`
      );
    }

    const recorded = this.recording.turns[this.currentTurn]!;
    const report = this.computeDrift(options.messages, recorded, this.currentTurn);
    this.driftReports.push(report);

    if (report.score > this.options.maxDriftScore && !this.options.reportOnly) {
      throw new DriftError(report, this.options.maxDriftScore);
    }

    this.currentTurn++;
    return structuredClone(recorded.response);
  }

  /**
   * Streaming replay — yields the recorded response as chunks.
   */
  async *generateStream(
    options: Omit<GenerateOptions, 'stream'>
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const response = await this.generate(options);

    if (response.content) {
      yield { content: response.content, done: false };
    }

    for (let i = 0; i < response.toolCalls.length; i++) {
      const tc = response.toolCalls[i]!;
      yield {
        toolCallDelta: {
          index: i,
          id: tc.id,
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
        done: false,
      };
    }

    yield { done: true };
  }

  async getContextLength(): Promise<number> {
    return 16000;
  }

  /**
   * Get all drift reports collected so far.
   */
  getDriftReports(): DriftReport[] {
    return this.driftReports;
  }

  /**
   * Get the maximum drift score across all turns.
   */
  getMaxDrift(): number {
    if (this.driftReports.length === 0) return 0;
    return Math.max(...this.driftReports.map(r => r.score));
  }

  /**
   * Get number of turns replayed so far.
   */
  getTurnCount(): number {
    return this.currentTurn;
  }

  /**
   * Get total turns in the recording.
   */
  getTotalTurns(): number {
    return this.recording.turns.length;
  }

  /**
   * Check if all turns have been replayed.
   */
  isComplete(): boolean {
    return this.currentTurn >= this.recording.turns.length;
  }

  /**
   * Get the underlying recording.
   */
  getRecording(): ConversationRecording {
    return this.recording;
  }

  // --- Drift computation ---

  private computeDrift(
    actual: Message[],
    recorded: RecordedTurn,
    turnIndex: number
  ): DriftReport {
    const details: DriftDetail[] = [];
    const expected = recorded.request.messages;

    switch (this.options.tolerance) {
      case 'strict':
        return this.computeStrictDrift(actual, expected, turnIndex);
      case 'structural':
        return this.computeStructuralDrift(actual, expected, turnIndex);
      case 'lenient':
        return this.computeLenientDrift(actual, expected, turnIndex);
      default:
        return { turnIndex, score: 0, details };
    }
  }

  /**
   * Strict: byte-level comparison after whitespace normalization.
   */
  private computeStrictDrift(
    actual: Message[],
    expected: Message[],
    turnIndex: number
  ): DriftReport {
    const details: DriftDetail[] = [];

    if (actual.length !== expected.length) {
      details.push({
        field: 'messages.length',
        type: 'changed',
        description: `Expected ${expected.length} messages, got ${actual.length}`,
      });
    }

    const maxLen = Math.max(actual.length, expected.length);
    let totalDiff = 0;

    for (let i = 0; i < maxLen; i++) {
      const a = actual[i];
      const e = expected[i];

      if (!a) {
        details.push({
          field: `messages[${i}]`,
          type: 'removed',
          description: `Missing message (expected ${e?.role})`,
        });
        totalDiff++;
        continue;
      }
      if (!e) {
        details.push({
          field: `messages[${i}]`,
          type: 'added',
          description: `Extra message (${a.role})`,
        });
        totalDiff++;
        continue;
      }

      if (a.role !== e.role) {
        details.push({
          field: `messages[${i}].role`,
          type: 'changed',
          description: `Expected "${e.role}", got "${a.role}"`,
        });
        totalDiff++;
      }

      const aNorm = normalizeWhitespace(a.content ?? '');
      const eNorm = normalizeWhitespace(e.content ?? '');
      if (aNorm !== eNorm) {
        details.push({
          field: `messages[${i}].content`,
          type: 'changed',
          description: `Content differs (${Math.abs(aNorm.length - eNorm.length)} chars diff)`,
        });
        totalDiff += 0.5;
      }
    }

    const score = maxLen > 0 ? totalDiff / maxLen : 0;
    return { turnIndex, score: Math.min(score, 1), details };
  }

  /**
   * Structural: same message roles, tool call names/keys match, content can vary in details.
   */
  private computeStructuralDrift(
    actual: Message[],
    expected: Message[],
    turnIndex: number
  ): DriftReport {
    const details: DriftDetail[] = [];
    let totalDiff = 0;
    const maxLen = Math.max(actual.length, expected.length);

    // Check message count
    if (actual.length !== expected.length) {
      details.push({
        field: 'messages.length',
        type: 'changed',
        description: `Expected ${expected.length} messages, got ${actual.length}`,
      });
      totalDiff += Math.abs(actual.length - expected.length) * 0.3;
    }

    // Compare matched messages
    const minLen = Math.min(actual.length, expected.length);
    for (let i = 0; i < minLen; i++) {
      const a = actual[i]!;
      const e = expected[i]!;

      // Role mismatch is significant
      if (a.role !== e.role) {
        details.push({
          field: `messages[${i}].role`,
          type: 'changed',
          description: `Expected "${e.role}", got "${a.role}"`,
        });
        totalDiff += 0.5;
        continue;
      }

      // For system messages, check structural similarity
      if (a.role === 'system') {
        const drift = computeSystemMessageDrift(a.content ?? '', e.content ?? '');
        if (drift > 0.1) {
          details.push({
            field: `messages[${i}].content (system)`,
            type: 'changed',
            description: `System message structural drift: ${drift.toFixed(3)}`,
          });
          totalDiff += drift * 0.3; // System message changes weighted less
        }
      }

      // For tool results, check JSON key structure
      if (a.role === 'tool') {
        const keyDrift = computeJsonKeyDrift(a.content ?? '', e.content ?? '');
        if (keyDrift > 0) {
          details.push({
            field: `messages[${i}].content (tool result)`,
            type: 'changed',
            description: `Tool result structure drift: ${keyDrift.toFixed(3)}`,
          });
          totalDiff += keyDrift * 0.2;
        }
      }

      // For user messages, check exact match
      if (a.role === 'user') {
        if ((a.content ?? '') !== (e.content ?? '')) {
          details.push({
            field: `messages[${i}].content (user)`,
            type: 'changed',
            description: 'User message content differs',
          });
          totalDiff += 0.4;
        }
      }

      // Check tool calls structure
      const aTools = a.toolCalls ?? [];
      const eTools = e.toolCalls ?? [];
      if (aTools.length !== eTools.length) {
        details.push({
          field: `messages[${i}].toolCalls`,
          type: 'changed',
          description: `Expected ${eTools.length} tool calls, got ${aTools.length}`,
        });
        totalDiff += 0.3;
      } else {
        for (let j = 0; j < aTools.length; j++) {
          if (aTools[j]!.name !== eTools[j]!.name) {
            details.push({
              field: `messages[${i}].toolCalls[${j}].name`,
              type: 'changed',
              description: `Expected tool "${eTools[j]!.name}", got "${aTools[j]!.name}"`,
            });
            totalDiff += 0.3;
          }
        }
      }
    }

    const score = maxLen > 0 ? totalDiff / maxLen : 0;
    return { turnIndex, score: Math.min(score, 1), details };
  }

  /**
   * Lenient: just check that tool call names appear in the same order.
   */
  private computeLenientDrift(
    actual: Message[],
    expected: Message[],
    turnIndex: number
  ): DriftReport {
    const details: DriftDetail[] = [];

    // Extract tool call sequences
    const actualTools = actual
      .flatMap(m => m.toolCalls ?? [])
      .map(tc => tc.name);
    const expectedTools = expected
      .flatMap(m => m.toolCalls ?? [])
      .map(tc => tc.name);

    // Check role sequence
    const actualRoles = actual.map(m => m.role);
    const expectedRoles = expected.map(m => m.role);

    let roleDrift = 0;
    if (actualRoles.length !== expectedRoles.length) {
      roleDrift = 0.2;
      details.push({
        field: 'message sequence',
        type: 'changed',
        description: `Message count: expected ${expectedRoles.length}, got ${actualRoles.length}`,
      });
    }

    // Compare tool sequences
    let toolDrift = 0;
    if (actualTools.length !== expectedTools.length) {
      toolDrift = 0.3;
      details.push({
        field: 'tool sequence',
        type: 'changed',
        description: `Tool count: expected ${expectedTools.length}, got ${actualTools.length}`,
      });
    } else {
      const mismatches = actualTools.filter((t, i) => t !== expectedTools[i]).length;
      if (mismatches > 0) {
        toolDrift = mismatches / actualTools.length * 0.5;
        details.push({
          field: 'tool sequence',
          type: 'reordered',
          description: `${mismatches}/${actualTools.length} tool calls differ`,
        });
      }
    }

    return { turnIndex, score: Math.min(roleDrift + toolDrift, 1), details };
  }
}

// --- Utility functions ---

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Compare system messages by line structure (section headers, key phrases).
 */
function computeSystemMessageDrift(actual: string, expected: string): number {
  const aLines = new Set(
    actual
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
  );
  const eLines = new Set(
    expected
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
  );

  if (eLines.size === 0 && aLines.size === 0) return 0;
  if (eLines.size === 0 || aLines.size === 0) return 1;

  // Jaccard distance on non-empty lines
  const union = new Set([...aLines, ...eLines]);
  const intersection = [...aLines].filter(l => eLines.has(l));

  return 1 - intersection.length / union.size;
}

/**
 * Compare JSON tool results by key structure.
 */
function computeJsonKeyDrift(actual: string, expected: string): number {
  try {
    const aKeys = new Set(Object.keys(JSON.parse(actual)));
    const eKeys = new Set(Object.keys(JSON.parse(expected)));

    if (eKeys.size === 0 && aKeys.size === 0) return 0;

    const union = new Set([...aKeys, ...eKeys]);
    const intersection = [...aKeys].filter(k => eKeys.has(k));

    return 1 - intersection.length / union.size;
  } catch {
    // Not JSON — fall back to string comparison
    return actual === expected ? 0 : 0.5;
  }
}
