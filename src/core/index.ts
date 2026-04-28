// Agent — GenericAgent deleted in graph-as-source-of-truth refactor.
// ExecutorAgent (src/core/planner/ExecutorAgent.ts) is the only agent.
export type { AgentConfig, AgentStatus, GenericAgentResult } from './agent/index.js';

// LLM
export { LLMClient } from './llm/index.js';
export type {
  Message,
  MessageRole,
  ToolCall,
  ToolDefinition,
  ToolParameterSchema,
  LLMResponse,
  StreamChunk,
  GenerateOptions,
  LLMClientConfig,
} from './llm/index.js';

// Todo
export { ExpandableTodoManager, createTodoItem, todoToDict, todoFromDict } from './todo/index.js';
export type { ExpandableTodoItem, TodoStatus, TodoManagerResult } from './todo/index.js';

// Tools
export {
  ToolRegistry,
  createTool,
  createDefaultToolRegistry,
  isSimpleTool,
  registerComplexTool,
  registerSimpleTool,
  thinkTool,
  askUserTool,
  setTodosTool,
  updateTodoTool,
  addSubtasksTool,
} from './tools/index.js';

// Prompts
export {
  buildSystemMessage,
  GENERIC_AGENT_BASE_PROMPT,
  GENERIC_AGENT_SUB_AGENT_SECTION,
  GENERIC_AGENT_ORCHESTRATOR_SECTION,
} from './prompts/index.js';

// File System
export type { IFileSystem, FileStat, SessionContext, SessionMode } from './fs/index.js';
export {
  LocalFileSystem,
  getCurrentSession,
  requireSession,
  getSessionFs,
  getSessionProjectDir,
  setSessionProjectDir,
  runInSession,
  createLocalSession,
  createRemoteSession,
  setDefaultProjectDir,
  getDefaultProjectDir,
} from './fs/index.js';

// Planner
export { BackwardPlanner, AssetScanner } from './planner/index.js';
export type {
  UserGoal,
  GoalPreferences,
  ProvidedAsset,
  AssetSource,
  AssetRegistry,
  SatisfactionLevel,
  ExecutionPlan,
  PlanStep,
  SkippedArtifact,
  ScanResult,
  ScanIssue,
  PlannerOptions,
  PlanValidation,
} from './planner/index.js';
