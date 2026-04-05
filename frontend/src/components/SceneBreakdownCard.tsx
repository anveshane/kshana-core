/**
 * Visual card for scene breakdown (scene_video_prompt) output.
 * Renders shots as a visual timeline with purpose badges, shotType, duration, audio, transitions.
 */

import { useState } from 'react'

interface Shot {
  shotNumber: number
  purpose?: string
  secondaryPurpose?: string | null
  shotType?: string
  duration?: number
  description?: string
  cameraWork?: string
  audio?: string
  transition?: string
}

const PURPOSE_COLORS: Record<string, string> = {
  set_the_world: 'bg-blue-500/20 text-blue-300',
  set_the_mood: 'bg-purple-500/20 text-purple-300',
  meet_character: 'bg-green-500/20 text-green-300',
  show_tension: 'bg-red-500/20 text-red-300',
  show_action: 'bg-orange-500/20 text-orange-300',
  show_reaction: 'bg-yellow-500/20 text-yellow-300',
  show_dialogue: 'bg-cyan-500/20 text-cyan-300',
  show_clue: 'bg-amber-500/20 text-amber-300',
  show_passage: 'bg-indigo-500/20 text-indigo-300',
  hold_emotion: 'bg-pink-500/20 text-pink-300',
  show_change: 'bg-fuchsia-500/20 text-fuchsia-300',
  punctuate: 'bg-rose-500/20 text-rose-300',
}

const SHOT_TYPE_LABELS: Record<string, string> = {
  extreme_wide: 'XW',
  wide: 'W',
  medium: 'M',
  close_up: 'CU',
  extreme_close_up: 'XCU',
  over_shoulder: 'OTS',
  pov: 'POV',
  tracking: 'TRK',
  insert: 'INS',
  reaction: 'RXN',
}

function PurposeBadge({ purpose }: { purpose: string }) {
  const color = PURPOSE_COLORS[purpose] ?? 'bg-graphite-300 text-graphite-100'
  const label = purpose.replace(/_/g, ' ')
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide ${color}`}>
      {label}
    </span>
  )
}

function TransitionBadge({ transition }: { transition: string }) {
  if (transition === 'cut') return null // Most common, don't clutter
  return (
    <span className="px-1 py-0.5 rounded text-[8px] bg-graphite-300/50 text-graphite-150 italic">
      {transition.replace(/_/g, ' ')}
    </span>
  )
}

export function SceneBreakdownCard({ content }: { content: string }) {
  const [expandedShot, setExpandedShot] = useState<number | null>(null)

  let shots: Shot[] = []
  try {
    let cleaned = content.trim()
    if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    const parsed = JSON.parse(cleaned)
    shots = parsed.shots ?? (Array.isArray(parsed) ? parsed : [])
  } catch {
    return (
      <div className="px-3 py-2 text-[11px] text-graphite-200">
        <pre className="p-2 rounded bg-graphite-300/50 border border-line-soft text-[10px] max-h-48 overflow-auto font-mono">
          {content}
        </pre>
      </div>
    )
  }

  if (shots.length === 0) return null

  const totalDuration = shots.reduce((sum, s) => sum + (s.duration ?? 0), 0)

  return (
    <div className="space-y-0">
      {/* Duration bar */}
      <div className="px-3 py-1.5 flex items-center gap-2 border-b border-line-soft">
        <span className="text-[10px] text-graphite-200">{shots.length} shots</span>
        <span className="text-[10px] text-graphite-200">·</span>
        <span className="text-[10px] text-graphite-200">{totalDuration}s total</span>
        <div className="flex-1 h-1 rounded-full bg-graphite-350 overflow-hidden flex">
          {shots.map((shot) => (
            <div
              key={shot.shotNumber}
              className="h-full bg-cyan/40 border-r border-graphite-400 last:border-0 hover:bg-cyan/60 transition-colors cursor-pointer"
              style={{ width: `${((shot.duration ?? 5) / totalDuration) * 100}%` }}
              title={`Shot ${shot.shotNumber}: ${shot.duration}s`}
              onClick={() => setExpandedShot(expandedShot === shot.shotNumber ? null : shot.shotNumber)}
            />
          ))}
        </div>
      </div>

      {/* Shot list */}
      {shots.map((shot) => {
        const isExpanded = expandedShot === shot.shotNumber
        return (
          <div
            key={shot.shotNumber}
            className={`border-b border-line-soft last:border-0 ${isExpanded ? 'bg-surface/30' : ''}`}
          >
            {/* Shot header row */}
            <button
              onClick={() => setExpandedShot(isExpanded ? null : shot.shotNumber)}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-surface/50 transition-colors cursor-pointer"
            >
              {/* Shot number */}
              <span className="text-[10px] font-mono text-graphite-200 w-4 shrink-0">{shot.shotNumber}</span>

              {/* Purpose badge */}
              {shot.purpose && <PurposeBadge purpose={shot.purpose} />}
              {shot.secondaryPurpose && <PurposeBadge purpose={shot.secondaryPurpose} />}

              {/* Shot type */}
              {shot.shotType && (
                <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-graphite-300 text-graphite-100">
                  {SHOT_TYPE_LABELS[shot.shotType] ?? shot.shotType}
                </span>
              )}

              {/* Description (truncated) */}
              <span className="text-[11px] text-foreground truncate flex-1">
                {shot.description}
              </span>

              {/* Duration */}
              <span className="text-[10px] text-graphite-200 shrink-0">{shot.duration}s</span>

              {/* Transition */}
              {shot.transition && <TransitionBadge transition={shot.transition} />}

              {/* Expand indicator */}
              <span className="text-[10px] text-graphite-200 transition-transform" style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }}>
                ▸
              </span>
            </button>

            {/* Expanded details */}
            {isExpanded && (
              <div className="px-3 pb-2 pl-9 space-y-1">
                {shot.description && (
                  <p className="text-[11px] text-foreground">{shot.description}</p>
                )}
                {shot.cameraWork && (
                  <div className="flex items-start gap-1.5">
                    <span className="text-[9px] text-graphite-200 uppercase tracking-wider shrink-0 mt-0.5">Camera</span>
                    <span className="text-[11px] text-graphite-100">{shot.cameraWork}</span>
                  </div>
                )}
                {shot.audio && (
                  <div className="flex items-start gap-1.5">
                    <span className="text-[9px] text-graphite-200 uppercase tracking-wider shrink-0 mt-0.5">Audio</span>
                    <span className="text-[11px] text-graphite-100 italic">{shot.audio}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
