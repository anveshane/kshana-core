/**
 * Compute the effective VLM master-switch value from per-project
 * persisted toggles.
 *
 * Two booleans drive the decision:
 *   - `piOversight` — pi-agent oversight (auto-engagement). When off,
 *     pi-agent never sees the asset events that would be the consumer
 *     of any VLM description. Forces VLM off as a corollary.
 *   - `vlmJudge`     — VLM master switch. When off, VLM is skipped
 *     regardless of supervisor state.
 *
 * Both fields default to ON (true) when absent on disk — matches the
 * "default ON for new projects" rule. We use `!== false` rather than
 * `=== true` so the absence of either field reads as ON, not OFF.
 *
 * This helper is the SINGLE place the gate is computed. The runner
 * singleton calls it at task dispatch; the result is snapshot-passed
 * to runExecutor → ExecutorAgent. Mid-run flips don't propagate
 * through this path — that's a separate live-setter concern.
 */
export function effectiveVlmEnabled(toggles: {
  piOversight?: boolean | null;
  vlmJudge?: boolean | null;
}): boolean {
  const supervisorOn = toggles.piOversight !== false;
  const vlmOn = toggles.vlmJudge !== false;
  return supervisorOn && vlmOn;
}
