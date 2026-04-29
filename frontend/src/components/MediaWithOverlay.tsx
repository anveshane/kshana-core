import { useState } from 'react'

interface Props {
  /** Path relative to <project>.kshana/. URL is built as /api/v1/assets/<project>/<path>. */
  path: string
  /** Project name (no .kshana suffix). */
  project: string
  /** image | video — picks <img> vs <video controls>. */
  kind: 'image' | 'video'
  /** Wired to the same Edit & Redo modal the Storyboard uses. Receives the synthesized nodeId. */
  onEditPrompt?: (nodeId: string, frame: string | null) => void
  /** Triggers a redo of the underlying node. Receives the synthesized nodeId. */
  onRedoNode?: (nodeId: string) => void
  /** Optional max-height override; default 18rem (~288px). */
  maxHeight?: string
}

/**
 * The shot+frame embedded in a kshana-style filename:
 *   s<N>shot<M>_(first|last|mid)_frame_<provider>_<id>.png
 *   s<N>shot<M>_<provider>_<id>.mp4    (videos)
 * Returns null for paths that don't match (orphan/legacy entries) — overlay
 * still shows fullscreen but hides edit/redo since there's no node to operate on.
 */
function inferShotFromPath(path: string): { scene: number; shot: number; frame: 'first_frame' | 'last_frame' | 'mid_frame' | null; isVideo: boolean } | null {
  const file = path.split('/').pop() ?? path
  let m = /^s(\d+)shot(\d+)_(first_frame|last_frame|mid_frame)_/.exec(file)
  if (m) {
    return {
      scene: parseInt(m[1]!, 10),
      shot: parseInt(m[2]!, 10),
      frame: m[3] as 'first_frame' | 'last_frame' | 'mid_frame',
      isVideo: false,
    }
  }
  m = /^s(\d+)shot(\d+)_/.exec(file)
  if (m && /\.(mp4|webm|mov)$/i.test(file)) {
    return {
      scene: parseInt(m[1]!, 10),
      shot: parseInt(m[2]!, 10),
      frame: null,
      isVideo: true,
    }
  }
  return null
}

export function MediaWithOverlay({ path, project, kind, onEditPrompt, onRedoNode, maxHeight = 'max-h-72' }: Props) {
  const [fullscreen, setFullscreen] = useState(false)
  const url = `/api/v1/assets/${project}/${path}`
  const inferred = inferShotFromPath(path)

  const promptNodeId = inferred
    ? inferred.isVideo
      ? `shot_motion_directive:scene_${inferred.scene}_shot_${inferred.shot}`
      : `shot_image_prompt:scene_${inferred.scene}_shot_${inferred.shot}`
    : null
  const assetNodeId = inferred
    ? inferred.isVideo
      ? `shot_video:scene_${inferred.scene}_shot_${inferred.shot}`
      : `shot_image:scene_${inferred.scene}_shot_${inferred.shot}`
    : null

  return (
    <>
      <div className="relative group">
        {kind === 'video' ? (
          <video
            src={url}
            controls
            loop
            muted
            className={`w-full ${maxHeight} bg-black rounded-md`}
          />
        ) : (
          <img
            src={url}
            alt={path}
            className={`w-full ${maxHeight} object-contain rounded-md`}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
        <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {promptNodeId && onEditPrompt && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onEditPrompt(promptNodeId, inferred?.frame ?? null)
              }}
              className="px-2.5 py-1 rounded bg-cyan text-background hover:bg-cyan/90 text-[11px] font-medium shadow-lg"
              title={inferred?.isVideo ? 'Edit motion directive' : 'Edit image prompt'}
            >
              ✎ Edit
            </button>
          )}
          {assetNodeId && onRedoNode && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onRedoNode(assetNodeId)
              }}
              className="px-2.5 py-1 rounded bg-graphite-300 text-foreground hover:bg-graphite-200 text-[11px] font-medium shadow-lg border border-line-strong"
              title={inferred?.isVideo ? 'Regenerate video' : 'Regenerate image'}
            >
              ↻ Redo
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setFullscreen(true) }}
            className="px-2.5 py-1 rounded bg-graphite-300 text-foreground hover:bg-graphite-200 text-[11px] font-medium shadow-lg border border-line-strong"
            title="View full screen"
          >
            ⛶ Full
          </button>
        </div>
      </div>

      {fullscreen && (
        <div
          onClick={() => setFullscreen(false)}
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 cursor-pointer"
        >
          {kind === 'video' ? (
            <video src={url} controls autoPlay className="max-w-full max-h-full" onClick={(e) => e.stopPropagation()} />
          ) : (
            <img src={url} alt={path} className="max-w-full max-h-full object-contain" />
          )}
          <button
            onClick={() => setFullscreen(false)}
            className="absolute top-4 right-4 text-white text-3xl hover:text-graphite-100"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>
      )}
    </>
  )
}
