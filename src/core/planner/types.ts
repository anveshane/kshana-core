/**
 * Core Types for Goal-Driven Planning
 *
 * These types support the backward-planning system that determines
 * the minimal execution path from user goals.
 */

/**
 * User's goal as understood by the agent.
 * NOT a fixed enum - the agent determines this dynamically
 * through natural language understanding.
 */
export interface UserGoal {
  /** What artifact types the user ultimately wants */
  targetArtifacts: string[];

  /** User's preferences extracted from conversation */
  preferences: GoalPreferences;

  /** Original user description of what they want */
  description: string;
}

/**
 * Preferences extracted from user's goal description
 */
export interface GoalPreferences {
  /** Visual style preference (e.g., "anime", "realistic") */
  style?: string;

  /** Target duration in seconds */
  duration?: number;

  /** Output format preference */
  format?: string;

  /** Any other key-value preferences */
  [key: string]: string | number | boolean | undefined;
}

/**
 * Asset that already exists or was provided by the user.
 * Assets can come from various sources and may satisfy
 * artifact requirements without needing generation.
 */
export interface ProvidedAsset {
  /** Unique identifier for this asset */
  id: string;

  /** The artifact type this asset can satisfy */
  artifactTypeId: string;

  /** For collection items: the specific item ID */
  itemId?: string;

  /** Path to the asset file (if file-based) */
  path?: string;

  /** Content of the asset (if inline) */
  content?: string;

  /** Where this asset came from */
  source: AssetSource;

  /** When this asset was registered */
  registeredAt: number;

  /** Optional metadata about the asset */
  metadata?: Record<string, unknown>;
}

/**
 * Sources an asset can come from
 */
export type AssetSource =
  | 'user_provided'      // User explicitly provided the asset
  | 'previously_generated' // Generated in a previous session
  | 'imported'           // Imported from an external source
  | 'detected';          // Auto-detected from project directory

/**
 * Registry tracking what assets already exist.
 * Used to determine what can be skipped during planning.
 */
export interface AssetRegistry {
  /** All known assets, keyed by asset ID */
  assets: Map<string, ProvidedAsset>;

  /** Which artifact types are fully or partially satisfied */
  satisfiedArtifacts: Map<string, SatisfactionLevel>;

  /** Timestamp of last scan */
  lastScanAt: number;
}

/**
 * How completely an artifact type is satisfied
 */
export type SatisfactionLevel =
  | 'full'     // All required items exist
  | 'partial'; // Some items exist but not all

/**
 * Execution plan built by backward traversal through the dependency graph.
 * Contains only the steps needed to reach the user's goal.
 */
export interface ExecutionPlan {
  /** The goal this plan achieves */
  goal: UserGoal;

  /** Ordered list of steps to execute */
  steps: PlanStep[];

  /** Artifact types that will be skipped (already exist) */
  skippedArtifacts: SkippedArtifact[];

  /** Human-readable summary of the plan */
  summary: string;

  /** Total number of expensive operations */
  expensiveStepCount: number;

  /** Whether user approval is recommended before execution */
  requiresApproval: boolean;

  /** Duration-aware planning hints (present when goal has duration preference) */
  timelineHints?: TimelineHints;
}

/**
 * Information about an artifact that will be skipped
 */
export interface SkippedArtifact {
  /** Artifact type ID */
  typeId: string;

  /** Reason for skipping */
  reason: string;

  /** Asset IDs that satisfy this artifact */
  satisfiedBy: string[];
}

/**
 * Single step in the execution plan
 */
export interface PlanStep {
  /** Unique step identifier */
  id: string;

  /** Artifact type to create */
  artifactTypeId: string;

  /** For collections: specific item to create */
  itemId?: string;

  /** Step IDs this step depends on */
  dependsOn: string[];

  /** Why this step is needed (human-readable) */
  reason: string;

  /** Whether this is an expensive (image/video) operation */
  isExpensive: boolean;

  /** Display name for the artifact */
  displayName: string;

  /** Estimated relative cost (for ordering/prioritization) */
  estimatedCost: number;
}

/**
 * Duration-aware hints for the agent to plan enough content.
 * Computed when the goal has a duration preference.
 */
export interface TimelineHints {
  /** Recommended number of segments to fill the duration */
  suggestedSegmentCount: number;
  /** Recommended duration per segment (seconds) */
  suggestedSegmentDuration: number;
  /** Total target duration (seconds) */
  totalDuration: number;
  /** Maximum duration for a single generated clip (seconds) */
  maxClipDuration: number;
  /** Human-readable explanation for the agent */
  reasoning: string;
}

/**
 * Result of scanning for existing assets
 */
export interface ScanResult {
  /** The asset registry built from the scan */
  registry: AssetRegistry;

  /** Number of assets found */
  assetCount: number;

  /** Any issues encountered during scanning */
  issues: ScanIssue[];
}

/**
 * Issue encountered during asset scanning
 */
export interface ScanIssue {
  /** Type of issue */
  type: 'warning' | 'error';

  /** Description of the issue */
  message: string;

  /** Path or location related to the issue */
  location?: string;
}

/**
 * Options for the backward planner
 */
export interface PlannerOptions {
  /** Include optional dependencies in the plan */
  includeOptional?: boolean;

  /** Maximum depth to traverse (for cycle protection) */
  maxDepth?: number;

  /** Whether to validate the plan before returning */
  validate?: boolean;
}

/**
 * Result of plan validation
 */
export interface PlanValidation {
  /** Whether the plan is valid */
  valid: boolean;

  /** Validation errors */
  errors: string[];

  /** Validation warnings */
  warnings: string[];
}
