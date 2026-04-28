/**
 * Visual card for shot composition (shot_image_prompt) output.
 * Renders frame prompts, references, generation mode, and strategy.
 */

import { useState } from 'react'

interface FrameData {
  imagePrompt?: string
  generationMode?: string
  references?: Array<{ imageNumber: number; type: string; refId: string }>
}

interface ShotPrompt {
  shotNumber?: number
  generationStrategy?: string
  frames?: {
    first_frame?: FrameData
    mid_frame?: FrameData
    last_frame?: FrameData
  }
  // Single-frame format
  imagePrompt?: string
  generationMode?: string
  references?: Array<{ imageNumber: number; type: string; refId: string }>
  negativePrompt?: string
  aspectRatio?: string
}

const MODE_COLORS: Record<string, string> = {
  image_text_to_image: 'bg-green-500/20 text-green-300',
  edit_previous_shot: 'bg-blue-500/20 text-blue-300',
  edit_first_frame: 'bg-purple-500/20 text-purple-300',
  text_to_image: 'bg-amber-500/20 text-amber-300',
}

const MODE_LABELS: Record<string, string> = {
  image_text_to_image: 'Fresh + Refs',
  edit_previous_shot: 'Edit Prev Shot',
  edit_first_frame: 'Edit First Frame',
  text_to_image: 'Text Only',
}

function ModeBadge({ mode }: { mode: string }) {
  const color = MODE_COLORS[mode] ?? 'bg-graphite-300 text-graphite-100'
  const label = MODE_LABELS[mode] ?? mode.replace(/_/g, ' ')
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${color}`}>
      {label}
    </span>
  )
}

function RefChip({ ref }: { ref: { imageNumber: number; type: string; refId: string } }) {
  const typeColors: Record<string, string> = {
    character: 'text-green-300',
    setting: 'text-blue-300',
    object: 'text-amber-300',
  }
  const label = ref.refId.split(':')[1] ?? ref.refId
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-graphite-300/50 text-[9px]">
      <span className="font-mono text-graphite-200">#{ref.imageNumber}</span>
      <span className={typeColors[ref.type] ?? 'text-graphite-100'}>{label}</span>
    </span>
  )
}

function FrameSection({ label, frame, defaultOpen }: { label: string; frame: FrameData; defaultOpen?: boolean }) {
  const [expanded, setExpanded] = useState(defaultOpen ?? false)

  return (
    <div className="border-b border-line-soft last:border-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-surface/50 transition-colors cursor-pointer"
      >
        <span className="text-[10px] text-graphite-200 transition-transform" style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}>
          ▸
        </span>
        <span className="text-[10px] font-semibold text-foreground uppercase tracking-wider">{label}</span>
        {frame.generationMode && <ModeBadge mode={frame.generationMode} />}
        {frame.references && frame.references.length > 0 && (
          <span className="text-[9px] text-graphite-200">{frame.references.length} refs</span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-2 pl-7 space-y-1.5">
          {/* Image prompt */}
          {frame.imagePrompt && (
            <p className="text-[11px] text-foreground leading-relaxed">
              {frame.imagePrompt}
            </p>
          )}
          {/* References */}
          {frame.references && frame.references.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {frame.references.map(r => <RefChip key={r.imageNumber} ref={r} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ShotCompositionCard({ content }: { content: string }) {
  let prompt: ShotPrompt | null = null
  try {
    let cleaned = content.trim()
    if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    prompt = JSON.parse(cleaned)
  } catch {
    return (
      <div className="px-3 py-2 text-[11px] text-graphite-200">
        <pre className="p-2 rounded bg-graphite-300/50 border border-line-soft text-[10px] max-h-48 overflow-auto font-mono">
          {content}
        </pre>
      </div>
    )
  }

  if (!prompt) return null

  const isMultiFrame = !!prompt.frames
  const strategy = prompt.generationStrategy

  return (
    <div className="space-y-0">
      {/* Header row */}
      <div className="px-3 py-1.5 flex items-center gap-2 border-b border-line-soft">
        {prompt.shotNumber && (
          <span className="text-[10px] font-mono text-graphite-200">Shot {prompt.shotNumber}</span>
        )}
        {strategy && (
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${strategy === 'fmlfv' ? 'bg-fuchsia-500/20 text-fuchsia-300' : 'bg-cyan-500/20 text-cyan-300'}`}>
            {strategy.toUpperCase()}
          </span>
        )}
        {prompt.aspectRatio && (
          <span className="text-[9px] text-graphite-200">{prompt.aspectRatio}</span>
        )}
        {prompt.negativePrompt && (
          <span className="text-[9px] text-graphite-200 truncate max-w-[200px]" title={prompt.negativePrompt}>
            neg: {prompt.negativePrompt.substring(0, 40)}...
          </span>
        )}
      </div>

      {/* Multi-frame format */}
      {isMultiFrame && prompt.frames && (
        <>
          {prompt.frames.first_frame && (
            <FrameSection label="First Frame" frame={prompt.frames.first_frame} defaultOpen={true} />
          )}
          {prompt.frames.mid_frame && (
            <FrameSection label="Mid Frame" frame={prompt.frames.mid_frame} />
          )}
          {prompt.frames.last_frame && (
            <FrameSection label="Last Frame" frame={prompt.frames.last_frame} />
          )}
        </>
      )}

      {/* Single-frame format */}
      {!isMultiFrame && prompt.imagePrompt && (
        <div className="px-3 py-2 space-y-1.5">
          {prompt.generationMode && <ModeBadge mode={prompt.generationMode} />}
          <p className="text-[11px] text-foreground leading-relaxed">{prompt.imagePrompt}</p>
          {prompt.references && prompt.references.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {prompt.references.map(r => <RefChip key={r.imageNumber} ref={r} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Visual card for scene state (before/target).
 * Shows character positions, expressions, hands — not raw JSON.
 */
export function SceneStateCard({ content }: { content: string }) {
  // The content is already formatted text from formatStateForPrompt
  // Parse it into structured sections
  const lines = content.split('\n').filter(l => l.trim())
  const sections: Array<{ title: string; entries: string[] }> = []
  let currentSection: { title: string; entries: string[] } | null = null

  for (const line of lines) {
    if (line.startsWith('CURRENT SCENE STATE') || line.startsWith('PREVIOUS STATE') || line.startsWith('TARGET STATE') || line.startsWith('CHANGES:')) {
      if (currentSection) sections.push(currentSection)
      currentSection = { title: line.replace(/[:(].*/, '').trim(), entries: [] }
    } else if (line.startsWith('▶') || line.startsWith('◀') || line.startsWith('△') || line.startsWith('+') || line.startsWith('☀') || line.startsWith('⏱')) {
      // Diff entries
      if (currentSection) currentSection.entries.push(line)
    } else if (line.startsWith('  ') || line.startsWith('- ')) {
      // State entries
      if (currentSection) currentSection.entries.push(line.trim())
    } else if (line.match(/^[A-Z]/)) {
      // Section header like "Characters:", "Environment:"
      if (currentSection) sections.push(currentSection)
      currentSection = { title: line.replace(':', ''), entries: [] }
    } else {
      if (currentSection) currentSection.entries.push(line.trim())
    }
  }
  if (currentSection) sections.push(currentSection)

  if (sections.length === 0) {
    return <div className="px-3 py-2 text-[11px] text-graphite-200 whitespace-pre-wrap">{content}</div>
  }

  return (
    <div className="space-y-0">
      {sections.map((section, i) => (
        <div key={i} className="border-b border-line-soft last:border-0">
          <div className="px-3 py-1 text-[10px] font-semibold text-foreground uppercase tracking-wider bg-graphite-350/30">
            {section.title}
          </div>
          {section.entries.length > 0 && (
            <div className="px-3 py-1 space-y-0.5">
              {section.entries.map((entry, j) => {
                // Diff entries with symbols
                if (entry.startsWith('▶')) {
                  return <div key={j} className="text-[10px] text-green-400">{entry}</div>
                }
                if (entry.startsWith('◀')) {
                  return <div key={j} className="text-[10px] text-red-400">{entry}</div>
                }
                if (entry.startsWith('△')) {
                  return <div key={j} className="text-[10px] text-amber-400">{entry}</div>
                }
                // Regular state entries
                return <div key={j} className="text-[10px] text-graphite-100">{entry}</div>
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
