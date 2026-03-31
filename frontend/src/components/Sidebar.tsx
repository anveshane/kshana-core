import { useAppState } from '../lib/store'

interface SidebarProps {
  onRedoNode?: (nodeId: string) => void
}

export function Sidebar({ onRedoNode }: SidebarProps) {
  const { phase, todos, assets, selectedProject, agentStatus } = useAppState()
  const isBusy = agentStatus === 'thinking'

  return (
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
              {/* Redo button — shown on hover for completed/failed todos when not busy */}
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
        {assets.length === 0 ? (
          <span className="text-xs text-graphite-200">No assets</span>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {assets.filter(a => a.type === 'image' || a.url.match(/\.(png|jpg|jpeg|webp)$/i)).map((asset) => (
              <div
                key={asset.id}
                className="aspect-square rounded-md overflow-hidden border border-line-soft bg-graphite-400 cursor-pointer hover:border-line-strong transition-colors"
              >
                <img
                  src={selectedProject ? `/api/v1/assets/${selectedProject}/${asset.path}` : asset.url}
                  alt={asset.id}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  )
}
