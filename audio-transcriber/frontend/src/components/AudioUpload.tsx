import React, { useCallback, useRef, useState } from 'react'
import { Upload, FileAudio, X, AlertCircle } from 'lucide-react'

interface Props {
  file: File | null
  onFileSelect: (file: File) => void
  onFileClear: () => void
  disabled?: boolean
  audioDuration: number | null
}

const ACCEPTED_TYPES = [
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
  'audio/mp4', 'audio/x-m4a', 'audio/flac', 'audio/ogg',
  'audio/webm', 'audio/aac', 'audio/opus', 'video/mp4',
]
const ACCEPTED_EXT = /\.(mp3|wav|m4a|flac|ogg|webm|aac|opus|mp4|wma|aiff|aif)$/i

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

const AudioUpload: React.FC<Props> = ({ file, onFileSelect, onFileClear, disabled, audioDuration }) => {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const validate = (f: File): string | null => {
    if (!ACCEPTED_TYPES.includes(f.type) && !ACCEPTED_EXT.test(f.name)) {
      return `Unsupported format: ${f.name}. Please use MP3, WAV, M4A, FLAC, OGG, or similar.`
    }
    if (f.size > 2 * 1024 * 1024 * 1024) {
      return 'File is too large (max 2 GB).'
    }
    return null
  }

  const handleFile = useCallback((f: File) => {
    const err = validate(f)
    if (err) { setError(err); return }
    setError(null)
    onFileSelect(f)
  }, [onFileSelect])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
    e.target.value = ''
  }

  if (file) {
    const ext = file.name.split('.').pop()?.toUpperCase() ?? 'AUDIO'
    return (
      <div className="glass-card p-5 animate-fade-in">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-brand-600/20 border border-brand-500/30 flex items-center justify-center">
            <FileAudio className="w-6 h-6 text-brand-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-100 truncate" title={file.name}>{file.name}</p>
            <div className="flex flex-wrap gap-3 mt-1.5">
              <span className="badge bg-slate-700/60 text-slate-300">{ext}</span>
              <span className="badge bg-slate-700/60 text-slate-300">{formatBytes(file.size)}</span>
              {audioDuration !== null && (
                <span className="badge bg-brand-600/20 text-brand-300 border border-brand-500/30">
                  ⏱ {formatDuration(audioDuration)}
                </span>
              )}
            </div>
          </div>
          {!disabled && (
            <button
              id="clear-file-btn"
              onClick={onFileClear}
              className="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-700 hover:bg-red-900/60 text-slate-400 hover:text-red-400
                         flex items-center justify-center transition-all duration-200"
              aria-label="Remove file"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div
        id="drop-zone"
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !disabled && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={disabled ? undefined : onDrop}
        className={`
          relative group cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center
          transition-all duration-300
          ${dragging
            ? 'border-brand-400 bg-brand-900/20 scale-[1.01]'
            : 'border-slate-600 hover:border-brand-500/70 hover:bg-slate-800/40'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <div className={`
          w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center
          transition-all duration-300
          ${dragging ? 'bg-brand-600/30 scale-110' : 'bg-slate-700/60 group-hover:bg-brand-700/20'}
        `}>
          <Upload className={`w-7 h-7 transition-colors duration-200 ${dragging ? 'text-brand-300' : 'text-slate-400 group-hover:text-brand-400'}`} />
        </div>
        <p className="text-slate-200 font-semibold text-lg mb-1">Drop your audio file here</p>
        <p className="text-slate-500 text-sm mb-4">or click to browse files</p>
        <div className="flex flex-wrap justify-center gap-1.5">
          {['MP3', 'WAV', 'M4A', 'FLAC', 'OGG', 'WebM', 'AAC'].map((fmt) => (
            <span key={fmt} className="badge bg-slate-800 text-slate-400 border border-slate-700">{fmt}</span>
          ))}
        </div>
        <input
          ref={inputRef}
          id="audio-file-input"
          type="file"
          accept="audio/*,video/mp4,.flac,.ogg,.webm,.aac,.m4a,.opus"
          className="hidden"
          onChange={onInputChange}
          disabled={disabled}
        />
      </div>
      {error && (
        <div className="mt-3 flex items-start gap-2 text-red-400 text-sm animate-fade-in">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}
    </div>
  )
}

export default AudioUpload
