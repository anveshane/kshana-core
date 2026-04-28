/**
 * Frontend-only Timeline types for display.
 * Mirrors the backend types in src/core/timeline/types.ts.
 */

export type CompositingMode = 'replace' | 'side_by_side' | 'pip' | 'overlay'

export type TransitionType =
  | 'cut' | 'crossfade' | 'fade' | 'dissolve'
  | 'dip_to_black' | 'flash_to_white'
  | 'wipe_left' | 'wipe_right' | 'wipe_up' | 'wipe_down'
  | 'circle_open' | 'circle_close' | 'radial'
  | 'slide_left' | 'slide_right'

export type SegmentFillStatus = 'empty' | 'planned' | 'filled'

export type LayerType = 'visual' | 'audio' | 'overlay' | 'narration_video'

export interface SegmentTransition {
  type: TransitionType
  durationMs: number
}

export interface TimelineLayerEntry {
  type: LayerType
  artifactId?: string
  filePath?: string
  label: string
  source: 'generated' | 'imported' | 'user_provided' | 'placeholder'
  metadata?: Record<string, unknown>
}

export interface TimelineSegment {
  id: string
  label: string
  startTime: number
  endTime: number
  duration: number
  compositingMode: CompositingMode
  fillStatus: SegmentFillStatus
  layers: TimelineLayerEntry[]
  transition?: SegmentTransition
  metadata?: Record<string, unknown>
}

export interface TimelineGap {
  startTime: number
  endTime: number
  duration: number
}

export interface TimelineValidation {
  isComplete: boolean
  filledDuration: number
  gaps: TimelineGap[]
  warnings: string[]
}

export interface Timeline {
  version: '1.0' | '1.1'
  totalDuration: number
  defaultCompositingMode: CompositingMode
  segments: TimelineSegment[]
  globalLayers: unknown[]
  validation: TimelineValidation
}
