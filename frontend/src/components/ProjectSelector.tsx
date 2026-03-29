import { useState, useEffect, useCallback } from 'react'
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
  const [showCreate, setShowCreate] = useState(false)

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/projects')
      if (!res.ok) return
      const data = await res.json()
      const projs = (data.projects || []) as ProjectInfo[]
      setProjects(projs)
      dispatch({ type: 'SET_PROJECTS', projects: projs.map(p => ({ name: p.dirName, phase: p.currentPhase })) })
    } catch {
      // Server not reachable — non-fatal
    }
  }, [dispatch])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const handleSelect = (name: string) => {
    dispatch({ type: 'SELECT_PROJECT', name })
    onSendWs({
      type: 'select_project',
      data: { projectDir: name },
    })
    // Load project assets
    loadProjectAssets(name)
  }

  const loadProjectAssets = async (name: string) => {
    try {
      const res = await fetch(`/api/v1/projects/${name}/assets`)
      const data = await res.json()
      const assets = (data.assets || []).map((a: { id: string; path: string; type: string }) => ({
        ...a,
        url: `/api/v1/assets/${name}/${a.path}`,
      }))
      dispatch({ type: 'SET_ASSETS', assets })
    } catch {
      // Failed
    }
  }

  return (
    <>
      <select
        value={selectedProject || ''}
        onChange={(e) => {
          if (e.target.value === '__new') {
            setShowCreate(true)
          } else if (e.target.value) {
            handleSelect(e.target.value)
          }
        }}
        className="bg-graphite-300 border border-line-soft rounded-md px-2 py-1 text-sm text-foreground focus:outline-none focus:border-cyan/40 max-w-48"
      >
        <option value="">Select Project...</option>
        {projects.map((p) => (
          <option key={p.dirName} value={p.dirName}>
            {p.title || p.dirName.replace('.kshana', '')}
            {p.currentPhase ? ` (${p.currentPhase})` : ''}
          </option>
        ))}
        <option value="__new">+ New Project</option>
      </select>

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
    // The server will respond with a project name
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
          {/* Template */}
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

          {/* Style */}
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

          {/* Duration */}
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

          {/* Content */}
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
