import type { ToolCall } from '../lib/store'
import { useAppState } from '../lib/store'

interface ToolCallCardProps {
  toolCall: ToolCall
}

const TOOL_NAMES: Record<string, string> = {
  generate_content: 'Generating content',
  generate_image: 'Generating image',
  generate_shot_image: 'Generating shot image',
  generate_video: 'Generating video',
  generate_shot_video: 'Generating shot video',
  assemble_final_video: 'Assembling final video',
  think: 'Thinking',
  extract_collections: 'Extracting collections',
}

/** Parse progress from streaming text like "Step 2/3 (67%)" or "Sampling 5/10 (50%)" */
function parseProgress(text: string): { step: number; total: number; percent: number } | null {
  // Match patterns like "Step 2/3 (67%)" or "2/10 (20%)"
  const match = text.match(/(\d+)\s*\/\s*(\d+)\s*\((\d+)%\)/)
  if (match) {
    return { step: parseInt(match[1]!), total: parseInt(match[2]!), percent: parseInt(match[3]!) }
  }
  // Match just percentage like "67%"
  const pctMatch = text.match(/(\d+)%/)
  if (pctMatch) {
    return { step: 0, total: 0, percent: parseInt(pctMatch[1]!) }
  }
  return null
}

function ProgressBar({ text }: { text: string }) {
  const progress = parseProgress(text)
  if (!progress) return null

  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between text-[10px] text-graphite-100 mb-1">
        <span>{progress.step && progress.total ? `Step ${progress.step}/${progress.total}` : 'Processing'}</span>
        <span>{progress.percent}%</span>
      </div>
      <div className="h-1.5 bg-graphite-400 rounded-full overflow-hidden">
        <div
          className="h-full bg-cyan rounded-full transition-all duration-300"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  )
}

function ArgsSection({ args, selectedProject }: { args: Record<string, string>; selectedProject: string | null }) {
  if (!args || Object.keys(args).length === 0) return null

  // Separate prompt from other args for prominent display
  const prompt = args['prompt']
  const workflow = args['workflow']
  const otherArgs = Object.entries(args).filter(([k]) => k !== 'prompt' && k !== 'workflow')

  return (
    <div className="px-3 py-2 border-b border-line-soft">
      {/* Workflow badge */}
      {workflow && (
        <div className="mb-1.5">
          <span className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-cyan/10 text-cyan border border-cyan/20 font-mono">
            {workflow}
          </span>
        </div>
      )}

      {/* Prompt — full display, highlighted */}
      {prompt && (
        <div className="mb-2 p-2 rounded bg-graphite-300/50 border border-line-soft text-xs text-foreground leading-relaxed">
          {prompt}
        </div>
      )}

      {/* Other args — compact */}
      {otherArgs.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {otherArgs.map(([key, value]) => {
            const val = String(value)
            if (val.match(/\.(png|jpg|jpeg|webp)$/i) && selectedProject) {
              return (
                <div key={key} className="flex flex-col items-center gap-1">
                  <img
                    src={`/api/v1/assets/${selectedProject}/${val}`}
                    alt={key}
                    className="w-16 h-16 rounded object-cover border border-line-soft"
                  />
                  <span className="text-graphite-100 text-[10px]">{key.replace(/^ref_\d+_/, '')}</span>
                </div>
              )
            }
            return (
              <span key={key} className="text-graphite-100">
                <span className="font-semibold">{key}:</span> {val.substring(0, 60)}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const { selectedProject } = useAppState()
  const { toolName, status, streamingContent, result, args, agentName, startTime } = toolCall
  const displayName = TOOL_NAMES[toolName] || toolName.replace(/_/g, ' ')
  const elapsed = status === 'executing' ? Math.round((Date.now() - startTime) / 1000) : undefined
  const duration = toolCall.duration ? Math.round((toolCall.duration - startTime) / 1000) : undefined

  const statusColor = status === 'completed' ? 'text-green' : status === 'error' ? 'text-error' : 'text-cyan'
  const borderColor = status === 'completed' ? 'border-green/20' : status === 'error' ? 'border-error/20' : 'border-cyan/20'

  const resultObj = typeof result === 'object' && result !== null ? result as Record<string, unknown> : null
  const filePath = resultObj?.['file_path'] as string | undefined
  const isVideo = filePath?.match(/\.(mp4|webm|mov)$/i)
  const isImage = filePath?.match(/\.(png|jpg|jpeg|webp)$/i)

  // Check if streaming content is just a progress indicator
  const lastLine = streamingContent?.trim().split('\n').pop()?.trim() ?? ''
  const hasProgress = !!parseProgress(lastLine)

  // Filter out redundant streaming lines (Complete!, Video saved to, etc.)
  const meaningfulContent = streamingContent
    ?.split('\n')
    .filter(line => {
      const trimmed = line.trim()
      if (!trimmed) return false
      // Skip redundant completion messages when we have a result
      if (status === 'completed') {
        if (trimmed.startsWith('Complete!')) return false
        if (trimmed.startsWith('Video saved to')) return false
        if (trimmed.startsWith('Output:')) return false
        if (trimmed.match(/^\d+\/\d+\s*\(\d+%\)/)) return false // bare progress
      }
      // Skip progress lines (rendered as bar instead)
      if (parseProgress(trimmed)) return false
      return true
    })
    .join('\n')
    .trim()

  return (
    <div className={`rounded-lg border ${borderColor} bg-graphite-400/50 overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-line-soft">
        <div className="flex items-center gap-2">
          <span className={`text-sm ${statusColor}`}>
            {status === 'executing' ? '◉' : status === 'completed' ? '✓' : '✗'}
          </span>
          <span className="font-mono text-xs text-foreground">{displayName}</span>
          {agentName && (
            <span className="font-mono text-[10px] text-graphite-100">[{agentName}]</span>
          )}
        </div>
        <span className="font-mono text-[10px] text-graphite-100">
          {elapsed !== undefined ? `${elapsed}s...` : duration !== undefined ? `${duration}s` : ''}
        </span>
      </div>

      {/* Args — prompt is highlighted, workflow shown as badge */}
      <ArgsSection args={args ?? {}} selectedProject={selectedProject} />

      {/* Progress bar — shown during execution when progress is detected */}
      {status === 'executing' && hasProgress && (
        <ProgressBar text={lastLine} />
      )}

      {/* Streaming content — only meaningful lines, no progress/redundant text */}
      {meaningfulContent && (
        <div className="px-3 py-2 text-xs text-graphite-050 whitespace-pre-wrap max-h-40 overflow-y-auto">
          {meaningfulContent}
        </div>
      )}

      {/* Result — compact, no redundancy with file path */}
      {result && status !== 'executing' && (
        <div className="px-3 py-2 text-xs">
          {typeof result === 'string' ? (
            <div className="text-graphite-050 whitespace-pre-wrap">{result}</div>
          ) : resultObj?.['status'] === 'completed' && filePath ? (
            <div className="text-green text-[11px]">{filePath}</div>
          ) : resultObj?.['status'] === 'completed' ? (
            <div className="text-green">Completed</div>
          ) : resultObj?.['error'] ? (
            <div className="text-error">{String(resultObj['error'])}</div>
          ) : (
            <div className="text-graphite-100">{JSON.stringify(result, null, 2)}</div>
          )}
        </div>
      )}

      {/* Media preview */}
      {filePath && selectedProject && status === 'completed' && (
        <div className="px-3 py-2 border-t border-line-soft">
          {isVideo ? (
            <video
              src={`/api/v1/assets/${selectedProject}/${filePath}`}
              controls
              autoPlay
              loop
              muted
              className="w-full max-h-64 rounded-md"
            />
          ) : isImage ? (
            <img
              src={`/api/v1/assets/${selectedProject}/${filePath}`}
              alt="Generated"
              className="w-full max-h-64 rounded-md object-contain"
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
