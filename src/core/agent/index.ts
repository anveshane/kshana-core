// GenericAgent.ts and contentContext.ts deleted in the
// graph-as-source-of-truth refactor — ExecutorAgent is the only
// agent. AgentResult types remain because they're consumed by
// ExecutorAgent, ConversationManager, WebSocketHandler, and the
// useAgent React hook.
export type { AgentConfig, AgentStatus, GenericAgentResult, QuestionOption } from './AgentResult.js';
