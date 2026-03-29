import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppState, useAppDispatch } from '../lib/store'

interface ProjectInfo {
  dirName: string
  title: string
  templateId?: string
  currentPhase?: string
}

interface ProjectSelectorProps {
  onSendWs: (msg: Record<string, unknown>) => void
}

export function ProjectSelector({ onSendWs }: ProjectSelectorProps) {
  const { selectedProject } = useAppState()
  const dispatch = useAppDispatch()
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/projects')
      if (!res.ok) return
      const data = await res.json()
      const projs = (data.projects || []) as ProjectInfo[]
      setProjects(projs)
      dispatch({ type: 'SET_PROJECTS', projects: projs.map(p => ({ name: p.dirName, phase: p.currentPhase })) })
    } catch {
      // Server not reachable
    }
  }, [dispatch])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const handleSelect = (dirName: string) => {
    setOpen(false)
    dispatch({ type: 'SELECT_PROJECT', name: dirName })
    onSendWs({ type: 'select_project', data: { projectDir: dirName } })
    loadProjectAssets(dirName)
  }

  const loadProjectAssets = async (name: string) => {
    try {
      const res = await fetch(`/api/v1/projects/${name}/assets`)
      if (!res.ok) return
      const data = await res.json()
      const assets = (data.assets || []).map((a: { id: string; path: string; type: string }) => ({
        ...a,
        url: `/api/v1/assets/${name}/${a.path}`,
      }))
      dispatch({ type: 'SET_ASSETS', assets })
    } catch { /* */ }
  }

  const selectedTitle = projects.find(p => p.dirName === selectedProject)?.title

  return (
    <>
      <div ref={dropdownRef} className="relative">
        {/* Trigger button */}
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-line-soft bg-graphite-400/50 hover:border-line-strong transition-colors cursor-pointer min-w-40 max-w-56"
        >
          <span className="text-sm truncate text-foreground">
            {selectedTitle || selectedProject?.replace('.kshana', '') || 'Select Project...'}
          </span>
          <svg
            className={`w-3.5 h-3.5 text-graphite-100 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M3 4.5L6 7.5L9 4.5" />
          </svg>
        </button>

        {/* Dropdown menu */}
        {open && (
          <div className="absolute top-full left-0 mt-1.5 w-72 glass-panel-strong py-1 z-50 max-h-80 overflow-y-auto">
            {/* Project list */}
            {projects.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-graphite-200">
                No projects found
              </div>
            ) : (
              projects.map((p) => {
                const isSelected = p.dirName === selectedProject
                return (
                  <button
                    key={p.dirName}
                    onClick={() => handleSelect(p.dirName)}
                    className={`w-full text-left px-3 py-2.5 flex items-center justify-between hover:bg-surface transition-colors cursor-pointer ${
                      isSelected ? 'bg-cyan/5' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {isSelected && <span className="text-cyan text-xs">●</span>}
                        <span className={`text-sm truncate ${isSelected ? 'text-cyan' : 'text-foreground'}`}>
                          {p.title || p.dirName.replace('.kshana', '')}
                        </span>
                      </div>
                      {p.currentPhase && p.currentPhase !== 'unknown' && (
                        <span className="font-mono text-[10px] text-graphite-100 ml-4">
                          {p.currentPhase.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[10px] text-graphite-200 flex-shrink-0 ml-2">
                      {p.templateId || ''}
                    </span>
                  </button>
                )
              })
            )}

            {/* Divider + New Project */}
            <div className="border-t border-line-soft mt-1 pt-1">
              <button
                onClick={() => {
                  setOpen(false)
                  onSendWs({ type: 'create_project', data: {} })
                  dispatch({
                    type: 'ADD_CHAT_MESSAGE',
                    message: {
                      id: `sys_${Date.now()}`,
                      type: 'system',
                      content: 'Starting new project wizard...',
                      timestamp: Date.now(),
                    },
                  })
                }}
                className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-surface transition-colors cursor-pointer text-cyan"
              >
                <span className="text-sm">+</span>
                <span className="text-sm">New Project</span>
              </button>
            </div>
          </div>
        )}
      </div>

    </>
  )
}
