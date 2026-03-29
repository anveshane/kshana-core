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
}

function ArgsSection({ args, selectedProject }: { args: Record<string, string>; selectedProject: string | null }) {
  if (!args || Object.keys(args).length === 0) return null

  return (
    <div className="px-3 py-2 border-b border-line-soft">
      <div className="flex flex-wrap gap-2 text-xs">
        {Object.entries(args).map(([key, value]) => {
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
          if (key === 'prompt') {
            return (
              <div key={key} className="w-full text-graphite-050 text-xs mt-1 line-clamp-2">
                {val}
              </div>
            )
          }
          return (
            <span key={key} className="text-graphite-100">
              <span className="font-semibold">{key}:</span> {val.substring(0, 50)}
            </span>
          )
        })}
      </div>
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
  const filePath = resultObj?.file_path as string | undefined
  const isVideo = filePath?.match(/\.(mp4|webm|mov)$/i)
  const isImage = filePath?.match(/\.(png|jpg|jpeg|webp)$/i)

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

      {/* Args */}
      <ArgsSection args={args ?? {}} selectedProject={selectedProject} />

      {/* Streaming content */}
      {streamingContent && (
        <div className="px-3 py-2 text-xs text-graphite-050 whitespace-pre-wrap max-h-40 overflow-y-auto">
          {streamingContent}
        </div>
      )}

      {/* Result */}
      {result && status !== 'executing' && (
        <div className="px-3 py-2 text-xs">
          {typeof result === 'string' ? (
            <div className="text-graphite-050 whitespace-pre-wrap">{result}</div>
          ) : resultObj?.status === 'completed' ? (
            <div className="text-green">
              {filePath ? `Output: ${filePath}` : 'Completed'}
            </div>
          ) : resultObj?.error ? (
            <div className="text-error">{String(resultObj.error)}</div>
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
