import { useState } from 'react'
import { useAppState } from '../lib/store'
import { PromptEditModal } from './PromptEditModal'

interface SidebarProps {
  onRedoNode?: (nodeId: string) => void
  onRedoNodeWithPrompt?: (nodeId: string, editedPrompt: Record<string, unknown>) => void
}



/** Extract a short label from asset path */
function assetLabel(path: string): string {
  const parts = path.split('/')
  const filename = parts[parts.length - 1] || path
  return filename.replace(/\.\w+$/, '').replace(/_/g, ' ')
}

export function Sidebar({ onRedoNode, onRedoNodeWithPrompt }: SidebarProps) {
  const { phase, todos, assets, selectedProject, agentStatus } = useAppState()
  const isBusy = agentStatus === 'thinking'
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [confirmRedo, setConfirmRedo] = useState<string | null>(null)
  const [editNodeId, setEditNodeId] = useState<string | null>(null)

  const imageAssets = assets.filter(
    a => a.type === 'image' || a.url.match(/\.(png|jpg|jpeg|webp)$/i)
  )


  function getImageUrl(asset: typeof assets[0]): string {
    return selectedProject ? `/api/v1/assets/${selectedProject}/${asset.path}` : asset.url
  }

  function handleRedoClick(nodeId: string) {
    setConfirmRedo(nodeId)
  }

  function handleConfirmRedo() {
    if (confirmRedo && onRedoNode) {
      onRedoNode(confirmRedo)
    }
    setConfirmRedo(null)
  }

  return (
    <>
      <aside className="w-60 flex-shrink-0 flex flex-col gap-4 p-3 overflow-y-auto border-r border-line-soft">
        {/* Phase */}
        <section>
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-graphite-100 mb-2">
            Phase
          </h3>
          <div className="px-3 py-2 rounded-md bg-surface text-sm text-cyan">
            {phase ? phase.replace(/_/g, ' ') : '-'}
          </div>
        </section>

        {/* Todos */}
        <section>
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-graphite-100 mb-2">
            Todos
          </h3>
          <div className="flex flex-col gap-1">
            {todos.length === 0 && (
              <span className="text-xs text-graphite-200">No tasks</span>
            )}
            {todos.map((todo) => (
              <div key={todo.id} className="group flex items-start gap-2 text-xs">
                <span className="mt-0.5 flex-shrink-0">
                  {todo.status === 'completed' ? (
                    <span className="text-green">✓</span>
                  ) : todo.status === 'in_progress' ? (
                    <span className="text-cyan">◉</span>
                  ) : todo.status === 'failed' ? (
                    <span className="text-error">✗</span>
                  ) : (
                    <span className="text-graphite-200">○</span>
                  )}
                </span>
                <span className={`flex-1 ${todo.status === 'completed' ? 'text-graphite-100' : 'text-foreground'}`}>
                  {todo.text}
                </span>
                {(todo.status === 'completed' || todo.status === 'failed') && onRedoNode && !isBusy && (
                  <button
                    onClick={() => onRedoNode(todo.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5 text-graphite-100 hover:text-cyan"
                    title={`Redo ${todo.text}`}
                  >
                    ↻
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Assets */}
        <section>
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-graphite-100 mb-2">
            Assets
          </h3>
          {imageAssets.length === 0 ? (
            <span className="text-xs text-graphite-200">No assets</span>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {imageAssets.map((asset) => {
                const nodeId = asset.nodeId ?? null
                const url = getImageUrl(asset)
                return (
                  <div
                    key={asset.id}
                    className="group relative aspect-square rounded-md overflow-hidden border border-line-soft bg-graphite-400 cursor-pointer hover:border-line-strong transition-colors"
                  >
                    <img
                      src={url}
                      alt={assetLabel(asset.path)}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        const container = (e.target as HTMLImageElement).parentElement
                        if (container) container.style.display = 'none'
                      }}
                    />
                    {/* Label */}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-[9px] text-graphite-50 truncate">
                      {assetLabel(asset.path)}
                    </div>
                    {/* Hover overlay with zoom + redo buttons */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        onClick={() => setLightboxUrl(url)}
                        className="p-1.5 rounded bg-black/70 text-white hover:bg-black/90 text-sm"
                        title="View full size"
                      >
                        🔍
                      </button>
                      {nodeId && (
                        <>
                          {onRedoNodeWithPrompt && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditNodeId(nodeId) }}
                              className="p-1.5 rounded bg-black/70 text-white hover:bg-cyan/80 text-sm"
                              title="Edit prompt & redo"
                            >
                              ✏
                            </button>
                          )}
                          {onRedoNode && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRedoClick(nodeId) }}
                              className="p-1.5 rounded bg-black/70 text-white hover:bg-error/80 text-sm"
                              title={`Redo ${nodeId}`}
                            >
                              ↻
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </aside>

      {/* Lightbox modal */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-pointer"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt="Full size preview"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white text-2xl hover:text-graphite-100"
            onClick={() => setLightboxUrl(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Prompt Edit modal */}
      {editNodeId && selectedProject && onRedoNodeWithPrompt && (
        <PromptEditModal
          nodeId={editNodeId}
          projectName={selectedProject}
          onSubmit={(nid, edited) => {
            onRedoNodeWithPrompt(nid, edited)
            setEditNodeId(null)
          }}
          onCancel={() => setEditNodeId(null)}
        />
      )}

      {/* Redo confirmation dialog */}
      {confirmRedo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setConfirmRedo(null)}
        >
          <div
            className="bg-surface border border-line-soft rounded-lg p-5 max-w-sm shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground mb-2">Redo this image?</h3>
            <p className="text-xs text-graphite-100 mb-4">
              This will regenerate <span className="text-cyan">{confirmRedo}</span> and all downstream assets that depend on it (shot images, videos, etc).
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmRedo(null)}
                className="px-3 py-1.5 text-xs rounded border border-line-soft text-graphite-100 hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRedo}
                className="px-3 py-1.5 text-xs rounded bg-error text-white hover:bg-error/80"
              >
                Redo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
