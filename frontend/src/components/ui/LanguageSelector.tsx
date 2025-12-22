import React, { useState } from 'react'

const LANGUAGES = [
  { code: 'pt', name: 'Português', flag: '🇧🇷' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
]

interface Props {
  value: string
  onChange: (code: string) => void
  label?: string
  disabled?: boolean
}

export function LanguageSelector({ value, onChange, label, disabled }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const selected = LANGUAGES.find(l => l.code === value) || LANGUAGES[0]

  return (
    <div className="relative">
      {label && <p className="label mb-2">{label}</p>}
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl transition-all disabled:opacity-50"
        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-secondary)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{selected.flag}</span>
          <span className="text-sm font-medium theme-text">{selected.name}</span>
        </div>
        <svg className={`w-4 h-4 theme-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute z-50 mt-2 w-full max-h-60 overflow-y-auto rounded-xl shadow-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-secondary)' }}>
            {LANGUAGES.map(lang => (
              <button
                key={lang.code}
                onClick={() => { onChange(lang.code); setIsOpen(false) }}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-cyan-500/10 ${value === lang.code ? 'bg-cyan-500/20 text-cyan-400' : 'theme-text'}`}
              >
                <span className="text-lg">{lang.flag}</span>
                <span className="text-sm">{lang.name}</span>
                {value === lang.code && (
                  <svg className="w-4 h-4 ml-auto text-cyan-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
