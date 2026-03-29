import { useState, useEffect } from 'react'

interface Template {
  id: string
  displayName: string
  description?: string
  styles: Array<{ id: string; displayName: string; description?: string }>
}

interface NewProjectInlineProps {
  onSubmit: (data: {
    templateId: string
    style: string
    duration: number
    content: string
  }) => void
  onCancel: () => void
}

export function NewProjectInline({ onSubmit, onCancel }: NewProjectInlineProps) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [step, setStep] = useState<'template' | 'style' | 'duration' | 'content'>('template')
  const [templateId, setTemplateId] = useState('')
  const [style, setStyle] = useState('')
  const [duration, setDuration] = useState(60)
  const [content, setContent] = useState('')

  useEffect(() => {
    fetch('/api/v1/templates')
      .then(r => r.json())
      .then(data => {
        setTemplates(data.templates || [])
      })
      .catch(() => {})
  }, [])

  const selectedTemplate = templates.find(t => t.id === templateId)

  const DURATIONS = [
    { value: 30, label: '30 seconds' },
    { value: 60, label: '1 minute' },
    { value: 120, label: '2 minutes' },
    { value: 180, label: '3 minutes' },
    { value: 300, label: '5 minutes' },
  ]

  return (
    <div className="mx-4 my-2">
      <div className="glass-panel p-4 max-w-xl">
        <div className="font-mono text-[10px] uppercase tracking-widest text-cyan mb-3">New Project</div>

        {/* Step 1: Template */}
        {step === 'template' && (
          <div>
            <div className="text-sm text-foreground mb-3">Choose a template:</div>
            <div className="grid gap-2">
              {templates.map(t => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTemplateId(t.id)
                    if (t.styles?.length > 0) {
                      setStep('style')
                    } else {
                      setStep('duration')
                    }
                  }}
                  className="text-left px-4 py-3 rounded-lg border border-line-soft hover:border-cyan/30 hover:bg-cyan/5 transition-colors cursor-pointer"
                >
                  <div className="text-sm font-medium text-foreground">{t.displayName}</div>
                  {t.description && <div className="text-xs text-graphite-100 mt-0.5">{t.description}</div>}
                </button>
              ))}
            </div>
            <button onClick={onCancel} className="mt-3 text-xs text-graphite-200 hover:text-foreground cursor-pointer">
              Cancel
            </button>
          </div>
        )}

        {/* Step 2: Style */}
        {step === 'style' && selectedTemplate && (
          <div>
            <div className="text-sm text-foreground mb-3">
              Choose a style for <span className="text-cyan">{selectedTemplate.displayName}</span>:
            </div>
            <div className="grid gap-2">
              {selectedTemplate.styles.map(s => (
                <button
                  key={s.id}
                  onClick={() => { setStyle(s.id); setStep('duration') }}
                  className="text-left px-4 py-3 rounded-lg border border-line-soft hover:border-cyan/30 hover:bg-cyan/5 transition-colors cursor-pointer"
                >
                  <div className="text-sm font-medium text-foreground">{s.displayName}</div>
                  {s.description && <div className="text-xs text-graphite-100 mt-0.5">{s.description}</div>}
                </button>
              ))}
            </div>
            <button onClick={() => setStep('template')} className="mt-3 text-xs text-graphite-200 hover:text-foreground cursor-pointer">
              ← Back
            </button>
          </div>
        )}

        {/* Step 3: Duration */}
        {step === 'duration' && (
          <div>
            <div className="text-sm text-foreground mb-3">Choose duration:</div>
            <div className="grid grid-cols-3 gap-2">
              {DURATIONS.map(d => (
                <button
                  key={d.value}
                  onClick={() => { setDuration(d.value); setStep('content') }}
                  className="text-center px-3 py-2.5 rounded-lg border border-line-soft hover:border-cyan/30 hover:bg-cyan/5 transition-colors cursor-pointer"
                >
                  <div className="text-sm text-foreground">{d.label}</div>
                </button>
              ))}
            </div>
            <button onClick={() => setStep(selectedTemplate?.styles?.length ? 'style' : 'template')} className="mt-3 text-xs text-graphite-200 hover:text-foreground cursor-pointer">
              ← Back
            </button>
          </div>
        )}

        {/* Step 4: Description */}
        {step === 'content' && (
          <div>
            <div className="text-sm text-foreground mb-1">Describe your project:</div>
            <div className="text-xs text-graphite-100 mb-3">
              {templateId} · {style || 'default'} · {duration}s
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              autoFocus
              placeholder="A noir detective story set in a rain-soaked cyberpunk city..."
              className="w-full px-3 py-2 rounded-md bg-graphite-300 border border-line-soft text-sm text-foreground resize-y focus:outline-none focus:border-cyan/40 placeholder:text-graphite-200"
            />
            <div className="flex justify-between items-center mt-3">
              <button onClick={() => setStep('duration')} className="text-xs text-graphite-200 hover:text-foreground cursor-pointer">
                ← Back
              </button>
              <button
                onClick={() => {
                  if (content.trim()) {
                    onSubmit({ templateId, style: style || 'cinematic_realism', duration, content })
                  }
                }}
                disabled={!content.trim()}
                className="px-4 py-2 rounded-md bg-cyan text-background font-mono text-xs font-semibold hover:bg-cyan/90 transition-colors disabled:opacity-40 cursor-pointer"
              >
                Create Project
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
