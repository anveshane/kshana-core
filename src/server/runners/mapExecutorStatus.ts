/**
 * Normalize ExecutorAgent's result.status + stopReason into a single
 * outcome value that the HTTP runner, the pi-agent in-process runner,
 * and the CLI all use.
 *
 *   - 'completed': result.status === 'completed' OR stopReason === 'paused_at_stage'
 *     (paused_at_stage is success — state is safe & resumable)
 *   - 'cancelled': stopReason === 'cancelled'
 *   - 'failed': anything else (error, interrupted, waiting_for_user, unknown)
 */
export function mapExecutorStatus(
  resultStatus: string,
  stopReason: string | null,
): 'completed' | 'cancelled' | 'failed' {
  if (resultStatus === 'completed') return 'completed';
  if (stopReason === 'paused_at_stage') return 'completed';
  if (stopReason === 'cancelled') return 'cancelled';
  return 'failed';
}
