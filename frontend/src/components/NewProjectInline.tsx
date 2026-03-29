import { useState, useEffect } from 'react'

interface Template {
  id: string
  displayName: string
  description?: string
  styles: Array<{ id: string; displayName: string; description?: string }>
}

export interface NewProjectState {
  templateId: string
  style: string
  duration: number
}

interface NewProjectInlineProps {
  /** Called when template/style/duration are all selected — waiting for user to type description in chat */
  onReady: (state: NewProjectState) => void
  onCancel: () => void
  onStepChange: (step: string, value: string) => void
}

export function NewProjectInline({ onReady, onCancel, onStepChange }: NewProjectInlineProps) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [step, setStep] = useState<'template' | 'style' | 'duration'>('template')
  const [templateId, setTemplateId] = useState('')
  const [style, setStyle] = useState('')

  useEffect(() => {
    fetch('/api/v1/templates')
      .then(r => r.json())
      .then(data => setTemplates(data.templates || []))
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
                    onStepChange('template', t.displayName)
                    if (t.styles?.length > 0) {
                      setStep('style')
                    } else {
                      setStep('duration')
                    }
                  }}
                  className="text-left rounded-lg border border-line-soft hover:border-cyan/30 hover:bg-cyan/5 transition-colors cursor-pointer overflow-hidden flex"
                >
                  <img
                    src={`/previews/template_${t.id}.png`}
                    alt=""
                    className="w-28 h-20 object-cover flex-shrink-0 bg-graphite-400"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  <div className="px-4 py-3">
                    <div className="text-sm font-medium text-foreground">{t.displayName}</div>
                    {t.description && <div className="text-xs text-graphite-100 mt-0.5">{t.description}</div>}
                  </div>
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
            <div className="grid grid-cols-2 gap-2">
              {selectedTemplate.styles.map(s => (
                <button
                  key={s.id}
                  onClick={() => {
                    setStyle(s.id)
                    onStepChange('style', s.displayName)
                    setStep('duration')
                  }}
                  className="text-left rounded-lg border border-line-soft hover:border-cyan/30 hover:bg-cyan/5 transition-colors cursor-pointer overflow-hidden"
                >
                  <img
                    src={`/previews/style_${s.id}.png`}
                    alt=""
                    className="w-full h-24 object-cover bg-graphite-400"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                  <div className="px-3 py-2">
                    <div className="text-sm font-medium text-foreground">{s.displayName}</div>
                    {s.description && <div className="text-xs text-graphite-100 mt-0.5 line-clamp-2">{s.description}</div>}
                  </div>
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
                  onClick={() => {
                    onStepChange('duration', d.label)
                    // All selections done — signal ready, waiting for user to type description
                    onReady({ templateId, style: style || 'cinematic_realism', duration: d.value })
                  }}
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
      </div>
    </div>
  )
}
