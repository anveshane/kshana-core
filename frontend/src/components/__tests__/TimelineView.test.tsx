import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TimelineView } from '../TimelineView'
import { AppStateContext, initialState } from '../../lib/store'
import type { Timeline } from '../../lib/timeline-types'
import type { AppState } from '../../lib/store'

function renderWithState(state: Partial<AppState>) {
  const fullState = { ...initialState, ...state }
  return render(
    <AppStateContext.Provider value={fullState}>
      <TimelineView />
    </AppStateContext.Provider>
  )
}

const mockTimeline: Timeline = {
  version: '1.0',
  totalDuration: 30,
  defaultCompositingMode: 'replace',
  segments: [
    {
      id: 'scene_1_shot_1',
      label: 'Shot 1: Wide',
      startTime: 0,
      endTime: 10,
      duration: 10,
      compositingMode: 'replace',
      fillStatus: 'filled',
      layers: [{ type: 'visual', filePath: 'test.mp4', label: 'Shot 1', source: 'generated' }],
    },
    {
      id: 'scene_1_shot_2',
      label: 'Shot 2: Close',
      startTime: 10,
      endTime: 20,
      duration: 10,
      compositingMode: 'replace',
      fillStatus: 'planned',
      layers: [{ type: 'visual', filePath: 'assets/images/scene-1-shot-2.png', label: 'Shot 2', source: 'generated' }],
      transition: { type: 'crossfade', durationMs: 500 },
    },
    {
      id: 'scene_2_shot_1',
      label: 'Shot 3: Pan',
      startTime: 20,
      endTime: 30,
      duration: 10,
      compositingMode: 'replace',
      fillStatus: 'empty',
      layers: [],
    },
  ],
  globalLayers: [],
  validation: {
    isComplete: false,
    filledDuration: 10,
    gaps: [],
    warnings: [],
  },
}

describe('TimelineView', () => {
  it('shows empty state when no timeline', () => {
    renderWithState({ timeline: null })
    expect(screen.getByText(/No timeline yet/)).toBeTruthy()
  })

  it('renders segment blocks for each segment', () => {
    renderWithState({ timeline: mockTimeline })
    expect(screen.getByText('Shot 1: Wide')).toBeTruthy()
    expect(screen.getByText('Shot 2: Close')).toBeTruthy()
    expect(screen.getByText('Shot 3: Pan')).toBeTruthy()
  })

  it('shows fill status labels', () => {
    renderWithState({ timeline: mockTimeline })
    expect(screen.getByText('Filled')).toBeTruthy()
    expect(screen.getByText('Planned')).toBeTruthy()
    expect(screen.getByText('Empty')).toBeTruthy()
  })

  it('shows progress bar with correct percentage', () => {
    renderWithState({ timeline: mockTimeline })
    expect(screen.getByText(/33%/)).toBeTruthy()
    expect(screen.getByText(/10s \/ 30s/)).toBeTruthy()
  })

  it('shows filled/total count', () => {
    renderWithState({ timeline: mockTimeline })
    expect(screen.getByText('1/3 filled')).toBeTruthy()
  })

  it('shows transition badge for non-cut transitions', () => {
    renderWithState({ timeline: mockTimeline })
    expect(screen.getByText('crossfade')).toBeTruthy()
  })

  it('shows segment durations', () => {
    renderWithState({ timeline: mockTimeline })
    const durationLabels = screen.getAllByText('10s')
    expect(durationLabels.length).toBeGreaterThanOrEqual(3)
  })

  it('shows header with segment count and total duration', () => {
    renderWithState({ timeline: mockTimeline })
    expect(screen.getByText(/3 segments \/ 30s/)).toBeTruthy()
  })

  it('renders video preview for segments with a video layer', () => {
    const { container } = renderWithState({ timeline: mockTimeline, selectedProject: 'demo-project' })
    const video = container.querySelector('video')
    expect(video).toBeTruthy()
    expect(video?.getAttribute('src')).toBe('/api/v1/assets/demo-project/test.mp4')
  })

  it('renders image preview for planned segments with an image layer', () => {
    const { container } = renderWithState({ timeline: mockTimeline, selectedProject: 'demo-project' })
    const image = container.querySelector('img')
    expect(image).toBeTruthy()
    expect(image?.getAttribute('src')).toBe('/api/v1/assets/demo-project/assets/images/scene-1-shot-2.png')
  })

  it('shows scene number at the bottom of each segment card', () => {
    renderWithState({ timeline: mockTimeline })
    const sceneLabels = screen.getAllByText(/^Scene \d+$/)
    expect(sceneLabels.length).toBeGreaterThanOrEqual(3)
  })
})
