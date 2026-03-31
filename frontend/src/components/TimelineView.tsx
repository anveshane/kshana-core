import { useAppState } from '../lib/store'
import type { TimelineSegment, SegmentFillStatus } from '../lib/timeline-types'

const fillColors: Record<SegmentFillStatus, string> = {
  empty: 'bg-graphite-400 border-dashed border-graphite-200',
  planned: 'bg-graphite-300 border-solid border-graphite-100',
  filled: 'bg-cyan/20 border-solid border-cyan',
}

const fillLabels: Record<SegmentFillStatus, string> = {
  empty: 'Empty',
  planned: 'Planned',
  filled: 'Filled',
}

function TransitionBadge({ type }: { type: string }) {
  if (type === 'cut') return null
  const label = type.replace(/_/g, ' ')
  return (
    <span className="inline-block px-1 py-0.5 text-[9px] rounded bg-graphite-300 text-graphite-100 uppercase tracking-wide">
      {label}
    </span>
  )
}

function SegmentBlock({ segment, totalDuration }: { segment: TimelineSegment; totalDuration: number }) {
  const widthPercent = totalDuration > 0 ? (segment.duration / totalDuration) * 100 : 0
  const minWidth = 60 // px minimum so labels are readable

  return (
    <div
      className={`relative flex-shrink-0 rounded-md border p-2 flex flex-col gap-1 overflow-hidden ${fillColors[segment.fillStatus]}`}
      style={{ width: `max(${widthPercent}%, ${minWidth}px)` }}
      title={`${segment.label}\n${segment.duration}s (${segment.startTime}s - ${segment.endTime}s)\nStatus: ${segment.fillStatus}${segment.transition ? `\nTransition: ${segment.transition.type}` : ''}`}
    >
      <div className="text-[10px] font-medium text-foreground truncate">
        {segment.label}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[9px] text-graphite-100">
          {Math.round(segment.duration * 10) / 10}s
        </span>
        {segment.transition && segment.transition.type !== 'cut' && (
          <TransitionBadge type={segment.transition.type} />
        )}
      </div>
      {/* Fill status indicator */}
      <div className="text-[8px] uppercase tracking-widest text-graphite-100">
        {fillLabels[segment.fillStatus]}
      </div>
    </div>
  )
}

function TimeRuler({ totalDuration }: { totalDuration: number }) {
  const marks: number[] = []
  const interval = totalDuration <= 30 ? 5 : totalDuration <= 120 ? 10 : 30
  for (let t = 0; t <= totalDuration; t += interval) {
    marks.push(t)
  }

  return (
    <div className="flex justify-between text-[9px] text-graphite-200 px-1 mb-1">
      {marks.map(t => (
        <span key={t}>{t}s</span>
      ))}
    </div>
  )
}

export function TimelineView() {
  const { timeline } = useAppState()

  if (!timeline) {
    return (
      <div className="flex-1 flex items-center justify-center text-graphite-200 text-sm">
        No timeline yet — will populate as shots are generated
      </div>
    )
  }

  const { segments, totalDuration, validation } = timeline
  const filledCount = segments.filter(s => s.fillStatus === 'filled').length
  const progressPercent = totalDuration > 0 ? (validation.filledDuration / totalDuration) * 100 : 0

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">
          Timeline
          <span className="ml-2 text-graphite-100 text-xs">
            {segments.length} segments / {Math.round(totalDuration)}s
          </span>
        </h2>
        <div className="text-xs text-graphite-100">
          {filledCount}/{segments.length} filled
        </div>
      </div>

      {/* Time ruler */}
      <TimeRuler totalDuration={totalDuration} />

      {/* Segments row */}
      <div className="flex gap-1 overflow-x-auto pb-2">
        {segments.map(segment => (
          <SegmentBlock
            key={segment.id}
            segment={segment}
            totalDuration={totalDuration}
          />
        ))}
      </div>

      {/* Progress bar */}
      <div className="mt-auto">
        <div className="flex items-center justify-between text-[10px] text-graphite-100 mb-1">
          <span>Progress</span>
          <span>{Math.round(progressPercent)}% ({Math.round(validation.filledDuration)}s / {Math.round(totalDuration)}s)</span>
        </div>
        <div className="h-1.5 bg-graphite-400 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        {validation.warnings.length > 0 && (
          <div className="mt-2 text-[10px] text-warning">
            {validation.warnings.length} warning{validation.warnings.length > 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  )
}
