/**
 * Embed-friendly barrel for the in-process executor runner.
 *
 * Used by hosts that want to drive a single ExecutorAgent run without
 * going through ConversationManager / Fastify. The Electron desktop
 * doesn't typically need this directly (ConversationManager already
 * invokes it via PiSessionAgent → tools), but exposing it keeps the
 * embed surface complete.
 *
 * As with `../manager.ts`, this barrel must not import Fastify.
 */
export { runExecutor } from './runExecutor.js';
export type {
  RunExecutorOpts,
  RunExecutorResult,
  RunExecutorTarget,
  RunExecutorAssetEvent,
} from './runExecutor.js';
export { classifyExecutorAsset } from './classifyExecutorAsset.js';
export { mapExecutorStatus } from './mapExecutorStatus.js';
export { classifyRunTarget } from './classifyRunTarget.js';
export type { ClassifiedRunTarget } from './classifyRunTarget.js';
export { linkAbortSignalToAgent } from './linkAbortSignalToAgent.js';
