import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useEffect, type Dispatch } from 'react'
import { useMessageHandler } from '../useMessageHandler'
import type { AppAction } from '../../lib/store'
import type { ServerMessage } from '../useWebSocket'

function Harness({
  dispatch,
  onReady,
}: {
  dispatch: Dispatch<AppAction>
  onReady: (handler: (message: ServerMessage) => void) => void
}) {
  const handler = useMessageHandler(dispatch)

  useEffect(() => {
    onReady(handler)
  }, [handler, onReady])

  return null
}

describe('useMessageHandler', () => {
  it('selects the project when a status message includes projectName', () => {
    const dispatch = vi.fn()
    let handler: ((message: ServerMessage) => void) | undefined

    render(<Harness dispatch={dispatch} onReady={(nextHandler) => { handler = nextHandler }} />)

    handler?.({
      type: 'status',
      sessionId: 'sess-1',
      data: {
        status: 'ready',
        projectName: 'time-travel-story',
      },
    })

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: 'SELECT_PROJECT',
      name: 'time-travel-story',
    })
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: 'SET_AGENT_STATUS',
      status: 'idle',
    })
  })

  it('forwards timeline updates to the store', () => {
    const dispatch = vi.fn()
    let handler: ((message: ServerMessage) => void) | undefined
    const timeline = {
      version: '1.0',
      totalDuration: 30,
      defaultCompositingMode: 'replace',
      segments: [{ id: 'scene_1', label: 'Scene 1', startTime: 0, endTime: 30, duration: 30, fillStatus: 'planned', layers: [] }],
      globalLayers: [],
      validation: { isComplete: false, filledDuration: 0, gaps: [], warnings: [] },
    }

    render(<Harness dispatch={dispatch} onReady={(nextHandler) => { handler = nextHandler }} />)

    handler?.({
      type: 'timeline_update',
      sessionId: 'sess-1',
      data: { timeline },
    })

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_TIMELINE',
      timeline,
    })
  })
})
