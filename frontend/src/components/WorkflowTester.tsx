import { useState, useCallback } from 'react'

interface WorkflowManifest {
  id: string
  displayName: string
  pipeline: string
  outputType: string
  inputRequirements: Array<{
    id: string
    type: string
    source: string
    description: string
    required: boolean
  }>
  parameterMappings: Array<{
    input: string
    nodeId: string
    field: string
  }>
}

interface WorkflowTesterProps {
  workflow: WorkflowManifest
  onClose: () => void
}

interface TestInput {
  id: string
  type: string
  value: string
  file?: File
  previewUrl?: string
}

const DEFAULT_VALUES: Record<string, string> = {
  prompt: 'A cinematic scene of a lone figure walking through morning fog, golden hour sunlight filtering through trees, volumetric light rays, photorealistic',
  negative_prompt: 'blurry, low quality, distorted, watermark, text, ugly, deformed',
  seed: String(Math.floor(Math.random() * 999999)),
  durationSeconds: '5',
  width: '848',
  height: '480',
  filenamePrefix: 'workflow_test',
}

export function WorkflowTester({ workflow, onClose }: WorkflowTesterProps) {
  // Build input fields from the workflow's requirements + mappings
  const allInputIds = new Set([
    ...workflow.inputRequirements.map(r => r.id),
    ...workflow.parameterMappings.map(m => m.input),
  ])

  const [inputs, setInputs] = useState<TestInput[]>(() =>
    Array.from(allInputIds).map(id => {
      const req = workflow.inputRequirements.find(r => r.id === id)
      const type = req?.type || (id.includes('image') || id.includes('frame') ? 'image' : 'text')
      return {
        id,
        type,
        value: DEFAULT_VALUES[id] || '',
      }
    })
  )

  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [progressMessage, setProgressMessage] = useState('')
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const updateInput = useCallback((id: string, value: string, file?: File, previewUrl?: string) => {
    setInputs(prev => prev.map(inp =>
      inp.id === id ? { ...inp, value, file, previewUrl } : inp
    ))
  }, [])

  const handleFileSelect = useCallback((id: string, file: File) => {
    const previewUrl = URL.createObjectURL(file)
    updateInput(id, file.name, file, previewUrl)
  }, [updateInput])

  const handleRun = async () => {
    setStatus('running')
    setProgress(0)
    setProgressMessage('Preparing...')
    setError(null)
    setResultUrl(null)

    try {
      // Upload any image files first
      const uploadedFiles: Record<string, string> = {}
      for (const inp of inputs) {
        if (inp.type === 'image' && inp.file) {
          setProgressMessage(`Uploading ${inp.id}...`)
          const formData = new FormData()
          formData.append('file', inp.file)
          const res = await fetch(`/api/v1/upload?filename=${encodeURIComponent(inp.file.name)}`, {
            method: 'POST',
            body: inp.file,
          })
          if (!res.ok) throw new Error(`Upload failed for ${inp.id}`)
          const data = await res.json()
          uploadedFiles[inp.id] = data.path
        }
      }

      // Build params for the test
      const params: Record<string, string> = {}
      for (const inp of inputs) {
        if (inp.type === 'image') {
          params[inp.id] = uploadedFiles[inp.id] || inp.value
        } else {
          params[inp.id] = inp.value
        }
      }

      setProgressMessage('Queueing workflow...')
      setProgress(10)

      // Call the test endpoint
      const res = await fetch('/api/v1/workflows/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: workflow.id,
          params,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(errData.error || `HTTP ${res.status}`)
      }

      // Poll for progress
      const data = await res.json()
      const promptId = data.promptId

      if (data.status === 'completed' && data.outputPath) {
        setProgress(100)
        setProgressMessage('Done!')
        setResultUrl(data.outputUrl || data.outputPath)
        setStatus('done')
        return
      }

      // Poll completion
      setProgressMessage('Generating...')
      let attempts = 0
      const maxAttempts = 120 // 2 minutes at 1s intervals
      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000))
        attempts++
        setProgress(Math.min(10 + (attempts / maxAttempts) * 85, 95))

        const pollRes = await fetch(`/api/v1/workflows/test/${promptId}/status`)
        if (!pollRes.ok) continue
        const pollData = await pollRes.json()

        if (pollData.message) setProgressMessage(pollData.message)
        if (pollData.percentage) setProgress(pollData.percentage)

        if (pollData.status === 'completed') {
          setProgress(100)
          setProgressMessage('Done!')
          setResultUrl(pollData.outputUrl || pollData.outputPath)
          setStatus('done')
          return
        }
        if (pollData.status === 'error') {
          throw new Error(pollData.error || 'Generation failed')
        }
      }

      throw new Error('Timed out waiting for result')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const isVideo = workflow.outputType === 'video'

  return (
    <div className="border-t border-line-soft mt-4 pt-4">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Test: {workflow.displayName}
        </h4>
        <button
          onClick={onClose}
          className="text-xs text-graphite-200 hover:text-foreground cursor-pointer"
        >
          ← Back to list
        </button>
      </div>

      {/* Input fields */}
      <div className="space-y-3 mb-4">
        {inputs.map(inp => (
          <div key={inp.id}>
            <label className="block text-xs text-graphite-100 mb-1">
              {inp.id}
              <span className="text-graphite-300 ml-1">({inp.type})</span>
            </label>

            {inp.type === 'image' ? (
              <div className="flex items-center gap-3">
                <label className="flex-1 flex items-center justify-center px-4 py-6 rounded-lg border-2 border-dashed border-line-soft hover:border-cyan/30 cursor-pointer transition-colors bg-graphite-400/30">
                  {inp.previewUrl ? (
                    <img src={inp.previewUrl} alt="" className="max-h-24 rounded" />
                  ) : (
                    <span className="text-xs text-graphite-200">
                      Click to select image or drag & drop
                    </span>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleFileSelect(inp.id, file)
                    }}
                  />
                </label>
                {inp.previewUrl && (
                  <button
                    onClick={() => updateInput(inp.id, '', undefined, undefined)}
                    className="text-xs text-graphite-200 hover:text-error cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>
            ) : inp.type === 'number' ? (
              <input
                type="number"
                value={inp.value}
                onChange={(e) => updateInput(inp.id, e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-graphite-300 border border-line-soft text-sm text-foreground focus:outline-none focus:border-cyan/40"
              />
            ) : (
              <textarea
                value={inp.value}
                onChange={(e) => updateInput(inp.id, e.target.value)}
                rows={inp.id.includes('prompt') ? 3 : 1}
                className="w-full px-3 py-2 rounded-md bg-graphite-300 border border-line-soft text-sm text-foreground resize-y focus:outline-none focus:border-cyan/40"
              />
            )}
          </div>
        ))}
      </div>

      {/* Run button + progress */}
      <div className="space-y-3">
        {status === 'idle' && (
          <button
            onClick={handleRun}
            className="w-full px-4 py-2.5 rounded-md bg-cyan text-background font-mono text-sm font-semibold hover:bg-cyan/90 transition-colors cursor-pointer"
          >
            Run Test
          </button>
        )}

        {status === 'running' && (
          <div>
            <div className="flex items-center justify-between text-xs text-graphite-100 mb-1">
              <span>{progressMessage}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-graphite-300 overflow-hidden">
              <div
                className="h-full rounded-full bg-cyan transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="px-4 py-3 rounded-lg border border-error/30 bg-error/5">
            <div className="text-sm text-error mb-2">Test failed</div>
            <div className="text-xs text-graphite-100">{error}</div>
            <button
              onClick={() => setStatus('idle')}
              className="mt-2 text-xs text-graphite-200 hover:text-foreground cursor-pointer"
            >
              Try again
            </button>
          </div>
        )}

        {status === 'done' && resultUrl && (
          <div className="rounded-lg border border-green/20 bg-green/5 overflow-hidden">
            <div className="px-4 py-2 text-xs text-green font-mono">Test completed</div>
            {isVideo ? (
              <video
                src={resultUrl}
                controls
                autoPlay
                loop
                muted
                className="w-full max-h-80"
              />
            ) : (
              <img
                src={resultUrl}
                alt="Test result"
                className="w-full max-h-80 object-contain"
              />
            )}
            <div className="px-4 py-2 flex justify-between">
              <button
                onClick={() => { setStatus('idle'); setResultUrl(null) }}
                className="text-xs text-graphite-200 hover:text-foreground cursor-pointer"
              >
                Run again
              </button>
              <a
                href={resultUrl}
                download
                className="text-xs text-cyan hover:text-cyan/80"
              >
                Download
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
