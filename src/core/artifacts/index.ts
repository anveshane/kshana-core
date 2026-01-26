/**
 * Artifact Engine
 *
 * This module provides the core artifact management functionality:
 * - ArtifactGraph: Dependency resolution and graph operations
 * - ArtifactResolver: Intent parsing and action resolution
 * - ArtifactManager: CRUD operations for artifacts
 */

export { ArtifactGraph } from './ArtifactGraph.js';
export type {
  ArtifactGraphNode,
  CanCreateResult,
  MissingDependency,
  RippleEffect,
  ArtifactImpact,
  CreationPlan,
  CreationStep,
} from './ArtifactGraph.js';

export { ArtifactResolver } from './ArtifactResolver.js';
export type {
  UserIntent,
  NextActionRecommendation,
} from './ArtifactResolver.js';

export { ArtifactManager } from './ArtifactManager.js';
export type {
  CreateArtifactOptions,
  UpdateArtifactOptions,
  ArtifactOperationResult,
  ArtifactQuery,
} from './ArtifactManager.js';
