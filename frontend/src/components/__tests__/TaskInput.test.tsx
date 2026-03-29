import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithState } from '../../test/helpers'
import { TaskInput } from '../TaskInput'

describe('TaskInput', () => {
  it('renders input field and send button', () => {
    renderWithState(<TaskInput onSend={vi.fn()} />, {
      state: { connectionStatus: 'connected', agentStatus: 'idle' },
    })
    expect(screen.getByPlaceholderText('Type a task...')).toBeInTheDocument()
    expect(screen.getByText('Send')).toBeInTheDocument()
  })

  it('disables input when disconnected', () => {
    renderWithState(<TaskInput onSend={vi.fn()} />, {
      state: { connectionStatus: 'disconnected' },
    })
    expect(screen.getByPlaceholderText('Waiting...')).toBeDisabled()
  })

  it('disables input when agent is thinking', () => {
    renderWithState(<TaskInput onSend={vi.fn()} />, {
      state: { connectionStatus: 'connected', agentStatus: 'thinking' },
    })
    expect(screen.getByPlaceholderText('Waiting...')).toBeDisabled()
  })

  it('sends task on Enter key', async () => {
    const onSend = vi.fn()
    renderWithState(<TaskInput onSend={onSend} />, {
      state: { connectionStatus: 'connected', agentStatus: 'idle' },
    })
    const input = screen.getByPlaceholderText('Type a task...')
    await userEvent.type(input, 'Generate a video{Enter}')
    expect(onSend).toHaveBeenCalledWith('Generate a video')
  })

  it('sends task on Send button click', async () => {
    const onSend = vi.fn()
    renderWithState(<TaskInput onSend={onSend} />, {
      state: { connectionStatus: 'connected', agentStatus: 'idle' },
    })
    const input = screen.getByPlaceholderText('Type a task...')
    await userEvent.type(input, 'Create a scene')
    await userEvent.click(screen.getByText('Send'))
    expect(onSend).toHaveBeenCalledWith('Create a scene')
  })

  it('clears input after sending', async () => {
    renderWithState(<TaskInput onSend={vi.fn()} />, {
      state: { connectionStatus: 'connected', agentStatus: 'idle' },
    })
    const input = screen.getByPlaceholderText('Type a task...')
    await userEvent.type(input, 'Test task{Enter}')
    expect(input).toHaveValue('')
  })

  it('does not send empty input', async () => {
    const onSend = vi.fn()
    renderWithState(<TaskInput onSend={onSend} />, {
      state: { connectionStatus: 'connected', agentStatus: 'idle' },
    })
    await userEvent.click(screen.getByText('Send'))
    expect(onSend).not.toHaveBeenCalled()
  })
})
