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
  const [showCreate, setShowCreate] = useState(false)
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
                onClick={() => { setOpen(false); setShowCreate(true) }}
                className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-surface transition-colors cursor-pointer text-cyan"
              >
                <span className="text-sm">+</span>
                <span className="text-sm">New Project</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={(name) => {
            setShowCreate(false)
            loadProjects()
            handleSelect(name)
          }}
          onSendWs={onSendWs}
        />
      )}
    </>
  )
}

// ── Create Project Modal ──────────────────────────────────

interface Template {
  id: string
  name: string
  styles: Array<{ id: string; name: string }>
}

interface CreateProjectModalProps {
  onClose: () => void
  onCreated: (name: string) => void
  onSendWs: (msg: Record<string, unknown>) => void
}

function CreateProjectModal({ onClose, onCreated, onSendWs }: CreateProjectModalProps) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateId, setTemplateId] = useState('narrative')
  const [style, setStyle] = useState('cinematic_realism')
  const [duration, setDuration] = useState(60)
  const [content, setContent] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch('/api/v1/templates')
      .then(r => r.json())
      .then(data => {
        setTemplates(data.templates || [])
        if (data.templates?.length > 0) {
          setTemplateId(data.templates[0].id)
          if (data.templates[0].styles?.length > 0) {
            setStyle(data.templates[0].styles[0].id)
          }
        }
      })
      .catch(() => {})
  }, [])

  const selectedTemplate = templates.find(t => t.id === templateId)

  const handleCreate = async () => {
    if (!content.trim()) return
    setCreating(true)
    onSendWs({
      type: 'create_project',
      data: {
        templateId,
        style,
        duration,
        content,
        resolution: '480p',
        resolutionWidth: 848,
        resolutionHeight: 480,
        autonomousMode: true,
      },
    })
    setTimeout(() => {
      setCreating(false)
      onCreated(content.substring(0, 30).replace(/\s+/g, '_'))
    }, 2000)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="glass-panel-strong w-full max-w-lg mx-4 p-6">
        <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold mb-5">
          New Project
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-graphite-100 mb-1">Template</label>
            <select
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value)
                const t = templates.find(t => t.id === e.target.value)
                if (t?.styles?.[0]) setStyle(t.styles[0].id)
              }}
              className="w-full px-3 py-2 rounded-md bg-graphite-300 border border-line-soft text-sm text-foreground"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {selectedTemplate?.styles && selectedTemplate.styles.length > 0 && (
            <div>
              <label className="block text-xs text-graphite-100 mb-1">Style</label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-graphite-300 border border-line-soft text-sm text-foreground"
              >
                {selectedTemplate.styles.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs text-graphite-100 mb-1">Duration (seconds)</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value) || 60)}
              min={15}
              max={600}
              className="w-full px-3 py-2 rounded-md bg-graphite-300 border border-line-soft text-sm text-foreground"
            />
          </div>

          <div>
            <label className="block text-xs text-graphite-100 mb-1">Project Description</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              placeholder="Describe your video project..."
              className="w-full px-3 py-2 rounded-md bg-graphite-300 border border-line-soft text-sm text-foreground resize-y focus:outline-none focus:border-cyan/40"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md border border-line-soft text-graphite-100 hover:text-foreground transition-colors font-mono text-xs cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !content.trim()}
            className="px-4 py-2 rounded-md bg-cyan text-background font-mono text-xs font-semibold hover:bg-cyan/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {creating ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  )
}
