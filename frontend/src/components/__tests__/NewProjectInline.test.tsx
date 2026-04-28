import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewProjectInline } from '../NewProjectInline'

const mockTemplates = {
  templates: [
    {
      id: 'narrative',
      displayName: 'Narrative Video',
      description: 'Full cinematic pipeline',
      styles: [
        { id: 'cinematic_realism', displayName: 'Cinematic Realism', description: 'Photorealistic' },
        { id: 'anime', displayName: 'Anime', description: 'Anime style' },
        { id: 'watercolor', displayName: 'Watercolor', description: 'Artistic' },
      ],
    },
    {
      id: 'documentary',
      displayName: 'Documentary',
      description: 'Thesis-driven documentary',
      styles: [
        { id: 'cinematic_realism', displayName: 'Cinematic Realism' },
      ],
    },
    {
      id: 'short',
      displayName: 'YouTube Short',
      description: 'Short-form vertical video',
      styles: [],  // No styles — should skip style step
    },
  ],
}

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

describe('NewProjectInline', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve(mockTemplates),
    })
  })

  it('renders template selection on mount', async () => {
    render(
      <NewProjectInline onReady={vi.fn()} onCancel={vi.fn()} onStepChange={vi.fn()} />
    )
    await waitFor(() => {
      expect(screen.getByText('Narrative Video')).toBeInTheDocument()
      expect(screen.getByText('Documentary')).toBeInTheDocument()
      expect(screen.getByText('YouTube Short')).toBeInTheDocument()
    })
  })

  it('shows style selection after clicking a template with styles', async () => {
    render(
      <NewProjectInline onReady={vi.fn()} onCancel={vi.fn()} onStepChange={vi.fn()} />
    )
    await waitFor(() => screen.getByText('Narrative Video'))
    await userEvent.click(screen.getByText('Narrative Video'))

    expect(screen.getByText('Cinematic Realism')).toBeInTheDocument()
    expect(screen.getByText('Anime')).toBeInTheDocument()
    expect(screen.getByText('Watercolor')).toBeInTheDocument()
  })

  it('skips style selection for templates without styles', async () => {
    render(
      <NewProjectInline onReady={vi.fn()} onCancel={vi.fn()} onStepChange={vi.fn()} />
    )
    await waitFor(() => screen.getByText('YouTube Short'))
    await userEvent.click(screen.getByText('YouTube Short'))

    // Should jump straight to duration
    expect(screen.getByText('30 seconds')).toBeInTheDocument()
    expect(screen.getByText('1 minute')).toBeInTheDocument()
  })

  it('shows duration selection after choosing style', async () => {
    render(
      <NewProjectInline onReady={vi.fn()} onCancel={vi.fn()} onStepChange={vi.fn()} />
    )
    await waitFor(() => screen.getByText('Narrative Video'))
    await userEvent.click(screen.getByText('Narrative Video'))
    await userEvent.click(screen.getByText('Anime'))

    expect(screen.getByText('30 seconds')).toBeInTheDocument()
    expect(screen.getByText('1 minute')).toBeInTheDocument()
    expect(screen.getByText('2 minutes')).toBeInTheDocument()
    expect(screen.getByText('3 minutes')).toBeInTheDocument()
    expect(screen.getByText('5 minutes')).toBeInTheDocument()
  })

  it('calls onReady with correct state: narrative + cinematic + 60s', async () => {
    const onReady = vi.fn()
    render(
      <NewProjectInline onReady={onReady} onCancel={vi.fn()} onStepChange={vi.fn()} />
    )
    await waitFor(() => screen.getByText('Narrative Video'))
    await userEvent.click(screen.getByText('Narrative Video'))
    await userEvent.click(screen.getByText('Cinematic Realism'))
    await userEvent.click(screen.getByText('1 minute'))

    expect(onReady).toHaveBeenCalledWith({
      templateId: 'narrative',
      style: 'cinematic_realism',
      duration: 60,
    })
  })

  it('calls onReady with correct state: narrative + anime + 30s', async () => {
    const onReady = vi.fn()
    render(
      <NewProjectInline onReady={onReady} onCancel={vi.fn()} onStepChange={vi.fn()} />
    )
    await waitFor(() => screen.getByText('Narrative Video'))
    await userEvent.click(screen.getByText('Narrative Video'))
    await userEvent.click(screen.getByText('Anime'))
    await userEvent.click(screen.getByText('30 seconds'))

    expect(onReady).toHaveBeenCalledWith({
      templateId: 'narrative',
      style: 'anime',
      duration: 30,
    })
  })

  it('calls onReady with correct state: documentary + cinematic + 5min', async () => {
    const onReady = vi.fn()
    render(
      <NewProjectInline onReady={onReady} onCancel={vi.fn()} onStepChange={vi.fn()} />
    )
    await waitFor(() => screen.getByText('Documentary'))
    await userEvent.click(screen.getByText('Documentary'))
    await userEvent.click(screen.getByText('Cinematic Realism'))
    await userEvent.click(screen.getByText('5 minutes'))

    expect(onReady).toHaveBeenCalledWith({
      templateId: 'documentary',
      style: 'cinematic_realism',
      duration: 300,
    })
  })

  it('calls onReady with default style for template without styles', async () => {
    const onReady = vi.fn()
    render(
      <NewProjectInline onReady={onReady} onCancel={vi.fn()} onStepChange={vi.fn()} />
    )
    await waitFor(() => screen.getByText('YouTube Short'))
    await userEvent.click(screen.getByText('YouTube Short'))
    await userEvent.click(screen.getByText('30 seconds'))

    expect(onReady).toHaveBeenCalledWith({
      templateId: 'short',
      style: 'cinematic_realism', // default fallback
      duration: 30,
    })
  })

  it('calls onCancel when Cancel clicked', async () => {
    const onCancel = vi.fn()
    render(
      <NewProjectInline onReady={vi.fn()} onCancel={onCancel} onStepChange={vi.fn()} />
    )
    await waitFor(() => screen.getByText('Cancel'))
    await userEvent.click(screen.getByText('Cancel'))

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('Back button returns to template from style', async () => {
    render(
      <NewProjectInline onReady={vi.fn()} onCancel={vi.fn()} onStepChange={vi.fn()} />
    )
    await waitFor(() => screen.getByText('Narrative Video'))
    await userEvent.click(screen.getByText('Narrative Video'))

    // Should be on style step
    expect(screen.getByText('Cinematic Realism')).toBeInTheDocument()

    await userEvent.click(screen.getByText('← Back'))

    // Should be back on template step
    expect(screen.getByText('Narrative Video')).toBeInTheDocument()
    expect(screen.getByText('Documentary')).toBeInTheDocument()
  })

  it('Back button returns to style from duration', async () => {
    render(
      <NewProjectInline onReady={vi.fn()} onCancel={vi.fn()} onStepChange={vi.fn()} />
    )
    await waitFor(() => screen.getByText('Narrative Video'))
    await userEvent.click(screen.getByText('Narrative Video'))
    await userEvent.click(screen.getByText('Anime'))

    // Should be on duration step
    expect(screen.getByText('30 seconds')).toBeInTheDocument()

    await userEvent.click(screen.getByText('← Back'))

    // Should be back on style step
    expect(screen.getByText('Anime')).toBeInTheDocument()
    expect(screen.getByText('Watercolor')).toBeInTheDocument()
  })

  it('calls onStepChange at each step', async () => {
    const onStepChange = vi.fn()
    render(
      <NewProjectInline onReady={vi.fn()} onCancel={vi.fn()} onStepChange={onStepChange} />
    )
    await waitFor(() => screen.getByText('Narrative Video'))

    await userEvent.click(screen.getByText('Narrative Video'))
    expect(onStepChange).toHaveBeenCalledWith('template', 'Narrative Video')

    await userEvent.click(screen.getByText('Anime'))
    expect(onStepChange).toHaveBeenCalledWith('style', 'Anime')

    await userEvent.click(screen.getByText('2 minutes'))
    expect(onStepChange).toHaveBeenCalledWith('duration', '2 minutes')
  })
})
