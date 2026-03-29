import { useState, useRef, useEffect } from 'react'

interface DropdownOption {
  value: string
  label: string
  description?: string
}

interface DropdownProps {
  options: DropdownOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function Dropdown({ options, value, onChange, placeholder = 'Select...', className = '' }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.value === value)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-md bg-graphite-300 border border-line-soft text-sm text-foreground hover:border-line-strong transition-colors cursor-pointer text-left"
      >
        <span className={selected ? 'text-foreground' : 'text-graphite-200'}>
          {selected?.label || placeholder}
        </span>
        <svg
          className={`w-3.5 h-3.5 text-graphite-100 transition-transform flex-shrink-0 ml-2 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 glass-panel-strong py-1 z-50 max-h-56 overflow-y-auto">
          {options.map((opt) => {
            const isSelected = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false) }}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-surface transition-colors cursor-pointer ${
                  isSelected ? 'bg-cyan/5 text-cyan' : 'text-foreground'
                }`}
              >
                <span className="w-4 flex-shrink-0 text-xs">
                  {isSelected ? '●' : ''}
                </span>
                <div className="min-w-0">
                  <div className="text-sm truncate">{opt.label}</div>
                  {opt.description && (
                    <div className="text-[10px] text-graphite-100 truncate">{opt.description}</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
