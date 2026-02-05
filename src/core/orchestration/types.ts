import type { PhaseStatus, ProjectFile, WorkflowPhase } from '../../tasks/video/workflow/types.js';

export type RouteIntent = 'simple' | 'continue' | 'modify' | 'question' | 'ambiguous';

export type ExecutionStrategy = 'direct' | 'analyze' | 'interactive' | 'fallback';

export interface IntentRoute {
  intent: RouteIntent;
  confidence: number;
  requiresStateAnalysis: boolean;
  suggestedStrategy: ExecutionStrategy;
  targetItems: string[];
}

export interface FileCompletenessCheck {
  path: string;
  exists: boolean;
  required: boolean;
}

export interface MissingDependency {
  id: string;
  description: string;
  filePath: string;
}

export interface Blocker {
  code: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
}

export interface PhaseCompletion {
  total: number;
  completed: number;
  pending: number;
  percentage: number;
  missingItems: string[];
}

export interface StateAnalysis {
  hasProject: boolean;
  currentPhase?: WorkflowPhase;
  phaseStatus?: PhaseStatus;
  completedPhases: WorkflowPhase[];
  pendingPhases: WorkflowPhase[];
  completion: PhaseCompletion;
  requiredFiles: FileCompletenessCheck[];
  missingDependencies: MissingDependency[];
  blockers: Blocker[];
  actionableRemainingWork: string[];
  summary: string;
}

export type ContinuationStrategy =
  | 'resume_phase'
  | 'complete_partial'
  | 'retry_failed'
  | 'move_forward'
  | 'unblock';

export interface ContinuationPlan {
  strategy: ContinuationStrategy;
  specificTasks: string[];
  checkpoints: string[];
  blockers: Blocker[];
  guidanceText: string;
}

export interface OrchestrationContext {
  intentRoute: IntentRoute;
  stateAnalysis?: StateAnalysis;
  continuationPlan?: ContinuationPlan;
}

export interface OrchestrationInput {
  basePath: string;
  userInput: string;
  project: ProjectFile | null;
}
