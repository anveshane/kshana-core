/**
 * Testing utilities module
 */
export {
  PromptEvaluator,
  MockEvalLLMClient,
  createClassificationMock,
  type AssertionType,
  type Assertion,
  type EvalCase,
  type EvalFixture,
  type EvalToolDef,
  type EvalToolCall,
  type EvalResult,
  type EvalSummary,
  type EvalLLMClient,
} from './PromptEvaluator.js';

export {
  ConversationRecorder,
  type RecordedTurn,
  type ConversationRecording,
  type RecordableLLMClient,
} from './ConversationRecorder.js';

export {
  ReplayLLMClient,
  DriftError,
  type DriftTolerance,
  type DriftReport,
  type DriftDetail,
  type ReplayOptions,
} from './ReplayLLMClient.js';

export {
  CheckpointManager,
  type AgentCheckpoint,
  type SaveCheckpointOptions,
} from './CheckpointManager.js';

export {
  CheckpointScenarioRunner,
  type ScenarioTurn,
  type ScenarioRunnerOptions,
  type TurnPredicate,
} from './CheckpointScenarioRunner.js';

export {
  ModelSelector,
  type ModelTier,
  type ModelEndpoint,
  type ModelSelectorConfig,
} from './ModelSelector.js';

export {
  PromptChangeDetector,
  type PromptTestMapping,
  type ChangeDetectionResult,
} from './PromptChangeDetector.js';
