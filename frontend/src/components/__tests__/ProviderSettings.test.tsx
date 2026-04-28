import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProviderSettings } from '../ProviderSettings'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

const mockProviderData = {
  providers: {
    imageGeneration: [
      { id: 'comfyui', name: 'ComfyUI', available: true },
      { id: 'google', name: 'Google AI', available: true },
    ],
    imageEditing: [
      { id: 'comfyui', name: 'ComfyUI', available: true },
    ],
    videoGeneration: [
      { id: 'comfyui', name: 'ComfyUI', available: true },
      { id: 'xai', name: 'xAI', available: true },
    ],
  },
  currentConfig: {
    imageGeneration: 'comfyui',
    imageEditing: 'comfyui',
    videoGeneration: 'comfyui',
  },
}

describe('ProviderSettings', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({ json: () => Promise.resolve(mockProviderData) })
  })

  it('does not render when closed', () => {
    render(<ProviderSettings open={false} onClose={vi.fn()} />)
    expect(screen.queryByText('Provider Settings')).not.toBeInTheDocument()
  })

  it('renders when open', async () => {
    render(<ProviderSettings open={true} onClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('Provider Settings')).toBeInTheDocument()
    })
  })

  it('shows provider dropdowns', async () => {
    render(<ProviderSettings open={true} onClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('Image Generation')).toBeInTheDocument()
      expect(screen.getByText('Image Editing')).toBeInTheDocument()
      expect(screen.getByText('Video Generation')).toBeInTheDocument()
    })
  })

  it('calls onClose when Cancel clicked', async () => {
    const onClose = vi.fn()
    render(<ProviderSettings open={true} onClose={onClose} />)
    await waitFor(() => screen.getByText('Cancel'))
    await userEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('saves config and closes on Save', async () => {
    const onClose = vi.fn()
    mockFetch
      .mockResolvedValueOnce({ json: () => Promise.resolve(mockProviderData) }) // load
      .mockResolvedValueOnce({ json: () => Promise.resolve({ status: 'ok' }) }) // save

    render(<ProviderSettings open={true} onClose={onClose} />)
    await waitFor(() => screen.getByText('Save'))
    await userEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/providers/config',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })
})
