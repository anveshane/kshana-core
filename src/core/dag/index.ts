/**
 * DAG Executor module.
 *
 * Replaces LLM-as-router with deterministic graph traversal.
 * LLMs are used only at S (Stochastic) nodes for content generation.
 */

// Core types
export type {
  NodeType,
  NodeStatus,
  NodeContext,
  NodeResult,
  ValidationResult,
  UserQuestion,
  ErrorPolicy,
  ErrorAttempt,
  MicroLLMDecision,
  DAGNode,
  DAGNodeDefinition,
  PersistedDAGState,
  PersistedNodeState,
  ExpansionEvent,
  DAGEvent,
  DAGEventListener,
  HandlerRegistry,
  PromptBuilderRegistry,
  QuestionBuilderRegistry,
  ExpanderRegistry,
} from './types.js';

// DAG data structure
export { DAG } from './DAG.js';

// Executor
export { DAGExecutor, type DAGExecutorConfig, type DAGExecutorResult, type UserInteractionHandler } from './DAGExecutor.js';

// Builder
export { buildNarrativeDAG, rebuildDAGFromState, type DAGBuilderOptions } from './DAGBuilder.js';

// Error policies
export {
  DEFAULT_D_POLICY,
  DEFAULT_S_POLICY,
  DEFAULT_U_POLICY,
  IMAGE_GENERATION_POLICY,
  VIDEO_GENERATION_POLICY,
  ENTITY_EXTRACTION_POLICY,
  SKIPPABLE_POLICY,
  validateJSON,
  validateNonEmpty,
  validateArtifactPath,
  createJSONValidator,
  getDefaultPolicy,
} from './errorPolicies.js';

// Persistence
export {
  saveDAGState,
  loadDAGState,
  dagStateExists,
  clearDAGState,
  prepareStateForResume,
  logRecoveryDecision,
} from './persistence.js';

// Micro-LLM recovery
export { microLLMRecover } from './microLLM.js';

// Adapter (bridges DAGExecutor → GenericAgent interface)
export { DAGAgentAdapter, type DAGAgentAdapterConfig } from './DAGAgentAdapter.js';

// Expanders
export {
  buildEntityNodes,
  buildEntityExtractionPrompt,
  validateEntityExtraction,
  buildSceneNodes,
  buildShotNodes,
  validateShotBreakdown,
  buildAssemblyNodes,
  isAllScenesExpanded,
  slugify,
  type ExtractedEntities,
  type ExtractedCharacter,
  type ExtractedSetting,
  type ExtractedScene,
  type ShotBreakdown,
} from './expanders/index.js';
