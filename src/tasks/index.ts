/**
 * Task module — re-exports video-task helpers.
 *
 * The legacy `createAgentForTask` factory and the `'generic'` task
 * type were removed in the graph-as-source-of-truth refactor.
 * `ExecutorAgent` (created via `createExecutorAgent` from
 * `./video/index.js`) is the only agent now.
 */
export * from './video/index.js';
