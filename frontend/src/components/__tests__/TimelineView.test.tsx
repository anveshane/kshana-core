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
      layers: [],
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
    expect(screen.getByText(/No timeline yet/)).toBeInTheDocument()
  })

  it('renders segment blocks for each segment', () => {
    renderWithState({ timeline: mockTimeline })
    expect(screen.getByText('Shot 1: Wide')).toBeInTheDocument()
    expect(screen.getByText('Shot 2: Close')).toBeInTheDocument()
    expect(screen.getByText('Shot 3: Pan')).toBeInTheDocument()
  })

  it('shows fill status labels', () => {
    renderWithState({ timeline: mockTimeline })
    expect(screen.getByText('Filled')).toBeInTheDocument()
    expect(screen.getByText('Planned')).toBeInTheDocument()
    expect(screen.getByText('Empty')).toBeInTheDocument()
  })

  it('shows progress bar with correct percentage', () => {
    renderWithState({ timeline: mockTimeline })
    // 10/30 = 33%
    expect(screen.getByText(/33%/)).toBeInTheDocument()
    expect(screen.getByText(/10s \/ 30s/)).toBeInTheDocument()
  })

  it('shows filled/total count', () => {
    renderWithState({ timeline: mockTimeline })
    expect(screen.getByText('1/3 filled')).toBeInTheDocument()
  })

  it('shows transition badge for non-cut transitions', () => {
    renderWithState({ timeline: mockTimeline })
    expect(screen.getByText('crossfade')).toBeInTheDocument()
  })

  it('shows segment durations', () => {
    renderWithState({ timeline: mockTimeline })
    const durationLabels = screen.getAllByText('10s')
    expect(durationLabels.length).toBeGreaterThanOrEqual(3)
  })

  it('shows header with segment count and total duration', () => {
    renderWithState({ timeline: mockTimeline })
    expect(screen.getByText(/3 segments \/ 30s/)).toBeInTheDocument()
  })
})
