/**
 * Flow tracking types for comparing expected vs actual agent execution flows.
 *
 * Design:
 * - Expected flows define the CRITICAL PATH - required state transitions
 * - Optional tools (think, TodoWrite) are ignored during comparison
 * - Actual flows record everything, but comparison focuses on required steps
 */

/**
 * Tools that are always optional - can appear anywhere, any number of times.
 * These are filtered out when comparing against expected flows.
 */
export const OPTIONAL_TOOLS = new Set([
  'think',
  'TodoWrite',
  'todo_write',
]);

/**
 * Expected flow - the critical path specification.
 * Only contains REQUIRED steps that must happen in order.
 */
export interface ExpectedFlow {
  version: string;
  scenario: string;                   // e.g., "chapter_paste"
  trigger: string;                    // What initiates this flow
  description: string;
  criticalPath: ExpectedStep[];       // Only required steps, in order
}

export interface ExpectedStep {
  stepId: string;                     // e.g., "1", "1.1", "1.2"
  agent: string;                      // "Orchestrator", "Content Agent", etc.
  tool: string;                       // Tool name
  description: string;                // What this step accomplishes
  expectedArgs?: Record<string, unknown>;  // Key args to match (partial match)
  allowReorder?: boolean;             // Can this step happen in different order?
  subSteps?: ExpectedStep[];          // Nested sub-agent calls (also critical)
}

/**
 * Actual flow - auto-recorded during runtime with full details.
 */
export interface ActualFlow {
  version: string;
  sessionId: string;
  scenario?: string;                  // Matched expected scenario (if identified)
  startTime: string;                  // ISO timestamp
  endTime?: string;
  status: 'running' | 'completed' | 'error';
  triggerInput: string;               // User input that triggered this
  steps: ActualStep[];
}

export interface ActualStep {
  stepId: string;                     // Auto-generated
  matchedExpectedId?: string;         // Reference to expected step (set during comparison)
  agent: string;
  tool: string;
  toolCallId: string;
  arguments: Record<string, unknown>; // Full arguments
  result?: unknown;                   // Full result (truncated if large)
  isError: boolean;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  subSteps?: ActualStep[];            // Nested sub-agent calls
}

/**
 * Result of comparing actual flow against expected flow.
 */
export interface FlowComparisonResult {
  matches: boolean;                   // Did critical path match?
  matchedSteps: number;               // How many expected steps were matched
  totalExpectedSteps: number;         // Total expected steps
  missingSteps: ExpectedStep[];       // Expected steps not found in actual
  extraSteps: ActualStep[];           // Actual steps not in expected (excluding optional)
  errors: string[];                   // Description of mismatches
}
