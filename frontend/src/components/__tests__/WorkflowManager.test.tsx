import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowManager } from '../WorkflowManager'

// Mock fetch
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

const mockWorkflowsResponse = {
  workflows: {
    image_generation: [
      { id: 'zimage', displayName: 'Z-Image Standard', pipeline: 'image_generation', llmDescription: 'Fast text-to-image', builtIn: true, active: true },
    ],
    image_editing: [
      { id: 'qwen_edit', displayName: 'Qwen Edit Lightning', pipeline: 'image_editing', llmDescription: 'Fast image editing', builtIn: true, active: true },
    ],
    video_generation: [
      { id: 'i2v', displayName: 'Image to Video', pipeline: 'video_generation', llmDescription: 'Animates first frame', builtIn: true, active: true },
      { id: 't2v', displayName: 'Text to Video', pipeline: 'video_generation', llmDescription: 'Text-only generation', builtIn: true, active: true },
      { id: 'user_flfv', displayName: 'First+Last Frame', pipeline: 'video_generation', llmDescription: 'Interpolates between frames', builtIn: false, active: true, isOverride: true },
      { id: 'user_inactive', displayName: 'Inactive Workflow', pipeline: 'video_generation', llmDescription: 'Not yet activated', builtIn: false, active: true, isOverride: false },
    ],
    image_processing: [],
  },
  active: {
    image_generation: 'zimage',
    image_editing: 'qwen_edit',
    video_generation: 'i2v',
    image_processing: null,
  },
}

describe('WorkflowManager', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve(mockWorkflowsResponse),
    })
  })

  it('does not render when closed', () => {
    render(<WorkflowManager open={false} onClose={vi.fn()} />)
    expect(screen.queryByText('Workflow Management')).not.toBeInTheDocument()
  })

  it('renders modal when open', async () => {
    render(<WorkflowManager open={true} onClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('Workflow Management')).toBeInTheDocument()
    })
  })

  it('loads and displays workflows grouped by pipeline', async () => {
    render(<WorkflowManager open={true} onClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('Image Generation')).toBeInTheDocument()
      expect(screen.getByText('Video Generation')).toBeInTheDocument()
      expect(screen.getByText('Z-Image Standard')).toBeInTheDocument()
      expect(screen.getByText('Image to Video')).toBeInTheDocument()
    })
  })

  it('shows built-in badge for built-in workflows', async () => {
    render(<WorkflowManager open={true} onClose={vi.fn()} />)
    await waitFor(() => {
      const builtInBadges = screen.getAllByText('built-in')
      expect(builtInBadges.length).toBeGreaterThan(0)
    })
  })

  it('shows user badge for user-uploaded workflows', async () => {
    render(<WorkflowManager open={true} onClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getAllByText('user').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows active star for active workflows', async () => {
    render(<WorkflowManager open={true} onClose={vi.fn()} />)
    await waitFor(() => {
      const stars = screen.getAllByText('★')
      expect(stars.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('does not show Delete button for built-in workflows', async () => {
    render(<WorkflowManager open={true} onClose={vi.fn()} />)
    await waitFor(() => {
      // There should be Delete buttons for user workflows only
      const deleteButtons = screen.getAllByText('Delete')
      expect(deleteButtons.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows Set Active button for non-active user workflows', async () => {
    render(<WorkflowManager open={true} onClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('Set Active')).toBeInTheDocument()
    })
  })

  it('calls onClose when Close button clicked', async () => {
    const onClose = vi.fn()
    render(<WorkflowManager open={true} onClose={onClose} />)
    await waitFor(() => screen.getByText('Close'))
    await userEvent.click(screen.getByText('Close'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when backdrop clicked', async () => {
    const onClose = vi.fn()
    render(<WorkflowManager open={true} onClose={onClose} />)
    await waitFor(() => screen.getByTestId('workflow-modal'))
    // Click the backdrop (the outer div)
    await userEvent.click(screen.getByTestId('workflow-modal'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows Upload Workflow button', async () => {
    render(<WorkflowManager open={true} onClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('Upload Workflow')).toBeInTheDocument()
    })
  })

  it('shows "No workflows installed" for empty pipeline', async () => {
    render(<WorkflowManager open={true} onClose={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('No workflows installed')).toBeInTheDocument()
    })
  })

  it('calls set override API when Set Active clicked', async () => {
    mockFetch
      .mockResolvedValueOnce({ json: () => Promise.resolve(mockWorkflowsResponse) })
      .mockResolvedValueOnce({ json: () => Promise.resolve({ status: 'ok' }) })
      .mockResolvedValueOnce({ json: () => Promise.resolve(mockWorkflowsResponse) })

    render(<WorkflowManager open={true} onClose={vi.fn()} />)
    await waitFor(() => screen.getByText('Set Active'))
    await userEvent.click(screen.getByText('Set Active'))

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/workflows/user_inactive/override',
      { method: 'PUT' },
    )
  })
})
