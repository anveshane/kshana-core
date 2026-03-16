/**
 * Generic Video Generation Template Type System
 *
 * This module defines the core types for a template-based artifact system
 * that can support any type of AI-generated video through configurable templates.
 */

import type { PersistedGoal } from '../planner/types.js';

// =============================================================================
// ARTIFACT CATEGORIES
// =============================================================================

/**
 * Abstract artifact categories that all video types share.
 * These provide semantic grouping for artifact types across different templates.
 */
export type ArtifactCategory =
  | 'concept'      // Core idea/thesis/hook (plot, thesis, hook, product value prop)
  | 'structure'    // Narrative/logical flow (story, research outline, script)
  | 'entity'       // Things needing visual consistency (characters, experts, products)
  | 'environment'  // Places/backgrounds (settings, locations, demo environments)
  | 'segment'      // Discrete video units (scenes, documentary segments, key visuals)
  | 'visual_ref'   // Reference images (character/setting images, product shots)
  | 'clip'         // Video clips (scene videos, segment videos)
  | 'final';       // Assembled output (final video)

/**
 * Output formats that artifacts can produce
 */
export type ArtifactOutputFormat = 'markdown' | 'json' | 'image' | 'video';

/**
 * Agent types that can create artifacts
 */
export type ArtifactAgentType = 'planning' | 'content' | 'image' | 'video' | 'infographic';

/**
 * Artifact scope determines where artifacts are stored and shared.
 * Project-scoped artifacts are shared across chapters (e.g., characters).
 * Chapter-scoped artifacts are specific to each chapter (e.g., scenes).
 */
export type ArtifactScope = 'project' | 'chapter';

/**
 * Approval status for artifacts
 */
export type ArtifactApprovalStatus =
  | 'pending'       // Not yet reviewed
  | 'in_review'     // Currently being reviewed
  | 'approved'      // User approved
  | 'rejected'      // User rejected, needs regeneration
  | 'regenerating'; // Being regenerated after rejection

/**
 * How a dependency is used by an artifact
 */
export type DependencyUsage =
  | 'context'    // Included as context for generation (e.g., story for scene)
  | 'reference'  // Used as visual reference (e.g., character image for scene image)
  | 'input';     // Direct input to generation (e.g., image for video)

/**
 * Scope for collection dependencies
 */
export type DependencyScope =
  | 'all'       // All items in the collection needed
  | 'matching'  // Only matching items (e.g., characters appearing in scene)
  | 'any';      // At least one item needed

// =============================================================================
// ARTIFACT TYPE DEFINITIONS
// =============================================================================

/**
 * Defines a type of artifact that can be created within a template.
 * This is the schema - it describes WHAT can be created, not instances.
 */
export interface ArtifactTypeDefinition {
  /** Unique identifier within the template (e.g., 'character', 'scene') */
  id: string;

  /** Human-readable name (e.g., 'Character', 'Scene') */
  displayName: string;

  /** Abstract category this artifact belongs to */
  category: ArtifactCategory;

  /** Description of what this artifact represents */
  description: string;

  /**
   * Scope determines where artifacts are stored:
   * - 'project': Shared across all chapters (characters, settings, their images)
   * - 'chapter': Specific to each chapter (plot, story, scenes, scene videos)
   * Defaults to 'chapter' if not specified.
   */
  scope?: ArtifactScope;

  /**
   * Whether this artifact type is a collection (multiple items) or singular.
   * Collections: characters, settings, scenes
   * Singular: plot, story, final_video
   */
  isCollection: boolean;

  /** For collections: what each item is called (e.g., 'character', 'scene') */
  itemName?: string;

  /** Maximum items allowed for collections (optional constraint) */
  maxItems?: number;

  /** Output format for this artifact type */
  outputFormat: ArtifactOutputFormat;

  /**
   * File pattern for storing artifacts.
   * Supports placeholders: {{name}}, {{index}}, {{id}}
   * Examples:
   * - "plot.md" (singular)
   * - "characters/{{name}}.md" (collection with name)
   * - "scenes/scene_{{index}}.md" (collection with index)
   */
  filePattern: string;

  /** Which type of agent creates this artifact */
  agentType: ArtifactAgentType;

  /** Path to the prompt template file (relative to prompts/templates/) */
  promptFile: string;

  /**
   * Whether this artifact requires explicit approval before creation.
   * Typically true for expensive operations (image/video generation).
   */
  isExpensive: boolean;

  /**
   * For collections: whether each item needs individual approval.
   * If false, all items are approved/rejected together.
   */
  requiresPerItemApproval: boolean;

  /** Dependencies required to create this artifact */
  dependencies: ArtifactDependency[];

  /**
   * Optional validation rules for this artifact type.
   */
  validation?: ArtifactValidation;

  /**
   * Optional metadata schema for additional artifact-specific data.
   */
  metadataSchema?: Record<string, MetadataFieldDefinition>;
}

/**
 * Defines a dependency relationship between artifact types
 */
export interface ArtifactDependency {
  /** ID of the artifact type that is required */
  artifactTypeId: string;

  /** Whether this dependency is required or optional */
  required: boolean;

  /** How this dependency is used */
  usage: DependencyUsage;

  /** For collection dependencies: which items are needed */
  scope?: DependencyScope;

  /**
   * Optional condition for when this dependency applies.
   * Allows conditional dependencies based on artifact metadata.
   */
  condition?: DependencyCondition;
}

/**
 * Condition for conditional dependencies
 */
export interface DependencyCondition {
  /** Field to check on the artifact being created */
  field: string;

  /** Operator for comparison */
  operator: 'equals' | 'contains' | 'exists' | 'not_exists';

  /** Value to compare against (for equals/contains) */
  value?: string | number | boolean;
}

/**
 * Validation rules for artifact content
 */
export interface ArtifactValidation {
  /** Minimum content length (for text artifacts) */
  minLength?: number;

  /** Maximum content length (for text artifacts) */
  maxLength?: number;

  /** Required fields (for structured artifacts) */
  requiredFields?: string[];

  /** Custom validation function name (registered separately) */
  customValidator?: string;
}

/**
 * Definition for metadata fields
 */
export interface MetadataFieldDefinition {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  description?: string;
  default?: unknown;
}

// =============================================================================
// ARTIFACT INSTANCES (RUNTIME STATE)
// =============================================================================

/**
 * Runtime instance of an artifact.
 * This represents an actual artifact that has been created or is being created.
 */
export interface ArtifactInstance {
  /** Unique identifier for this instance */
  id: string;

  /** Reference to the artifact type definition */
  typeId: string;

  /** For collections: the item name or identifier */
  itemId?: string;

  /** Human-readable name */
  name: string;

  /** Chapter ID if chapter-scoped, undefined if project-scoped */
  chapterId?: string;

  /** Current approval status */
  status: ArtifactApprovalStatus;

  /** Path to the artifact file (relative to project root) */
  filePath?: string;

  /** For image/video: path to the generated asset */
  assetPath?: string;

  /** When this artifact was created */
  createdAt: number;

  /** When this artifact was last updated */
  updatedAt: number;

  /** Version number (incremented on regeneration) */
  version: number;

  /** IDs of artifacts this instance depends on */
  dependsOn: string[];

  /** IDs of artifacts that depend on this instance */
  dependedBy: string[];

  /** Additional metadata specific to this artifact type */
  metadata: Record<string, unknown>;

  /** Error information if creation failed */
  error?: ArtifactError;
}

/**
 * Error information for failed artifact creation
 */
export interface ArtifactError {
  code: string;
  message: string;
  timestamp: number;
  recoverable: boolean;
}

// =============================================================================
// INPUT TYPES
// =============================================================================

/**
 * Configuration for an input type that a template accepts
 */
export interface InputTypeConfig {
  /** Unique identifier for this input type */
  id: string;

  /** Human-readable name */
  displayName: string;

  /** Description of what this input type is */
  description: string;

  /** Examples of valid input */
  examples: string[];

  /**
   * Which artifact types are skipped when using this input.
   * For example, 'story' input might skip 'plot' generation.
   */
  skipsArtifacts: string[];

  /**
   * Which artifact type this input maps to.
   * The input content becomes this artifact.
   */
  mapsToArtifact: string;

  /**
   * Optional detection patterns for auto-detecting this input type.
   * Used to suggest the most appropriate input type.
   */
  detectionPatterns?: InputDetectionPattern[];
}

/**
 * Pattern for detecting input types
 */
export interface InputDetectionPattern {
  /** Type of detection */
  type: 'length' | 'keywords' | 'structure';

  /** Pattern-specific configuration */
  config: Record<string, unknown>;

  /** Weight for this pattern (higher = more important) */
  weight: number;
}

// =============================================================================
// PHASES (OPTIONAL GROUPING)
// =============================================================================

/**
 * Phase definition for optional UX grouping of artifacts.
 * Phases help organize the workflow for users but don't affect dependencies.
 */
export interface PhaseDefinition {
  /** Unique identifier for this phase */
  id: string;

  /** Human-readable name */
  displayName: string;

  /** Description of what happens in this phase */
  description: string;

  /** Order of this phase (lower = earlier) */
  order: number;

  /** Artifact types that belong to this phase */
  artifactTypes: string[];

  /**
   * Whether this phase requires user confirmation before starting.
   * Typically true for expensive phases (image/video generation).
   */
  requiresConfirmation: boolean;

  /**
   * Optional prompt file for phase-level instructions.
   */
  promptFile?: string;
}

/**
 * Runtime state of a phase
 */
export interface PhaseInfo {
  /** Phase ID */
  id: string;

  /** Current status */
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';

  /** When this phase was started */
  startedAt?: number;

  /** When this phase was completed */
  completedAt?: number;

  /** Path to the plan file for this phase */
  planFile?: string;
}

/**
 * Chapter information for multi-chapter projects.
 */
export interface ChapterInfo {
  /** Unique chapter identifier */
  id: string;

  /** Chapter title */
  title: string;

  /** Order in the project (1-based) */
  order: number;

  /** Chapter status */
  status: 'pending' | 'in_progress' | 'completed';

  /** Creation timestamp */
  createdAt: number;

  /** Last update timestamp */
  updatedAt: number;

  /** Optional chapter description */
  description?: string;
}

// =============================================================================
// VIDEO TEMPLATE
// =============================================================================

/**
 * Style configuration for visual generation
 */
export interface StyleConfig {
  /** Unique identifier for this style */
  id: string;

  /** Human-readable name */
  displayName: string;

  /** Description of this style */
  description: string;

  /** Positive prompt modifiers to add */
  promptModifiers: string[];

  /** Negative prompt elements */
  negativePrompt: string[];

  /** Optional ComfyUI-specific settings */
  comfySettings?: Record<string, unknown>;
}

/**
 * Template constraints
 */
export interface TemplateConstraints {
  /** Maximum number of segments (scenes, etc.) */
  maxSegments?: number;

  /** Maximum number of entities (characters, etc.) */
  maxEntities?: number;

  /** Maximum video duration in seconds */
  maxDuration?: number;

  /** Minimum video duration in seconds */
  minDuration?: number;
}

/**
 * Complete video template definition.
 * This is the top-level configuration that defines how a type of video is created.
 */
export interface VideoTemplate {
  /** Unique identifier (e.g., 'narrative', 'documentary') */
  id: string;

  /** Human-readable name (e.g., 'Narrative Story Video') */
  displayName: string;

  /** Description of what this template creates */
  description: string;

  /** Template version (semver) */
  version: string;

  /** Default visual style ID */
  defaultStyle: string;

  /** Available visual styles for this template */
  styles: StyleConfig[];

  /** Input types this template accepts */
  inputTypes: InputTypeConfig[];

  /** All artifact types defined by this template */
  artifactTypes: Record<string, ArtifactTypeDefinition>;

  /** Optional phase groupings for UX */
  phases?: PhaseDefinition[];

  /** Template constraints */
  constraints?: TemplateConstraints;

  /**
   * Context variables that should be available during generation.
   * Maps variable name to artifact type (e.g., '$story' -> 'story')
   */
  contextVariables: Record<string, string>;

  /**
   * Path to the main orchestrator prompt for this template.
   * Relative to prompts/templates/
   */
  orchestratorPrompt: string;
}

// =============================================================================
// PROJECT FILE (VERSION 3.0)
// =============================================================================

/**
 * Final output information
 */
export interface FinalOutputInfo {
  /** Path to the final video file */
  path: string;

  /** Video duration in seconds */
  duration: number;

  /** Video resolution */
  resolution: { width: number; height: number };

  /** When the final video was created */
  createdAt: number;

  /** Artifact ID of the final video */
  artifactId: string;
}

/**
 * Generic project file structure (version 3.0).
 * This replaces the hardcoded narrative-specific structure.
 */
export interface GenericProjectFile {
  /** Schema version */
  version: '2.0';

  /** Unique project identifier */
  id: string;

  /** Project title */
  title: string;

  /** Template ID being used */
  templateId: string;

  /** Template version being used */
  templateVersion: string;

  /** Selected visual style ID */
  style: string;

  /** Input type used to start the project */
  inputType: string;

  /** When the project was created */
  createdAt: number;

  /** When the project was last updated */
  updatedAt: number;

  /**
   * All artifacts in the project.
   * Organized by artifact type ID, then by instance ID.
   * For singular artifacts, the instance ID matches the type ID.
   */
  artifacts: Record<string, Record<string, ArtifactInstance>>;

  /** Current phase ID (if using phases) */
  currentPhase?: string;

  /** Phase state information (if using phases) */
  phases?: Record<string, PhaseInfo>;

  /** Chapter support for multi-chapter projects */
  chapters?: Record<string, ChapterInfo>;

  /** Current chapter being worked on */
  currentChapter?: string;

  /** Original user input */
  originalInput?: string;

  /** List of generated asset paths */
  assets: string[];

  /** Final output information */
  finalOutput?: FinalOutputInfo;

  /**
   * Context store for large content.
   * Maps variable names (e.g., '$story') to content or file paths.
   */
  contextStore: Record<string, ContextStoreEntry>;

  /** Persisted user goal for session resumption */
  goal?: PersistedGoal;
}

/**
 * Entry in the context store
 */
export interface ContextStoreEntry {
  /** The actual content (for smaller items) */
  content?: string;

  /** File path (for larger items stored on disk) */
  filePath?: string;

  /** When this entry was last updated */
  updatedAt: number;

  /** Source artifact ID */
  sourceArtifactId?: string;
}

// =============================================================================
// ARTIFACT REQUEST (FOR RESOLVER)
// =============================================================================

/**
 * Request to create or update an artifact
 */
export interface ArtifactRequest {
  /** Type of artifact to create */
  typeId: string;

  /** For collections: specific item to create/update */
  itemId?: string;

  /** Action to perform */
  action: 'create' | 'update' | 'regenerate' | 'delete';

  /** Optional content to use (for imports or updates) */
  content?: string;

  /** Optional metadata to set */
  metadata?: Record<string, unknown>;
}

/**
 * Result of resolving an artifact request
 */
export interface ArtifactRequestResolution {
  /** Whether the request can proceed */
  canProceed: boolean;

  /** Missing dependencies that must be created first */
  missingDependencies: ArtifactDependencyInfo[];

  /** Artifacts that will be affected by this action */
  affectedArtifacts: ArtifactAffectedInfo[];

  /** Suggested next actions */
  suggestedActions: SuggestedAction[];

  /** Human-readable explanation */
  explanation: string;
}

/**
 * Information about a missing dependency
 */
export interface ArtifactDependencyInfo {
  /** Artifact type ID */
  typeId: string;

  /** For collections: specific items needed */
  itemIds?: string[];

  /** Why this dependency is needed */
  reason: string;

  /** Whether this can be auto-created */
  canAutoCreate: boolean;
}

/**
 * Information about an affected artifact
 */
export interface ArtifactAffectedInfo {
  /** Artifact instance ID */
  instanceId: string;

  /** How it will be affected */
  impact: 'invalidated' | 'requires_update' | 'will_be_deleted';

  /** Human-readable explanation */
  explanation: string;
}

/**
 * Suggested action for the user
 */
export interface SuggestedAction {
  /** Action type */
  type: 'create' | 'approve' | 'regenerate' | 'skip';

  /** Target artifact type */
  artifactTypeId: string;

  /** For collections: target items */
  itemIds?: string[];

  /** Human-readable description */
  description: string;

  /** Priority (lower = more important) */
  priority: number;
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Check if an artifact type is a collection
 */
export function isCollectionType(artifactType: ArtifactTypeDefinition): boolean {
  return artifactType.isCollection;
}

/**
 * Check if an artifact type produces visual content
 */
export function isVisualType(artifactType: ArtifactTypeDefinition): boolean {
  return artifactType.outputFormat === 'image' || artifactType.outputFormat === 'video';
}

/**
 * Check if an artifact requires explicit approval
 */
export function requiresApproval(artifactType: ArtifactTypeDefinition): boolean {
  return artifactType.isExpensive || artifactType.requiresPerItemApproval;
}

/**
 * Get the file path for an artifact instance
 */
export function getArtifactFilePath(
  artifactType: ArtifactTypeDefinition,
  name?: string,
  index?: number
): string {
  let path = artifactType.filePattern;

  if (name) {
    path = path.replace('{{name}}', sanitizeFileName(name));
  }
  if (index !== undefined) {
    path = path.replace('{{index}}', String(index).padStart(2, '0'));
  }

  return path;
}

/**
 * Sanitize a string for use in file names
 */
function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Generate a unique artifact instance ID
 */
export function generateArtifactId(typeId: string, itemId?: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  const base = itemId ? `${typeId}_${itemId}` : typeId;
  return `${base}_${timestamp}_${random}`;
}
