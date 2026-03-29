import { useState, useEffect, useCallback } from 'react'

interface WorkflowMode {
  id: string
  displayName: string
  pipeline: string
  llmDescription: string
  builtIn: boolean
  active: boolean
  isOverride?: boolean
}

interface ParsedNode {
  nodeId: string
  classType: string
  title: string
  suggestedInput?: string
  inputType: string
}

interface WorkflowAnalysis {
  pipeline: string
  displayName: string
  llmDescription: string
  selectionCriteria: string
  explanation: string
  suggestedMappings: Array<{ nodeId: string; classType: string; suggestedInput: string; reason: string }>
}

interface WorkflowManagerProps {
  open: boolean
  onClose: () => void
}

const PIPELINE_LABELS: Record<string, string> = {
  image_generation: 'Image Generation',
  image_editing: 'Image Editing',
  video_generation: 'Video Generation',
  image_processing: 'Image Processing',
}

const PIPELINES = ['image_generation', 'image_editing', 'video_generation', 'image_processing']

const STANDARD_INPUTS: Record<string, string[]> = {
  image_generation: ['prompt', 'negative_prompt', 'seed', 'width', 'height', 'filenamePrefix'],
  image_editing: ['base_image', 'prompt', 'negative_prompt', 'reference_image_1', 'reference_image_2', 'seed', 'filenamePrefix'],
  video_generation: ['first_frame', 'last_frame', 'mid_frame', 'prompt', 'seed', 'durationSeconds', 'width', 'height', 'filenamePrefix'],
  image_processing: ['base_image', 'edit_prompt', 'mask', 'seed', 'filenamePrefix'],
}

const FIELD_FOR_CLASS: Record<string, string> = {
  LoadImage: 'image',
  CLIPTextEncode: 'text',
  TextEncodeQwenImageEditPlus: 'text',
  INTConstant: 'value',
  KSampler: 'seed',
  RandomNoise: 'noise_seed',
  EmptySD3LatentImage: 'width',
  EmptyLatentImage: 'width',
  SaveImage: 'filename_prefix',
  VHS_VideoCombine: 'filename_prefix',
}

export function WorkflowManager({ open, onClose }: WorkflowManagerProps) {
  const [workflows, setWorkflows] = useState<Record<string, WorkflowMode[]>>({})
  const [active, setActive] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState(false)

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardFilename, setWizardFilename] = useState('')
  const [wizardParsed, setWizardParsed] = useState<{ inputNodes: ParsedNode[]; detectedPipeline: string } | null>(null)
  const [wizardAnalysis, setWizardAnalysis] = useState<WorkflowAnalysis | null>(null)
  const [wizardAnalyzing, setWizardAnalyzing] = useState(false)

  // Wizard form
  const [wizId, setWizId] = useState('')
  const [wizName, setWizName] = useState('')
  const [wizPipeline, setWizPipeline] = useState('video_generation')
  const [wizDesc, setWizDesc] = useState('')
  const [wizCriteria, setWizCriteria] = useState('')
  const [wizMappings, setWizMappings] = useState<Record<string, string>>({})

  const loadWorkflows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/workflows')
      const data = await res.json()
      setWorkflows(data.workflows || {})
      setActive(data.active || {})
    } catch {
      // Failed to load
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (open) loadWorkflows()
  }, [open, loadWorkflows])

  const handleSetOverride = async (id: string) => {
    await fetch(`/api/v1/workflows/${id}/override`, { method: 'PUT' })
    loadWorkflows()
  }

  const handleClearOverride = async (pipeline: string) => {
    await fetch(`/api/v1/workflows/override/${pipeline}`, { method: 'DELETE' })
    loadWorkflows()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this workflow? This cannot be undone.')) return
    await fetch(`/api/v1/workflows/${id}`, { method: 'DELETE' })
    loadWorkflows()
  }

  const handleUpload = async (file: File) => {
    const content = await file.text()
    setWizardAnalyzing(true)
    setWizardOpen(true)

    try {
      const res = await fetch('/api/v1/workflows/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, content }),
      })
      const data = await res.json()
      if (data.error) {
        alert('Upload failed: ' + data.error)
        setWizardOpen(false)
        return
      }

      setWizardFilename(data.filename)
      setWizardParsed(data.parsed)
      setWizardAnalysis(data.analysis)

      // Pre-fill from analysis
      const safeName = data.filename.replace(/\.json$/, '')
      setWizId(safeName)
      setWizName(data.analysis?.displayName || safeName.replace(/_/g, ' '))
      setWizPipeline(data.analysis?.pipeline || data.parsed.detectedPipeline || 'video_generation')
      setWizDesc(data.analysis?.llmDescription || '')
      setWizCriteria(data.analysis?.selectionCriteria || '')

      // Pre-fill mappings from analysis suggestions
      const mappings: Record<string, string> = {}
      for (const node of data.parsed.inputNodes) {
        const suggestion = data.analysis?.suggestedMappings?.find(
          (s: { nodeId: string }) => s.nodeId === node.nodeId,
        )
        mappings[node.nodeId] = suggestion?.suggestedInput || node.suggestedInput || ''
      }
      setWizMappings(mappings)
    } catch (err) {
      alert('Upload failed: ' + err)
      setWizardOpen(false)
    }
    setWizardAnalyzing(false)
  }

  const handleSaveWizard = async () => {
    if (!wizId.trim() || !wizName.trim()) {
      alert('ID and display name are required')
      return
    }

    const parameterMappings = []
    const inputRequirements = []
    for (const node of wizardParsed?.inputNodes || []) {
      const mapped = wizMappings[node.nodeId]
      if (mapped) {
        parameterMappings.push({
          input: mapped,
          nodeId: node.nodeId,
          field: FIELD_FOR_CLASS[node.classType] || 'value',
        })
        const isImage = node.classType === 'LoadImage'
        inputRequirements.push({
          id: mapped,
          type: isImage ? 'image' : 'text',
          source: isImage ? 'shot_image' : (mapped === 'prompt' || mapped === 'edit_prompt' ? 'shot_motion_directive' : 'system'),
          description: mapped,
          required: true,
        })
      }
    }

    const manifest = {
      id: wizId,
      displayName: wizName,
      pipeline: wizPipeline,
      llmDescription: wizDesc,
      selectionCriteria: wizCriteria,
      outputType: wizPipeline === 'video_generation' ? 'video' : 'image',
      priority: 10,
      inputRequirements,
      workflowFile: wizardFilename,
      format: 'litegraph',
      parameterMappings,
      builtIn: false,
      active: true,
    }

    try {
      const res = await fetch('/api/v1/workflows/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manifest),
      })
      const data = await res.json()
      if (data.error) {
        alert('Save failed: ' + data.error)
        return
      }
      setWizardOpen(false)
      loadWorkflows()
    } catch (err) {
      alert('Save failed: ' + err)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 overflow-y-auto py-10"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      data-testid="workflow-modal"
    >
      <div className="glass-panel-strong w-full max-w-2xl mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line-soft">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
            Workflow Management
          </h2>
          <div className="flex gap-2">
            <label className="px-4 py-2 rounded-md bg-cyan text-background font-mono text-xs font-semibold cursor-pointer hover:bg-cyan/90 transition-colors">
              Upload Workflow
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleUpload(file)
                  e.target.value = ''
                }}
              />
            </label>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-md border border-line-soft text-graphite-100 hover:text-foreground transition-colors font-mono text-xs cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>

        {/* Workflow list */}
        <div className="px-6 py-4 space-y-5">
          {loading ? (
            <div className="text-center text-graphite-100 py-8">Loading workflows...</div>
          ) : (
            PIPELINES.map((pipeline) => {
              const items = workflows[pipeline] || []
              const activeId = active[pipeline]

              return (
                <div key={pipeline}>
                  <h3 className="font-mono text-[10px] uppercase tracking-widest text-graphite-100 mb-2">
                    {PIPELINE_LABELS[pipeline] || pipeline}
                  </h3>

                  {items.length === 0 ? (
                    <div className="text-xs text-graphite-200 px-3 py-2">No workflows installed</div>
                  ) : (
                    <div className="space-y-1.5">
                      {items.map((wf) => {
                        const isActive = wf.id === activeId
                        return (
                          <div
                            key={wf.id}
                            className={`flex items-center justify-between px-3 py-2.5 rounded-lg border ${
                              isActive ? 'border-cyan/30 bg-cyan/5' : 'border-line-soft bg-graphite-400/30'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                {isActive && <span className="text-cyan text-sm">★</span>}
                                <span className="text-sm text-foreground">{wf.displayName}</span>
                                <span className={`font-mono text-[10px] ${wf.builtIn ? 'text-graphite-200' : 'text-green'}`}>
                                  {wf.builtIn ? 'built-in' : 'user'}
                                </span>
                              </div>
                              {wf.llmDescription && (
                                <div className="text-[11px] text-graphite-100 mt-0.5 line-clamp-1">
                                  {wf.llmDescription}
                                </div>
                              )}
                            </div>

                            <div className="flex gap-1.5 flex-shrink-0 ml-3">
                              {!wf.builtIn && !isActive && (
                                <button
                                  onClick={() => handleSetOverride(wf.id)}
                                  className="px-2.5 py-1 rounded text-[11px] font-mono bg-cyan/20 text-cyan hover:bg-cyan/30 transition-colors cursor-pointer"
                                >
                                  Set Active
                                </button>
                              )}
                              {!wf.builtIn && isActive && (
                                <button
                                  onClick={() => handleClearOverride(pipeline)}
                                  className="px-2.5 py-1 rounded text-[11px] font-mono border border-line-soft text-graphite-100 hover:text-foreground transition-colors cursor-pointer"
                                >
                                  Revert
                                </button>
                              )}
                              {!wf.builtIn && (
                                <button
                                  onClick={() => handleDelete(wf.id)}
                                  className="px-2.5 py-1 rounded text-[11px] font-mono bg-error/10 text-error hover:bg-error/20 transition-colors cursor-pointer"
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Integration Wizard */}
        {wizardOpen && (
          <div className="px-6 py-4 border-t border-line-soft">
            <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold mb-4">
              Configure Workflow
            </h3>

            {wizardAnalyzing ? (
              <div className="text-center text-graphite-100 py-8">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-cyan animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 rounded-full bg-cyan animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 rounded-full bg-cyan animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                Analyzing workflow with AI...
              </div>
            ) : (
              <div className="space-y-4">
                {/* AI Analysis banner */}
                {wizardAnalysis?.explanation && (
                  <div className="px-4 py-3 rounded-lg border border-cyan/20 bg-cyan/5">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-cyan mb-1">AI Analysis</div>
                    <div className="text-xs text-graphite-050">{wizardAnalysis.explanation}</div>
                  </div>
                )}

                {/* Step 1: ID & Name */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-graphite-100 mb-1">Workflow ID</label>
                    <input
                      value={wizId}
                      onChange={(e) => setWizId(e.target.value)}
                      className="w-full px-3 py-2 rounded-md bg-graphite-300 border border-line-soft text-sm text-foreground focus:outline-none focus:border-cyan/40"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-graphite-100 mb-1">Display Name</label>
                    <input
                      value={wizName}
                      onChange={(e) => setWizName(e.target.value)}
                      className="w-full px-3 py-2 rounded-md bg-graphite-300 border border-line-soft text-sm text-foreground focus:outline-none focus:border-cyan/40"
                    />
                  </div>
                </div>

                {/* Pipeline type */}
                <div>
                  <label className="block text-xs text-graphite-100 mb-1">Pipeline Type</label>
                  <select
                    value={wizPipeline}
                    onChange={(e) => setWizPipeline(e.target.value)}
                    className="w-full px-3 py-2 rounded-md bg-graphite-300 border border-line-soft text-sm text-foreground focus:outline-none focus:border-cyan/40"
                  >
                    {PIPELINES.map((p) => (
                      <option key={p} value={p}>{PIPELINE_LABELS[p]}</option>
                    ))}
                  </select>
                </div>

                {/* Step 2: Input mappings */}
                {wizardParsed && wizardParsed.inputNodes.length > 0 && (
                  <div>
                    <label className="block text-xs text-graphite-100 mb-2">
                      Map Input Nodes ({wizardParsed.inputNodes.length} found)
                    </label>
                    <div className="space-y-1.5">
                      {wizardParsed.inputNodes.map((node) => {
                        const suggestion = wizardAnalysis?.suggestedMappings?.find(
                          (s) => s.nodeId === node.nodeId,
                        )
                        return (
                          <div key={node.nodeId} className="flex items-center gap-2 px-3 py-2 rounded bg-graphite-400/50">
                            <span className="font-mono text-[10px] text-graphite-200 w-10">#{node.nodeId}</span>
                            <span className="text-xs text-graphite-050 w-32 truncate">{node.title}</span>
                            <span className="text-graphite-300">→</span>
                            <select
                              value={wizMappings[node.nodeId] || ''}
                              onChange={(e) => setWizMappings({ ...wizMappings, [node.nodeId]: e.target.value })}
                              className="flex-1 px-2 py-1 rounded bg-graphite-300 border border-line-soft text-xs text-foreground"
                            >
                              <option value="">(leave as default)</option>
                              {(STANDARD_INPUTS[wizPipeline] || []).map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                            {suggestion?.reason && (
                              <span className="text-[10px] text-graphite-200 max-w-32 truncate" title={suggestion.reason}>
                                💡 {suggestion.reason}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Step 3: LLM description */}
                <div>
                  <label className="block text-xs text-graphite-100 mb-1">Description (for LLM)</label>
                  <textarea
                    value={wizDesc}
                    onChange={(e) => setWizDesc(e.target.value)}
                    rows={3}
                    placeholder="What does this workflow do?"
                    className="w-full px-3 py-2 rounded-md bg-graphite-300 border border-line-soft text-sm text-foreground resize-y focus:outline-none focus:border-cyan/40"
                  />
                </div>

                <div>
                  <label className="block text-xs text-graphite-100 mb-1">Selection Criteria</label>
                  <textarea
                    value={wizCriteria}
                    onChange={(e) => setWizCriteria(e.target.value)}
                    rows={2}
                    placeholder="When should the LLM choose this workflow?"
                    className="w-full px-3 py-2 rounded-md bg-graphite-300 border border-line-soft text-sm text-foreground resize-y focus:outline-none focus:border-cyan/40"
                  />
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setWizardOpen(false)}
                    className="px-4 py-2 rounded-md border border-line-soft text-graphite-100 hover:text-foreground transition-colors font-mono text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveWizard}
                    className="px-4 py-2 rounded-md bg-cyan text-background font-mono text-xs font-semibold hover:bg-cyan/90 transition-colors cursor-pointer"
                  >
                    Save Workflow
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
