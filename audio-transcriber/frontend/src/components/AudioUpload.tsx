import React, { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Upload, FileAudio, X, AlertCircle, Plus } from 'lucide-react'

interface Props {
  files: File[]
  onFilesAdd: (files: File[]) => void
  onFileRemove: (index: number) => void
  disabled?: boolean
}

const ACCEPTED_TYPES = [
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
  'audio/mp4', 'audio/x-m4a', 'audio/flac', 'audio/ogg',
  'audio/webm', 'audio/aac', 'audio/opus', 'video/mp4',
]
const ACCEPTED_EXT = /\.(mp3|wav|m4a|flac|ogg|webm|aac|opus|mp4|wma|aiff|aif)$/i

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB
const MAX_DURATION_SECONDS = 4 * 60 * 60 // 4 hours

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Probes an audio file's duration in the browser without uploading it. Resolves null if it can't be determined. */
function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = document.createElement('audio')
    const cleanup = () => URL.revokeObjectURL(url)
    const timeout = setTimeout(() => { cleanup(); resolve(null) }, 6000)
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      clearTimeout(timeout)
      const d = Number.isFinite(audio.duration) ? audio.duration : null
      cleanup()
      resolve(d)
    }
    audio.onerror = () => { clearTimeout(timeout); cleanup(); resolve(null) }
    audio.src = url
  })
}

const AudioUpload: React.FC<Props> = ({ files, onFilesAdd, onFileRemove, disabled }) => {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const validate = (f: File): string | null => {
    if (!ACCEPTED_TYPES.includes(f.type) && !ACCEPTED_EXT.test(f.name)) {
      return `Unsupported format: ${f.name}. Please use MP3, WAV, M4A, FLAC, OGG, or similar.`
    }
    if (f.size > MAX_FILE_BYTES) {
      return `File is too large (max 2 GB): ${f.name}`
    }
    return null
  }

  const handleFiles = useCallback(async (list: FileList | File[]) => {
    const incoming = Array.from(list)
    const valid: File[] = []
    let err: string | null = null
    const seen = new Set(files.map((f) => `${f.name}:${f.size}`))

    setChecking(true)
    for (const f of incoming) {
      const key = `${f.name}:${f.size}`
      if (seen.has(key)) {
        err = `"${f.name}" is already in the queue — skipped duplicate.`
        continue
      }
      const v = validate(f)
      if (v) { err = v; continue }

      const duration = await probeDuration(f)
      if (duration !== null && duration > MAX_DURATION_SECONDS) {
        err = `"${f.name}" is too long (${Math.round(duration / 60)} min). Max allowed is ${MAX_DURATION_SECONDS / 60} min per file.`
        continue
      }

      seen.add(key)
      valid.push(f)
    }
    setChecking(false)
    setError(err)
    if (err) toast.error(err)
    if (valid.length > 0) onFilesAdd(valid)
  }, [onFilesAdd, files])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(e.target.files)
    e.target.value = ''
  }

  return (
    <div>
      {files.length > 0 && (
        <div className="space-y-2 mb-3">
          {files.map((file, i) => {
            const ext = file.name.split('.').pop()?.toUpperCase() ?? 'AUDIO'
            return (
              <div key={`${file.name}-${i}`} className="glass-card p-4 animate-fade-in">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center">
                    <FileAudio className="w-5 h-5 text-brand-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 truncate text-sm" title={file.name}>{file.name}</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      <span className="badge bg-slate-100 text-slate-600">{ext}</span>
                      <span className="badge bg-slate-100 text-slate-600">{formatBytes(file.size)}</span>
                    </div>
                  </div>
                  {!disabled && (
                    <button
                      onClick={() => onFileRemove(i)}
                      className="flex-shrink-0 w-7 h-7 rounded-lg bg-slate-100 hover:bg-red-50 text-slate-400 hover:text-red-600
                                 flex items-center justify-center transition-all duration-200"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

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
          relative group cursor-pointer rounded-2xl border-2 border-dashed text-center
          transition-all duration-300
          ${files.length > 0 ? 'p-5' : 'p-8'}
          ${dragging
            ? 'border-brand-400 bg-brand-50/60 scale-[1.01]'
            : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <div className={`
          mx-auto mb-3 rounded-2xl flex items-center justify-center
          transition-all duration-300
          ${files.length > 0 ? 'w-10 h-10' : 'w-14 h-14 mb-3'}
          ${dragging ? 'bg-brand-100 scale-110' : 'bg-slate-100 group-hover:bg-brand-50'}
        `}>
          {files.length > 0
            ? <Plus className="w-5 h-5 text-slate-500 group-hover:text-brand-600" />
            : <Upload className={`w-7 h-7 transition-colors duration-200 ${dragging ? 'text-brand-600' : 'text-slate-500 group-hover:text-brand-600'}`} />
          }
        </div>
        <p className="text-slate-800 font-semibold text-lg mb-1">
          {files.length > 0 ? 'Add more audio files' : 'Drop your audio files here'}
        </p>
        <p className="text-slate-400 text-sm mb-4">
          {checking ? 'Checking file…' : 'or click to browse files — multiple allowed'}
        </p>
        <div className="flex flex-wrap justify-center gap-1.5">
          {['MP3', 'WAV', 'M4A', 'FLAC', 'OGG', 'WebM', 'AAC'].map((fmt) => (
            <span key={fmt} className="badge bg-white text-slate-500 border border-slate-200">{fmt}</span>
          ))}
        </div>
        <p className="text-slate-400 text-[11px] mt-3">
          Max 2 GB and 4 hours per file · duplicate files are skipped automatically
        </p>
        <input
          ref={inputRef}
          id="audio-file-input"
          type="file"
          multiple
          accept="audio/*,video/mp4,.flac,.ogg,.webm,.aac,.m4a,.opus"
          className="hidden"
          onChange={onInputChange}
          disabled={disabled}
        />
      </div>
      {error && (
        <div className="mt-3 flex items-start gap-2 text-red-600 text-sm animate-fade-in">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}
    </div>
  )
}

export default AudioUpload
