/**
 * Pick the workflow for image_editing.
 *
 * Per project policy (2026-05-02): qwen_snofs_edit (Qwen Edit 2511 +
 * Lightning + Qwen_Snofs_1_3 LoRA, native 3-slot encoder) is the
 * default for every edit. Refs beyond the encoder's 3-slot capacity
 * are silently dropped by the workflow's parameterMappings — the
 * project trades multi-ref coverage for the cleaner identity
 * preservation we measured during the 2026-05-01..02 probe series.
 *
 * If the user pins a different workflow via the WorkflowModeRegistry
 * (e.g. klein_snofs_edit for a dense scene), the override wins.
 *
 * `totalImages` is left in the signature for future heuristics, but
 * is currently unused — kept so callers don't have to refactor when
 * the policy changes back to count-based routing.
 */
export function chooseImageEditWorkflow(input: {
  totalImages: number;
  modeOverride?: string | null;
}): string {
  if (input.modeOverride) return input.modeOverride;
  return "klein_snofs_edit";
}
