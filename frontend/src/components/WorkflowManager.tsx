import { useState, useEffect, useCallback } from 'react'
import { Dropdown } from './Dropdown'
import { WorkflowTester } from './WorkflowTester'

interface WorkflowMode {
  id: string
  displayName: string
  pipeline: string
  llmDescription: string
  selectionCriteria?: string
  builtIn: boolean
  active: boolean
  isOverride?: boolean
  outputType: string
  workflowFile?: string
  inputRequirements: Array<{ id: string; type: string; source: string; description: string; required: boolean }>
  parameterMappings: Array<{ input: string; nodeId: string; field: string; defaultValue?: unknown }>
  promptKeywords?: { prepend?: string; append?: string; negativeAppend?: string }
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
  video_generation: ['first_frame', 'last_frame', 'mid_frame', 'prompt', 'negative_prompt', 'seed', 'durationSeconds', 'width', 'height', 'filenamePrefix'],
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
  const [testingWorkflow, setTestingWorkflow] = useState<WorkflowMode | null>(null)
  const [wizardFilename, setWizardFilename] = useState('')
  const [wizardParsed, setWizardParsed] = useState<{ inputNodes: ParsedNode[]; detectedPipeline: string; loraNodes?: Array<{ nodeId: string; loraName?: string }> } | null>(null)
  const [wizardAnalysis, setWizardAnalysis] = useState<WorkflowAnalysis | null>(null)
  const [wizardAnalyzing, setWizardAnalyzing] = useState(false)

  // Wizard form
  const [wizId, setWizId] = useState('')
  const [wizName, setWizName] = useState('')
  const [wizPipeline, setWizPipeline] = useState('video_generation')
  const [wizDesc, setWizDesc] = useState('')
  const [wizCriteria, setWizCriteria] = useState('')
  const [wizMappings, setWizMappings] = useState<Record<string, string>>({})
  const [wizDefaults, setWizDefaults] = useState<Record<string, string>>({})
  const [wizDescriptions, setWizDescriptions] = useState<Record<string, string>>({})
  const [wizKeywordsPrepend, setWizKeywordsPrepend] = useState('')
  const [wizKeywordsAppend, setWizKeywordsAppend] = useState('')
  const [wizKeywordsNegative, setWizKeywordsNegative] = useState('')

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

  const handleClearOverride = async (id: string) => {
    await fetch(`/api/v1/workflows/${id}/deactivate`, { method: 'PUT' })
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

      // Pre-fill LoRA keywords from analysis
      const kw = data.analysis?.suggestedKeywords
      if (kw) {
        setWizKeywordsPrepend(kw.prepend || '')
        setWizKeywordsAppend(kw.append || '')
        setWizKeywordsNegative(kw.negativeAppend || '')
      }
    } catch (err) {
      alert('Upload failed: ' + err)
      setWizardOpen(false)
    }
    setWizardAnalyzing(false)
  }

  const handleEditWorkflow = async (wf: any) => {
    // Re-parse the workflow JSON from the server to get input nodes
    setWizardOpen(true)
    setWizardAnalyzing(true)
    try {
      // Fetch the workflow file to re-parse it
      const res = await fetch(`/api/v1/workflows/reparse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowFile: wf.workflowFile }),
      })
      const data = await res.json()

      if (data.parsed) {
        setWizardParsed(data.parsed)
        setWizardFilename(wf.workflowFile as string)
      }
    } catch {
      // If re-parse fails, create synthetic input nodes from parameterMappings
      const mappings = (wf.parameterMappings || []) as Array<{ input: string; nodeId: string; field: string; defaultValue?: unknown }>
      const syntheticNodes = mappings.map(m => ({
        nodeId: m.nodeId,
        classType: m.field === 'image' ? 'LoadImage' : 'CLIPTextEncode',
        title: `Node #${m.nodeId}`,
        inputType: m.field === 'image' ? 'image' : 'text',
        suggestedInput: m.input,
      }))
      // Deduplicate by nodeId
      const unique = syntheticNodes.filter((n, i, arr) => arr.findIndex(x => x.nodeId === n.nodeId) === i)
      setWizardParsed({
        detectedPipeline: wf.pipeline as string,
        inputNodes: unique as any,
        loraNodes: [],
      })
      setWizardFilename(wf.workflowFile as string)
    }
    setWizardAnalyzing(false)

    // Populate wizard fields from existing manifest
    setWizId(wf.id as string)
    setWizName(wf.displayName as string)
    setWizPipeline(wf.pipeline as string)
    setWizDesc(wf.llmDescription as string || '')
    setWizCriteria(wf.selectionCriteria as string || '')

    // Restore mappings, defaults, and descriptions from parameterMappings + inputRequirements
    const mappings = (wf.parameterMappings || []) as Array<{ input: string; nodeId: string; field: string; defaultValue?: unknown }>
    const requirements = (wf.inputRequirements || []) as Array<{ id: string; description?: string }>
    const reqMap = new Map(requirements.map(r => [r.id, r]))

    const wizMap: Record<string, string> = {}
    const wizDef: Record<string, string> = {}
    const wizDescMap: Record<string, string> = {}
    for (const m of mappings) {
      wizMap[m.nodeId] = m.input
      if (m.defaultValue !== undefined) wizDef[m.nodeId] = String(m.defaultValue)
      const req = reqMap.get(m.input)
      if (req?.description && req.description !== m.input) wizDescMap[m.nodeId] = req.description
    }
    setWizMappings(wizMap)
    setWizDefaults(wizDef)
    setWizDescriptions(wizDescMap)

    // Restore keywords
    const kw = wf.promptKeywords as { prepend?: string; append?: string; negativeAppend?: string } | undefined
    setWizKeywordsPrepend(kw?.prepend || '')
    setWizKeywordsAppend(kw?.append || '')
    setWizKeywordsNegative(kw?.negativeAppend || '')
  }

  const handleSaveWizard = async () => {
    if (!wizId.trim() || !wizName.trim()) {
      alert('ID and display name are required')
      return
    }

    const parameterMappings: Array<{ input: string; nodeId: string; field: string; defaultValue?: unknown }> = []
    const inputRequirements: Array<{ id: string; type: string; source: string; description: string; required: boolean }> = []
    const seenInputIds = new Set<string>()
    for (const node of wizardParsed?.inputNodes || []) {
      const mapped = wizMappings[node.nodeId]
      if (mapped) {
        // Parse default value: "true"/"false" → boolean, numbers → number, else string
        let defaultValue: unknown = wizDefaults[node.nodeId] || undefined
        if (defaultValue === 'true') defaultValue = true
        else if (defaultValue === 'false') defaultValue = false
        else if (defaultValue && !isNaN(Number(defaultValue))) defaultValue = Number(defaultValue)

        parameterMappings.push({
          input: mapped,
          nodeId: node.nodeId,
          field: FIELD_FOR_CLASS[node.classType] || 'value',
          ...(defaultValue !== undefined ? { defaultValue } : {}),
        })
        // Only add one inputRequirement per unique input ID
        if (!seenInputIds.has(mapped)) {
          seenInputIds.add(mapped)
          const isImage = node.classType === 'LoadImage'
          const desc = wizDescriptions[node.nodeId] || mapped
          inputRequirements.push({
            id: mapped,
            type: isImage ? 'image' : 'text',
            source: isImage ? 'shot_image' : (mapped === 'prompt' || mapped === 'edit_prompt' ? 'shot_motion_directive' : 'system'),
            description: desc,
            required: defaultValue === undefined, // not required if default is set
          })
        }
      }
    }

    // Build prompt keywords if any are set
    const promptKeywords = (wizKeywordsPrepend || wizKeywordsAppend || wizKeywordsNegative) ? {
      ...(wizKeywordsPrepend ? { prepend: wizKeywordsPrepend } : {}),
      ...(wizKeywordsAppend ? { append: wizKeywordsAppend } : {}),
      ...(wizKeywordsNegative ? { negativeAppend: wizKeywordsNegative } : {}),
    } : undefined

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
      promptKeywords,
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

  // Determine view: list, wizard, or test
  const view = testingWorkflow ? 'test' : wizardOpen ? 'wizard' : 'list'

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 overflow-y-auto py-10"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      data-testid="workflow-modal"
    >
      <div className="glass-panel-strong w-full max-w-2xl mx-4">
        {/* Header — changes based on view */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line-soft">
          {view === 'list' && (
            <>
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
            </>
          )}
          {view === 'wizard' && (
            <>
              <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
                Configure Workflow
              </h2>
              <button
                onClick={() => setWizardOpen(false)}
                className="px-4 py-2 rounded-md border border-line-soft text-graphite-100 hover:text-foreground transition-colors font-mono text-xs cursor-pointer"
              >
                ← Back to list
              </button>
            </>
          )}
          {view === 'test' && (
            <>
              <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
                Test: {testingWorkflow?.displayName}
              </h2>
              <button
                onClick={() => setTestingWorkflow(null)}
                className="px-4 py-2 rounded-md border border-line-soft text-graphite-100 hover:text-foreground transition-colors font-mono text-xs cursor-pointer"
              >
                ← Back to list
              </button>
            </>
          )}
        </div>

        {/* === LIST VIEW === */}
        {view === 'list' && (
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
                                  onClick={() => handleClearOverride(wf.id)}
                                  className="px-2.5 py-1 rounded text-[11px] font-mono border border-line-soft text-graphite-100 hover:text-foreground transition-colors cursor-pointer"
                                >
                                  Revert
                                </button>
                              )}
                              {!wf.builtIn && (
                                <button
                                  onClick={() => handleEditWorkflow(wf)}
                                  className="px-2.5 py-1 rounded text-[11px] font-mono border border-line-soft text-graphite-100 hover:text-foreground hover:border-line-strong transition-colors cursor-pointer"
                                >
                                  Edit
                                </button>
                              )}
                              <button
                                onClick={() => setTestingWorkflow(wf)}
                                className="px-2.5 py-1 rounded text-[11px] font-mono border border-cyan/20 text-cyan hover:bg-cyan/10 transition-colors cursor-pointer"
                              >
                                Test
                              </button>
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
        )}

        {/* === WIZARD VIEW === */}
        {view === 'wizard' && (
          <div className="px-6 py-4">

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
                  <Dropdown
                    options={PIPELINES.map(p => ({ value: p, label: PIPELINE_LABELS[p] || p }))}
                    value={wizPipeline}
                    onChange={setWizPipeline}
                    placeholder="Select pipeline..."
                  />
                </div>

                {/* Step 2: Input mappings */}
                {wizardParsed && wizardParsed.inputNodes.length > 0 && (
                  <div>
                    <label className="block text-xs text-graphite-100 mb-2">
                      Map Input Nodes ({wizardParsed.inputNodes.length} found)
                    </label>
                    <div className="space-y-2">
                      {wizardParsed.inputNodes.map((node) => {
                        const suggestion = wizardAnalysis?.suggestedMappings?.find(
                          (s) => s.nodeId === node.nodeId,
                        )
                        const mapped = wizMappings[node.nodeId] || ''
                        return (
                          <div key={node.nodeId} className="px-3 py-2 rounded bg-graphite-400/50 space-y-1.5">
                            {/* Row 1: Node info + mapping dropdown */}
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[10px] text-graphite-200 w-10">#{node.nodeId}</span>
                              <span className="text-xs text-graphite-050 w-32 truncate" title={node.title}>{node.title}</span>
                              <span className="text-graphite-300">→</span>
                              <Dropdown
                                options={[
                                  { value: '', label: '(leave as default)' },
                                  ...(STANDARD_INPUTS[wizPipeline] || []).map(opt => ({ value: opt, label: opt })),
                                ]}
                                value={mapped}
                                onChange={(v) => setWizMappings({ ...wizMappings, [node.nodeId]: v })}
                                className="flex-1"
                              />
                              {suggestion?.reason && (
                                <span className="text-[10px] text-graphite-200 max-w-32 truncate" title={suggestion.reason}>
                                  {suggestion.reason}
                                </span>
                              )}
                            </div>
                            {/* Row 2: Description + Default value (shown when mapped) */}
                            {mapped && (
                              <div className="flex items-center gap-2 ml-12">
                                <input
                                  type="text"
                                  placeholder="Description (e.g., Toggle between t2v/i2v)"
                                  value={wizDescriptions[node.nodeId] || ''}
                                  onChange={(e) => setWizDescriptions({ ...wizDescriptions, [node.nodeId]: e.target.value })}
                                  className="flex-1 px-2 py-1 text-[11px] rounded bg-graphite-300 border border-line-soft text-foreground placeholder:text-graphite-200 focus:outline-none focus:border-cyan/40"
                                />
                                <input
                                  type="text"
                                  placeholder="Default value"
                                  value={wizDefaults[node.nodeId] || ''}
                                  onChange={(e) => setWizDefaults({ ...wizDefaults, [node.nodeId]: e.target.value })}
                                  className="w-28 px-2 py-1 text-[11px] rounded bg-graphite-300 border border-line-soft text-foreground placeholder:text-graphite-200 focus:outline-none focus:border-cyan/40"
                                />
                              </div>
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

                {/* LoRA Keywords (optional) */}
                {wizardParsed?.loraNodes && wizardParsed.loraNodes.length > 0 && (
                  <div className="rounded-lg border border-line-soft p-3">
                    <div className="text-xs text-graphite-100 mb-2">
                      LoRA Trigger Keywords <span className="text-graphite-300">(optional — only if the LoRA needs activation words)</span>
                    </div>
                    <div className="text-[10px] text-graphite-200 mb-2">
                      Detected LoRAs: {wizardParsed.loraNodes.map(l => l.loraName || 'unknown').join(', ')}
                    </div>
                    <div className="space-y-2">
                      <div>
                        <label className="block text-[10px] text-graphite-200 mb-0.5">Prepend to prompt</label>
                        <input
                          value={wizKeywordsPrepend}
                          onChange={(e) => setWizKeywordsPrepend(e.target.value)}
                          placeholder="e.g., GHIBSKY style"
                          className="w-full px-2 py-1.5 rounded bg-graphite-300 border border-line-soft text-xs text-foreground placeholder:text-graphite-300"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-graphite-200 mb-0.5">Append to prompt</label>
                        <input
                          value={wizKeywordsAppend}
                          onChange={(e) => setWizKeywordsAppend(e.target.value)}
                          placeholder="e.g., in the style of ohwx"
                          className="w-full px-2 py-1.5 rounded bg-graphite-300 border border-line-soft text-xs text-foreground placeholder:text-graphite-300"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-graphite-200 mb-0.5">Append to negative prompt</label>
                        <input
                          value={wizKeywordsNegative}
                          onChange={(e) => setWizKeywordsNegative(e.target.value)}
                          placeholder="e.g., realistic, photograph"
                          className="w-full px-2 py-1.5 rounded bg-graphite-300 border border-line-soft text-xs text-foreground placeholder:text-graphite-300"
                        />
                      </div>
                    </div>
                  </div>
                )}

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

        {/* === TEST VIEW === */}
        {view === 'test' && testingWorkflow && (
          <div className="px-6 py-4">
            <WorkflowTester
              workflow={testingWorkflow}
              onClose={() => setTestingWorkflow(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
