import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, Search, Globe } from 'lucide-react'
import type { Language } from '../services/api'

interface Props {
  languages: Language[]
  selected: string   // language code or 'auto'
  onChange: (code: string) => void
  disabled?: boolean
}

const LanguageSelector: React.FC<Props> = ({ languages, selected, onChange, disabled }) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selectedLang = selected === 'auto'
    ? null
    : languages.find((l) => l.code === selected)

  const filtered = query
    ? languages.filter((l) =>
        l.name.toLowerCase().includes(query.toLowerCase()) ||
        l.nativeName.toLowerCase().includes(query.toLowerCase()) ||
        l.code.toLowerCase().includes(query.toLowerCase())
      )
    : languages

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = (code: string) => {
    onChange(code); setOpen(false); setQuery('')
  }

  return (
    <div ref={ref} className="relative">
      <button
        id="language-selector-btn"
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={`
          w-full flex items-center justify-between gap-3 px-4 py-3
          bg-white border rounded-xl transition-all duration-200
          ${open ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-slate-300 hover:border-slate-400'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Globe className="w-4 h-4 text-slate-400 flex-shrink-0" />
          {selected === 'auto' ? (
            <span className="text-slate-700 font-medium">Auto-detect language</span>
          ) : selectedLang ? (
            <span className="text-slate-900 font-medium truncate">
              {selectedLang.name}
              <span className="ml-1.5 text-slate-400 text-sm font-normal">{selectedLang.nativeName}</span>
            </span>
          ) : (
            <span className="text-slate-400">Select language…</span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-xl shadow-slate-300/40 overflow-hidden animate-slide-up">
          {/* Search */}
          <div className="p-2 border-b border-slate-200">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                ref={searchRef}
                id="language-search-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search language…"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-2
                           text-sm text-slate-800 placeholder-slate-400
                           focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          {/* Options */}
          <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
            {/* Auto-detect */}
            {!query && (
              <li
                role="option"
                aria-selected={selected === 'auto'}
                onClick={() => select('auto')}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors duration-100
                  ${selected === 'auto' ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                <Globe className="w-4 h-4 opacity-60" />
                <span className="font-medium">Auto-detect</span>
                <span className="ml-auto text-xs text-slate-400">Let Whisper decide</span>
              </li>
            )}

            {filtered.length === 0 && (
              <li className="px-4 py-3 text-slate-400 text-sm text-center">No languages found</li>
            )}

            {filtered.map((lang) => (
              <li
                key={lang.code}
                role="option"
                id={`lang-option-${lang.code}`}
                aria-selected={selected === lang.code}
                onClick={() => select(lang.code)}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors duration-100
                  ${selected === lang.code ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                <span className="w-8 text-xs font-mono text-slate-400 uppercase">{lang.code}</span>
                <span className="font-medium">{lang.name}</span>
                {lang.nativeName !== lang.name && (
                  <span className="ml-auto text-sm text-slate-400 truncate">{lang.nativeName}</span>
                )}
                {selected === lang.code && (
                  <span className="text-brand-600 text-xs ml-auto">✓</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default LanguageSelector
