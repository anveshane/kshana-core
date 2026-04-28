/**
 * Artifact graph helper used by the dependency-graph executor for
 * dependency traversal during planning. The fine-grained
 * ArtifactManager / ArtifactResolver lifecycle layer was removed in
 * the graph-as-source-of-truth refactor (PR6) — `executorState.nodes`
 * is the only artifact registry now.
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
