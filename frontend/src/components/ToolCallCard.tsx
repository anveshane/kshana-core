import { useState } from 'react'
import type { ToolCall } from '../lib/store'
import { useAppState } from '../lib/store'

interface ToolCallCardProps {
  toolCall: ToolCall
}

const TOOL_NAMES: Record<string, string> = {
  generate_content: 'Writing',
  generate_image: 'Image Generation',
  generate_shot_image: 'Shot Image',
  generate_video: 'Video Generation',
  generate_shot_video: 'Shot Video',
  assemble_final_video: 'Final Assembly',
  think: 'Thinking',
  extract_collections: 'Extraction',
}

const TOOL_COLORS: Record<string, { border: string; statusActive: string; statusDone: string }> = {
  generate_content:     { border: 'border-cyan/20',         statusActive: 'text-cyan',       statusDone: 'text-green' },
  extract_collections:  { border: 'border-cyan/20',         statusActive: 'text-cyan',       statusDone: 'text-green' },
  generate_image:       { border: 'border-violet-400/25',   statusActive: 'text-violet-400', statusDone: 'text-green' },
  generate_shot_image:  { border: 'border-violet-400/25',   statusActive: 'text-violet-400', statusDone: 'text-green' },
  generate_shot_video:  { border: 'border-amber-400/25',    statusActive: 'text-amber-400',  statusDone: 'text-green' },
  generate_video:       { border: 'border-amber-400/25',    statusActive: 'text-amber-400',  statusDone: 'text-green' },
  assemble_final_video: { border: 'border-green/25',        statusActive: 'text-green',      statusDone: 'text-green' },
}

const DEFAULT_COLORS = { border: 'border-line-soft', statusActive: 'text-cyan', statusDone: 'text-green' }

/** Parse progress from streaming text like "Step 2/3 (67%)" */
function parseProgress(text: string): { step: number; total: number; percent: number } | null {
  const match = text.match(/(\d+)\s*\/\s*(\d+)\s*\((\d+)%\)/)
  if (match) return { step: parseInt(match[1]!), total: parseInt(match[2]!), percent: parseInt(match[3]!) }
  const pctMatch = text.match(/(\d+)%/)
  if (pctMatch) return { step: 0, total: 0, percent: parseInt(pctMatch[1]!) }
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
        <div className="h-full bg-cyan rounded-full transition-all duration-300" style={{ width: `${progress.percent}%` }} />
      </div>
    </div>
  )
}

function WorkflowBadge({ name }: { name: string }) {
  return (
    <span className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-cyan/10 text-cyan border border-cyan/20 font-mono">
      {name}
    </span>
  )
}

function ItemTitle({ item }: { item: string }) {
  const parts = item.match(/^(.+?):\s*(.+)$/)
  if (!parts) return <span className="text-sm font-medium text-foreground">{item}</span>
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] text-graphite-100 uppercase tracking-wider">{parts[1]}</span>
      <span className="text-sm font-medium text-foreground">{parts[2]}</span>
    </span>
  )
}

/** Content generation body — LLM writing (story, character, scene, etc.) */
function ContentBody({ args, streamingContent, status }: { args: Record<string, string>; streamingContent?: string; status: string }) {
  const [showPrompt, setShowPrompt] = useState(false)
  const item = args['item']
  const prompt = args['prompt']
  const skills = args['skills']

  return (
    <div className="px-3 py-2 space-y-1.5">
      {item && <ItemTitle item={item} />}
      {skills && (
        <div className="flex flex-wrap gap-1">
          {skills.split(',').map(s => (
            <span key={s.trim()} className="px-1 py-0.5 text-[9px] rounded bg-graphite-300 text-graphite-100">{s.trim()}</span>
          ))}
        </div>
      )}
      {prompt && (
        <button onClick={() => setShowPrompt(!showPrompt)} className="text-[10px] text-graphite-200 hover:text-graphite-100 cursor-pointer">
          {showPrompt ? 'Hide prompt' : 'Show prompt'}
        </button>
      )}
      {showPrompt && prompt && (
        <div className="p-2 rounded bg-graphite-300/50 border border-line-soft text-[11px] text-graphite-050 max-h-40 overflow-y-auto whitespace-pre-wrap">
          {prompt}
        </div>
      )}
      {status === 'executing' && streamingContent && (
        <div className="text-xs text-graphite-050 whitespace-pre-wrap max-h-32 overflow-y-auto">
          {streamingContent}
        </div>
      )}
    </div>
  )
}

/** Image generation body — character/setting images */
function ImageGenBody({ args }: { args: Record<string, string> }) {
  const item = args['item']
  const workflow = args['workflow']
  const prompt = args['prompt']

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        {item && <ItemTitle item={item} />}
        {workflow && <WorkflowBadge name={workflow} />}
      </div>
      {prompt && (
        <div className="p-2 rounded bg-graphite-300/50 border border-line-soft text-xs text-foreground leading-relaxed">
          {prompt}
        </div>
      )}
    </div>
  )
}

/** Shot image body — with reference thumbnails and mode */
function ShotImageBody({ args, selectedProject }: { args: Record<string, string>; selectedProject: string | null }) {
  const item = args['item']
  const workflow = args['workflow']
  const mode = args['mode']
  const prompt = args['prompt']
  const refs = Object.entries(args).filter(([k]) => k.startsWith('ref_'))

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        {item && <ItemTitle item={item} />}
        {workflow && <WorkflowBadge name={workflow} />}
        {mode && (
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-graphite-300 text-graphite-100 font-mono">
            {mode.replace('_', ' ')}
          </span>
        )}
      </div>
      {refs.length > 0 && selectedProject && (
        <div className="flex gap-2 flex-wrap">
          {refs.map(([key, val]) => (
            <div key={key} className="flex flex-col items-center gap-0.5">
              <img
                src={`/api/v1/assets/${selectedProject}/${val}`}
                alt={key}
                className="w-14 h-14 rounded object-cover border border-line-soft"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
              <span className="text-[9px] text-graphite-200">{key.replace(/^ref_\d+_/, '')}</span>
            </div>
          ))}
        </div>
      )}
      {prompt && (
        <div className="p-2 rounded bg-graphite-300/50 border border-line-soft text-xs text-foreground leading-relaxed">
          {prompt}
        </div>
      )}
    </div>
  )
}

/** Shot video body — workflow, source image, duration, prompt */
function ShotVideoBody({ args, selectedProject }: { args: Record<string, string>; selectedProject: string | null }) {
  const item = args['item']
  const workflow = args['workflow']
  const sourceImage = args['source_image']
  const duration = args['duration']
  const prompt = args['prompt']
  const isT2V = sourceImage === '(text-to-video)'

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        {item && <ItemTitle item={item} />}
        {workflow && <WorkflowBadge name={workflow} />}
        {duration && (
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-graphite-300 text-graphite-100 font-mono">{duration}s</span>
        )}
        {isT2V && (
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-500/10 text-amber-400 font-mono">t2v</span>
        )}
      </div>
      {!isT2V && sourceImage && selectedProject && (
        <div className="flex items-start gap-2">
          <img
            src={`/api/v1/assets/${selectedProject}/${sourceImage}`}
            alt="Source"
            className="w-20 h-20 rounded object-cover border border-line-soft flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          {prompt && (
            <div className="flex-1 p-2 rounded bg-graphite-300/50 border border-line-soft text-xs text-foreground leading-relaxed">
              {prompt}
            </div>
          )}
        </div>
      )}
      {(isT2V || !sourceImage) && prompt && (
        <div className="p-2 rounded bg-graphite-300/50 border border-line-soft text-xs text-foreground leading-relaxed">
          {prompt}
        </div>
      )}
    </div>
  )
}

/** Assembly body — just streaming text */
function AssemblyBody({ streamingContent }: { streamingContent?: string }) {
  return streamingContent ? (
    <div className="px-3 py-2 text-xs text-graphite-050 whitespace-pre-wrap font-mono">
      {streamingContent}
    </div>
  ) : null
}

/** Extraction body — show extracted items as badges */
function ExtractionBody({ args, result, status }: { args: Record<string, string>; result: unknown; status: string }) {
  const source = args['source']
  const resultObj = typeof result === 'object' && result !== null ? result as Record<string, unknown> : null

  return (
    <div className="px-3 py-2 space-y-1.5">
      {source && <span className="text-[11px] text-graphite-100">from {source}</span>}
      {status === 'completed' && resultObj && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(resultObj).filter(([, v]) => Array.isArray(v)).map(([key, values]) => (
            <div key={key} className="flex flex-wrap gap-1">
              <span className="text-[10px] text-graphite-200 uppercase mr-1">{key}:</span>
              {(values as unknown[]).map((v, i) => (
                <span key={i} className="px-1.5 py-0.5 text-[10px] rounded bg-cyan/10 text-cyan border border-cyan/20">
                  {String(v)}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Default args for unknown tool types */
function DefaultBody({ args, selectedProject }: { args: Record<string, string>; selectedProject: string | null }) {
  if (!args || Object.keys(args).length === 0) return null
  const workflow = args['workflow']
  const prompt = args['prompt']
  const otherArgs = Object.entries(args).filter(([k]) => k !== 'prompt' && k !== 'workflow')

  return (
    <div className="px-3 py-2 space-y-1.5">
      {workflow && <WorkflowBadge name={workflow} />}
      {prompt && (
        <div className="p-2 rounded bg-graphite-300/50 border border-line-soft text-xs text-foreground leading-relaxed">{prompt}</div>
      )}
      {otherArgs.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {otherArgs.map(([key, value]) => {
            const val = String(value)
            if (val.match(/\.(png|jpg|jpeg|webp)$/i) && selectedProject) {
              return (
                <div key={key} className="flex flex-col items-center gap-0.5">
                  <img src={`/api/v1/assets/${selectedProject}/${val}`} alt={key}
                    className="w-14 h-14 rounded object-cover border border-line-soft"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  <span className="text-graphite-100 text-[9px]">{key.replace(/^ref_\d+_/, '')}</span>
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
  const { toolName, status, streamingContent, result, args, startTime } = toolCall
  const displayName = TOOL_NAMES[toolName] || toolName.replace(/_/g, ' ')
  const elapsed = status === 'executing' ? Math.round((Date.now() - startTime) / 1000) : undefined
  const duration = toolCall.duration ? Math.round((toolCall.duration - startTime) / 1000) : undefined

  const colors = TOOL_COLORS[toolName] || DEFAULT_COLORS
  const statusColor = status === 'completed' ? colors.statusDone : status === 'error' ? 'text-error' : colors.statusActive
  const borderColor = status === 'error' ? 'border-error/20' : colors.border

  const resultObj = typeof result === 'object' && result !== null ? result as Record<string, unknown> : null
  const filePath = resultObj?.['file_path'] as string | undefined
  const isVideo = filePath?.match(/\.(mp4|webm|mov)$/i)
  const isImage = filePath?.match(/\.(png|jpg|jpeg|webp)$/i)

  // Progress detection
  const lastLine = streamingContent?.trim().split('\n').pop()?.trim() ?? ''
  const hasProgress = !!parseProgress(lastLine)

  // Filter redundant streaming lines
  const meaningfulContent = streamingContent
    ?.split('\n')
    .filter(line => {
      const trimmed = line.trim()
      if (!trimmed) return false
      if (status === 'completed') {
        if (trimmed.startsWith('Complete!')) return false
        if (trimmed.startsWith('Video saved to')) return false
        if (trimmed.startsWith('Image saved to')) return false
        if (trimmed.startsWith('Output:')) return false
        if (trimmed.match(/^\d+\/\d+\s*\(\d+%\)/)) return false
      }
      if (parseProgress(trimmed)) return false
      return true
    })
    .join('\n')
    .trim()

  // Per-type body renderer
  const renderBody = () => {
    switch (toolName) {
      case 'generate_content':
        return <ContentBody args={args ?? {}} streamingContent={meaningfulContent} status={status} />
      case 'generate_image':
        return <ImageGenBody args={args ?? {}} />
      case 'generate_shot_image':
        return <ShotImageBody args={args ?? {}} selectedProject={selectedProject} />
      case 'generate_shot_video':
      case 'generate_video':
        return <ShotVideoBody args={args ?? {}} selectedProject={selectedProject} />
      case 'assemble_final_video':
        return <AssemblyBody streamingContent={meaningfulContent} />
      case 'extract_collections':
        return <ExtractionBody args={args ?? {}} result={result} status={status} />
      default:
        return <DefaultBody args={args ?? {}} selectedProject={selectedProject} />
    }
  }

  // For content and assembly, streaming is handled in the body
  const showSeparateStreaming = toolName !== 'generate_content' && toolName !== 'assemble_final_video' && toolName !== 'extract_collections'

  return (
    <div className={`rounded-lg border ${borderColor} bg-graphite-400/50 overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-line-soft">
        <div className="flex items-center gap-2">
          <span className={`text-sm ${statusColor}`}>
            {status === 'executing' ? '◉' : status === 'completed' ? '✓' : '✗'}
          </span>
          <span className="font-mono text-xs text-foreground">{displayName}</span>
        </div>
        <span className="font-mono text-[10px] text-graphite-100">
          {elapsed !== undefined ? `${elapsed}s...` : duration !== undefined ? `${duration}s` : ''}
        </span>
      </div>

      {/* Per-type body */}
      {renderBody()}

      {/* Progress bar */}
      {status === 'executing' && hasProgress && (
        <ProgressBar text={lastLine} />
      )}

      {/* Streaming content (only for types not handled in body) */}
      {showSeparateStreaming && meaningfulContent && status !== 'completed' && (
        <div className="px-3 py-2 text-xs text-graphite-050 whitespace-pre-wrap max-h-32 overflow-y-auto">
          {meaningfulContent}
        </div>
      )}

      {/* Result */}
      {result && status !== 'executing' && (
        <div className="px-3 py-1.5 text-xs">
          {typeof result === 'string' ? (
            <div className="text-graphite-050 whitespace-pre-wrap">{result}</div>
          ) : resultObj?.['status'] === 'completed' && filePath ? (
            <div className="text-green/70 text-[10px] font-mono">{filePath}</div>
          ) : resultObj?.['status'] === 'completed' ? (
            <div className="text-green text-[11px]">Completed</div>
          ) : resultObj?.['error'] ? (
            <div className="text-error">{String(resultObj['error'])}</div>
          ) : toolName === 'extract_collections' ? null : (
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
              controls autoPlay loop muted
              className="w-full max-h-64 rounded-md"
            />
          ) : isImage ? (
            <img
              src={`/api/v1/assets/${selectedProject}/${filePath}`}
              alt="Generated"
              className="w-full max-h-64 rounded-md object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
