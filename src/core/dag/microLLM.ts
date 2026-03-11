/**
 * Micro-LLM Error Recovery.
 *
 * Last-resort recovery mechanism when a node exhausts all retries.
 * Uses a cheap/fast LLM call with minimal context and constrained actions.
 *
 * Safety rails:
 * - Can NEVER add nodes or change DAG structure
 * - Can NEVER modify completed nodes
 * - retry_modified has a limit of 1 additional attempt
 * - All decisions are logged for audit
 */

import type { LLMClient } from '../llm/index.js';
import type { DAGNode, ErrorAttempt, MicroLLMDecision } from './types.js';
import type { DAG } from './DAG.js';

/**
 * Invoke the micro-LLM to decide how to recover from a failed node.
 *
 * The micro-LLM sees only:
 * - The failed node's ID, purpose, and type
 * - The error message
 * - Previous attempt history
 * - Downstream impact of skipping
 *
 * It can only choose from 3 constrained actions.
 */
export async function microLLMRecover(
  node: DAGNode,
  error: string,
  attempts: ErrorAttempt[],
  dag: DAG,
  llm: LLMClient,
): Promise<MicroLLMDecision> {
  // Compute downstream impact of skipping
  const downstream = dag.getTransitiveDependents(node.id);
  const downstreamSummary = downstream.length > 0
    ? downstream.map(n => n.id).join(', ')
    : 'none';

  const prompt = buildRecoveryPrompt(node, error, attempts, downstreamSummary);

  try {
    const response = await llm.generate({
      messages: [
        { role: 'system', content: 'You are a pipeline error recovery agent. Analyze failures and choose the best recovery action. Return ONLY valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      responseFormat: { type: 'json_object' },
    });

    if (!response.content) {
      return fallbackDecision('Recovery agent returned empty response');
    }

    const decision = parseDecision(response.content);
    return decision;
  } catch (err) {
    return fallbackDecision(`Recovery agent failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function buildRecoveryPrompt(
  node: DAGNode,
  error: string,
  attempts: ErrorAttempt[],
  downstreamSummary: string,
): string {
  const attemptHistory = attempts.length > 0
    ? attempts.map((a, i) => `  ${i + 1}. ${a.strategy}: ${a.error}`).join('\n')
    : '  (no previous attempts)';

  return `A pipeline node failed and needs recovery.

NODE: ${node.id}
PURPOSE: ${node.description ?? 'No description'}
TYPE: ${node.type === 'D' ? 'Deterministic (code handler)' : node.type === 'S' ? 'LLM generation' : 'User gate'}

ERROR: ${error}

PREVIOUS ATTEMPTS (${attempts.length}):
${attemptHistory}

IF SKIPPED, these downstream nodes will also be skipped:
${downstreamSummary}

Choose ONE action:

1. retry_modified — Modify the input and try again.
   Only choose this if you can identify a specific fix.
   You MUST provide the modifiedInput field with the fix.

2. skip — Skip this node and all downstream dependents.
   Choose this if the error is unrecoverable and the impact is acceptable.

3. ask_user — Pause execution and ask the user for guidance.
   Choose this if you're unsure or the impact of skipping is too large.

Return JSON: { "action": "retry_modified|skip|ask_user", "reason": "...", "modifiedInput": "...", "skipImpact": "..." }`;
}

function parseDecision(content: string): MicroLLMDecision {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;

    const action = parsed['action'];
    if (!action || !['retry_modified', 'skip', 'ask_user'].includes(action as string)) {
      return fallbackDecision(`Invalid action: ${action}`);
    }

    return {
      action: action as MicroLLMDecision['action'],
      reason: String(parsed['reason'] ?? 'No reason provided'),
      modifiedInput: parsed['modifiedInput'] ? String(parsed['modifiedInput']) : undefined,
      skipImpact: parsed['skipImpact'] ? String(parsed['skipImpact']) : undefined,
    };
  } catch {
    return fallbackDecision('Failed to parse recovery agent response');
  }
}

function fallbackDecision(reason: string): MicroLLMDecision {
  return {
    action: 'ask_user',
    reason,
  };
}
