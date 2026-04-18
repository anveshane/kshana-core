import { useState, useEffect } from 'react'

interface Reference {
  imageNumber: number
  type: string
  refId: string
}

interface AvailableRef {
  nodeId: string
  type: string
  name: string
  thumbnailUrl: string
  isCurrentlyUsed?: boolean
  currentImageNumber?: number
}

interface PromptData {
  nodeId: string
  nodeType: string
  prompt: Record<string, any>
  availableReferences?: AvailableRef[]
  firstFrameUrl?: string
}

interface Props {
  nodeId: string
  /**
   * Which frame is being edited (first_frame | mid_frame | last_frame).
   * Modal pre-populates + writes back to this frame's fields. When undefined
   * or the prompt has no frames, falls back to the root prompt fields.
   */
  frame?: string
  projectName: string
  onSubmit: (nodeId: string, editedPrompt: Record<string, unknown>) => void
  onCancel: () => void
}

export function PromptEditModal({ nodeId, frame, projectName, onSubmit, onCancel }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<PromptData | null>(null)

  // Editable fields
  const [imagePrompt, setImagePrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [motionDirective, setMotionDirective] = useState('')
  const [selectedRefs, setSelectedRefs] = useState<Array<{ nodeId: string; type: string; name: string }>>([])

  useEffect(() => {
    fetch(`/api/v1/projects/${projectName}/node-prompt/${encodeURIComponent(nodeId)}`)
      .then(res => res.json())
      .then((d: PromptData) => {
        setData(d)

        if (d.nodeType === 'shot_video') {
          setMotionDirective(d.prompt.motionDirective || '')
        } else {
          // Shot image or character/setting/object image
          const prompt = d.prompt
          // Pick the target frame: the one requested (last/mid), else first.
          const targetFrameKey = (frame && prompt.frames?.[frame])
            ? frame
            : (prompt.frames?.first_frame ? 'first_frame' : null)
          if (targetFrameKey) {
            setImagePrompt(prompt.frames[targetFrameKey].imagePrompt || '')
          } else {
            setImagePrompt(prompt.imagePrompt || '')
          }
          setNegativePrompt(prompt.negativePrompt || '')

          // Set current references (from the selected frame, falling back to root)
          const refs = (targetFrameKey ? prompt.frames[targetFrameKey].references : null)
            || prompt.references
            || []
          if (d.availableReferences) {
            const current = refs.map((r: Reference) => {
              const avail = d.availableReferences!.find(a => a.nodeId === r.refId)
              return avail ? { nodeId: avail.nodeId, type: avail.type, name: avail.name } : null
            }).filter(Boolean) as typeof selectedRefs
            setSelectedRefs(current)
          }
        }

        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [nodeId, projectName, frame])

  function handleSubmit() {
    if (!data) return

    if (data.nodeType === 'shot_video') {
      onSubmit(nodeId, { motionDirective })
      return
    }

    // Build the edited prompt
    const refs: Reference[] = selectedRefs.map((r, i) => ({
      imageNumber: i + 1,
      type: r.type,
      refId: r.nodeId,
    }))

    const hasFrames = data.prompt.frames
    if (hasFrames) {
      // Write back to the frame the user was editing. Fall back to first_frame
      // when no specific frame was requested.
      const targetFrameKey = (frame && data.prompt.frames[frame]) ? frame : 'first_frame'
      onSubmit(nodeId, {
        ...data.prompt,
        negativePrompt,
        frames: {
          ...data.prompt.frames,
          [targetFrameKey]: {
            ...data.prompt.frames[targetFrameKey],
            imagePrompt,
            references: refs,
          },
        },
      })
    } else {
      onSubmit(nodeId, {
        imagePrompt,
        negativePrompt,
        generationMode: refs.length > 0 ? 'image_text_to_image' : 'text_to_image',
        references: refs,
      })
    }
  }

  function toggleRef(ref: AvailableRef) {
    setSelectedRefs(prev => {
      const exists = prev.find(r => r.nodeId === ref.nodeId)
      if (exists) {
        return prev.filter(r => r.nodeId !== ref.nodeId)
      }
      return [...prev, { nodeId: ref.nodeId, type: ref.type, name: ref.name }]
    })
  }

  function moveRef(idx: number, dir: -1 | 1) {
    setSelectedRefs(prev => {
      const arr = [...prev]
      const newIdx = idx + dir
      if (newIdx < 0 || newIdx >= arr.length) return prev
      ;[arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]]
      return arr
    })
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="bg-surface rounded-lg p-8 text-foreground">Loading prompt...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
        <div className="bg-surface rounded-lg p-6 text-error" onClick={e => e.stopPropagation()}>
          <p>Failed to load prompt: {error}</p>
          <button onClick={onCancel} className="mt-3 px-3 py-1 bg-graphite-300 rounded text-sm">Close</button>
        </div>
      </div>
    )
  }

  const isVideo = data.nodeType === 'shot_video'
  const isShotImage = data.nodeType === 'shot_image'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="bg-surface border border-line-soft rounded-lg p-5 max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">
            Edit & Redo: <span className="text-cyan">{nodeId}</span>
            {frame && data.prompt.frames?.[frame] && (
              <span className="ml-2 text-[10px] uppercase tracking-widest bg-cyan/20 text-cyan px-2 py-0.5 rounded">
                {frame.replace('_', ' ')}
              </span>
            )}
          </h3>
          <button onClick={onCancel} className="text-graphite-100 hover:text-foreground text-lg">✕</button>
        </div>

        {/* Variant C: Shot Video */}
        {isVideo && (
          <>
            {data.firstFrameUrl && (
              <div className="mb-3">
                <label className="text-[10px] uppercase tracking-widest text-graphite-100 mb-1 block">First Frame</label>
                <img src={data.firstFrameUrl} alt="First frame" className="w-48 rounded border border-line-soft" />
              </div>
            )}
            <div className="mb-3">
              <label className="text-[10px] uppercase tracking-widest text-graphite-100 mb-1 block">Motion Directive</label>
              <textarea
                value={motionDirective}
                onChange={e => setMotionDirective(e.target.value)}
                rows={4}
                className="w-full bg-graphite-400 border border-line-soft rounded p-2 text-xs text-foreground font-mono resize-y"
              />
              <p className="text-[10px] text-graphite-200 mt-1">
                Describe what MOVES — subject, action, camera, atmosphere. 30-60 words.
              </p>
            </div>
          </>
        )}

        {/* Variant A & B: Image prompts */}
        {!isVideo && (
          <>
            <div className="mb-3">
              <label className="text-[10px] uppercase tracking-widest text-graphite-100 mb-1 block">Image Prompt</label>
              <textarea
                value={imagePrompt}
                onChange={e => setImagePrompt(e.target.value)}
                rows={5}
                className="w-full bg-graphite-400 border border-line-soft rounded p-2 text-xs text-foreground font-mono resize-y"
              />
            </div>

            <div className="mb-3">
              <label className="text-[10px] uppercase tracking-widest text-graphite-100 mb-1 block">Negative Prompt</label>
              <textarea
                value={negativePrompt}
                onChange={e => setNegativePrompt(e.target.value)}
                rows={2}
                className="w-full bg-graphite-400 border border-line-soft rounded p-2 text-xs text-foreground font-mono resize-y"
              />
            </div>

            {/* Variant B: Reference picker for shot images */}
            {isShotImage && data.availableReferences && data.availableReferences.length > 0 && (
              <div className="mb-3">
                <label className="text-[10px] uppercase tracking-widest text-graphite-100 mb-2 block">
                  References — click to select, use arrows to reorder
                </label>

                {/* Selected references with image numbers */}
                {selectedRefs.length > 0 && (
                  <div className="flex gap-2 mb-2 flex-wrap">
                    {selectedRefs.map((ref, idx) => (
                      <div key={ref.nodeId} className="flex items-center gap-1 bg-cyan/10 border border-cyan/30 rounded px-2 py-1 text-[10px]">
                        <span className="text-cyan font-bold">image {idx + 1}</span>
                        <span className="text-graphite-100">{ref.name}</span>
                        <button onClick={() => moveRef(idx, -1)} className="text-graphite-200 hover:text-foreground" title="Move up">◀</button>
                        <button onClick={() => moveRef(idx, 1)} className="text-graphite-200 hover:text-foreground" title="Move down">▶</button>
                        <button onClick={() => toggleRef({ nodeId: ref.nodeId, type: ref.type, name: ref.name, thumbnailUrl: '' })} className="text-error hover:text-error/80 ml-1" title="Remove">✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Available references grid */}
                <div className="grid grid-cols-4 gap-1.5">
                  {data.availableReferences.map(ref => {
                    const isSelected = selectedRefs.some(r => r.nodeId === ref.nodeId)
                    const imageNum = isSelected ? selectedRefs.findIndex(r => r.nodeId === ref.nodeId) + 1 : null
                    return (
                      <div
                        key={ref.nodeId}
                        onClick={() => toggleRef(ref)}
                        className={`relative aspect-square rounded cursor-pointer border-2 transition-colors overflow-hidden ${
                          isSelected ? 'border-cyan' : 'border-line-soft hover:border-line-strong'
                        }`}
                      >
                        <img src={ref.thumbnailUrl} alt={ref.name} className="w-full h-full object-cover" />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-[8px] text-white truncate">
                          {ref.type}: {ref.name}
                        </div>
                        {imageNum && (
                          <div className="absolute top-0.5 left-0.5 bg-cyan text-black text-[9px] font-bold px-1 rounded">
                            {imageNum}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* Actions */}
        <div className="flex gap-2 justify-end mt-4 pt-3 border-t border-line-soft">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs rounded border border-line-soft text-graphite-100 hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-1.5 text-xs rounded bg-cyan text-black font-medium hover:bg-cyan/80"
          >
            Regenerate
          </button>
        </div>
      </div>
    </div>
  )
}
