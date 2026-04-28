import { useState, useEffect, useCallback } from 'react'
import { Dropdown } from './Dropdown'

interface ProviderOption {
  id: string
  name: string
  available: boolean
}

interface ProviderData {
  providers: {
    imageGeneration: ProviderOption[]
    imageEditing: ProviderOption[]
    videoGeneration: ProviderOption[]
  }
  currentConfig: {
    imageGeneration: string
    imageEditing: string
    videoGeneration: string
  }
}

interface ProviderSettingsProps {
  open: boolean
  onClose: () => void
}

export function ProviderSettings({ open, onClose }: ProviderSettingsProps) {
  const [data, setData] = useState<ProviderData | null>(null)
  const [imageGen, setImageGen] = useState('')
  const [imageEdit, setImageEdit] = useState('')
  const [videoGen, setVideoGen] = useState('')
  const [saving, setSaving] = useState(false)

  const loadProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/providers')
      const d = await res.json()
      setData(d)
      setImageGen(d.currentConfig.imageGeneration)
      setImageEdit(d.currentConfig.imageEditing)
      setVideoGen(d.currentConfig.videoGeneration)
    } catch { /* */ }
  }, [])

  useEffect(() => {
    if (open) loadProviders()
  }, [open, loadProviders])

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch('/api/v1/providers/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageGeneration: imageGen,
          imageEditing: imageEdit,
          videoGeneration: videoGen,
        }),
      })
      onClose()
    } catch { /* */ }
    setSaving(false)
  }

  if (!open) return null

  const toOptions = (providers: ProviderOption[]) =>
    providers.filter(p => p.available).map(p => ({ value: p.id, label: p.name }))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="glass-panel-strong w-full max-w-md mx-4 p-6">
        <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold mb-5">
          Provider Settings
        </h2>

        {data ? (
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-graphite-100 mb-1">Image Generation</label>
              <Dropdown options={toOptions(data.providers.imageGeneration)} value={imageGen} onChange={setImageGen} />
            </div>
            <div>
              <label className="block text-xs text-graphite-100 mb-1">Image Editing</label>
              <Dropdown options={toOptions(data.providers.imageEditing)} value={imageEdit} onChange={setImageEdit} />
            </div>
            <div>
              <label className="block text-xs text-graphite-100 mb-1">Video Generation</label>
              <Dropdown options={toOptions(data.providers.videoGeneration)} value={videoGen} onChange={setVideoGen} />
            </div>
          </div>
        ) : (
          <div className="text-center text-graphite-100 py-4">Loading providers...</div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md border border-line-soft text-graphite-100 hover:text-foreground transition-colors font-mono text-xs cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-md bg-cyan text-background font-mono text-xs font-semibold hover:bg-cyan/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
