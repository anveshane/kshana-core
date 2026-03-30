import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowTester } from '../WorkflowTester'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

const mockVideoWorkflow = {
  id: 'test_video_wf',
  displayName: 'Test Video Workflow',
  pipeline: 'video_generation',
  outputType: 'video',
  inputRequirements: [
    { id: 'first_frame', type: 'image', source: 'shot_image', description: 'First frame', required: true },
    { id: 'prompt', type: 'text', source: 'shot_motion_directive', description: 'Motion prompt', required: true },
    { id: 'seed', type: 'number', source: 'system', description: 'Random seed', required: false },
  ],
  parameterMappings: [
    { input: 'first_frame', nodeId: '167', field: 'image' },
    { input: 'prompt', nodeId: '121', field: 'text' },
    { input: 'seed', nodeId: '296', field: 'seed' },
  ],
}

const mockImageWorkflow = {
  id: 'test_image_wf',
  displayName: 'Test Image Workflow',
  pipeline: 'image_generation',
  outputType: 'image',
  inputRequirements: [
    { id: 'prompt', type: 'text', source: 'llm', description: 'Image prompt', required: true },
  ],
  parameterMappings: [
    { input: 'prompt', nodeId: '11', field: 'text' },
  ],
}

describe('WorkflowTester', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('renders workflow name', () => {
    render(<WorkflowTester workflow={mockVideoWorkflow} onClose={vi.fn()} />)
    expect(screen.getByText('Test: Test Video Workflow')).toBeInTheDocument()
  })

  it('renders input fields for each requirement', () => {
    render(<WorkflowTester workflow={mockVideoWorkflow} onClose={vi.fn()} />)
    expect(screen.getByText('first_frame')).toBeInTheDocument()
    expect(screen.getByText('prompt')).toBeInTheDocument()
    expect(screen.getByText('seed')).toBeInTheDocument()
  })

  it('shows file picker for image inputs', () => {
    render(<WorkflowTester workflow={mockVideoWorkflow} onClose={vi.fn()} />)
    expect(screen.getByText(/Click to select image/)).toBeInTheDocument()
  })

  it('shows textarea for text/prompt inputs', () => {
    render(<WorkflowTester workflow={mockImageWorkflow} onClose={vi.fn()} />)
    const textarea = screen.getByDisplayValue(/cinematic scene/)
    expect(textarea).toBeInTheDocument()
    expect(textarea.tagName).toBe('TEXTAREA')
  })

  it('shows number input for number type', () => {
    render(<WorkflowTester workflow={mockVideoWorkflow} onClose={vi.fn()} />)
    const seedInput = screen.getAllByRole('spinbutton')[0]
    expect(seedInput).toBeInTheDocument()
  })

  it('shows Run Test button initially', () => {
    render(<WorkflowTester workflow={mockVideoWorkflow} onClose={vi.fn()} />)
    expect(screen.getByText('Run Test')).toBeInTheDocument()
  })

  it('calls onClose when back button clicked', async () => {
    const onClose = vi.fn()
    render(<WorkflowTester workflow={mockVideoWorkflow} onClose={onClose} />)
    await userEvent.click(screen.getByText('← Back to list'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows progress bar when running', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'queued', promptId: 'test-123' }),
    })
    // Poll returns running
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'running', percentage: 50, message: 'Step 5/10' }),
    })

    render(<WorkflowTester workflow={mockImageWorkflow} onClose={vi.fn()} />)
    await userEvent.click(screen.getByText('Run Test'))

    await waitFor(() => {
      expect(screen.getByText(/Queueing|Step/)).toBeInTheDocument()
    })
  })

  it('shows error state on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'ComfyUI not reachable' }),
    })

    render(<WorkflowTester workflow={mockImageWorkflow} onClose={vi.fn()} />)
    await userEvent.click(screen.getByText('Run Test'))

    await waitFor(() => {
      expect(screen.getByText('Test failed')).toBeInTheDocument()
      expect(screen.getByText(/ComfyUI not reachable/)).toBeInTheDocument()
    })
  })

  it('pre-fills default values for known inputs', () => {
    render(<WorkflowTester workflow={mockImageWorkflow} onClose={vi.fn()} />)
    const textarea = screen.getByDisplayValue(/cinematic scene/)
    expect(textarea).toBeInTheDocument()
  })

  it('deduplicates input IDs from requirements and mappings', () => {
    const wf = {
      ...mockVideoWorkflow,
      parameterMappings: [
        ...mockVideoWorkflow.parameterMappings,
        { input: 'prompt', nodeId: '999', field: 'text' }, // duplicate
      ],
    }
    render(<WorkflowTester workflow={wf} onClose={vi.fn()} />)
    // Should only have one prompt field, not two
    const promptLabels = screen.getAllByText('prompt')
    expect(promptLabels).toHaveLength(1)
  })
})
