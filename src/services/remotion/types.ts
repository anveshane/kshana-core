/**
 * Type definitions for the Remotion rendering service.
 */

export interface ParsedPlacementInput {
  placementNumber: number;
  startTime: string;
  endTime: string;
  infographicType: string;
  prompt: string;
  data?: Record<string, unknown>;
}

/**
 * Request to render one or more infographic placements.
 */
export interface RenderRequest {
  sessionId: string;
  placements: ParsedPlacementInput[];
  /** Map of placementNumber → generated TSX component code */
  componentCodes: Map<number, string>;
  outputDir: string;
  format?: 'webm' | 'mp4';
}

/**
 * Status of a single placement within a render job.
 */
export type PlacementStatus = 'pending' | 'rendering' | 'completed' | 'failed';

/**
 * Result for a single rendered placement.
 */
export interface PlacementResult {
  placementNumber: number;
  status: PlacementStatus;
  outputPath?: string;
  error?: string;
}

/**
 * A render job tracking the progress of a RenderRequest.
 */
export interface RenderJob {
  id: string;
  sessionId: string;
  status: 'pending' | 'bundling' | 'rendering' | 'completed' | 'failed';
  progress: number;
  placementProgress: Map<number, number>;
  results: PlacementResult[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Metadata about a Remotion composition for registration.
 */
export interface CompositionMeta {
  id: string;
  componentName: string;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
}

/**
 * Progress update emitted during rendering.
 */
export interface RenderProgress {
  jobId: string;
  placementIndex: number;
  totalPlacements: number;
  progress: number;
  stage: 'bundling' | 'rendering' | 'completed' | 'failed';
}
