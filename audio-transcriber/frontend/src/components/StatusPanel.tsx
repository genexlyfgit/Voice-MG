import React from 'react'
import { Mic, Cpu, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

interface Props {
  status: 'idle' | 'uploading' | 'queued' | 'processing' | 'done' | 'error'
  message: string
  uploadPercent: number
  transcribePercent?: number
  detectedLanguage?: string
  durationSeconds?: number
  processingSeconds?: number
  backendOk: boolean | null
  device: string
}

const STATUS_CONFIG = {
  idle: { color: 'text-slate-500', icon: null, label: 'Ready' },
  uploading: { color: 'text-blue-400', icon: 'spinner', label: 'Uploading…' },
  queued: { color: 'text-yellow-400', icon: 'spinner', label: 'Queued' },
  processing: { color: 'text-brand-400', icon: 'spinner', label: 'Transcribing…' },
  done: { color: 'text-emerald-400', icon: 'check', label: 'Complete' },
  error: { color: 'text-red-400', icon: 'error', label: 'Error' },
}

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}m ${s}s`
}

const StatusPanel: React.FC<Props> = ({
  status, message, uploadPercent, transcribePercent = 0, detectedLanguage, durationSeconds, processingSeconds, backendOk, device,
}) => {
  const cfg = STATUS_CONFIG[status]
  const pct = Math.min(100, Math.max(0, Math.round(transcribePercent)))

  return (
    <div className="glass-card p-5 space-y-4">
      {/* Backend health — only shown when online */}
      {backendOk === true && (
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-slate-400">
            <Cpu className="w-4 h-4" />
            <span>Backend</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="status-dot bg-emerald-400 animate-pulse-slow" />
            <span className="text-emerald-400 text-xs font-medium">Online · {device}</span>
          </div>
        </div>
      )}

      {/* Status row */}
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 mt-0.5 ${cfg.color}`}>
          {cfg.icon === 'spinner' && <Loader2 className="w-5 h-5 animate-spin" />}
          {cfg.icon === 'check' && <CheckCircle className="w-5 h-5" />}
          {cfg.icon === 'error' && <AlertCircle className="w-5 h-5" />}
          {!cfg.icon && <Mic className="w-5 h-5 opacity-40" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`font-semibold text-sm ${cfg.color}`}>{cfg.label}</p>
          <p className="text-slate-400 text-sm mt-0.5 break-words">{message || 'Upload audio and click Transcribe'}</p>
        </div>
      </div>

      {/* Upload progress bar */}
      {status === 'uploading' && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-slate-500">
            <span>Uploading file</span>
            <span>{uploadPercent}%</span>
          </div>
          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all duration-200"
              style={{ width: `${uploadPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Queued state indicator */}
      {status === 'queued' && (
        <div className="space-y-1.5 pt-1">
          <div className="flex justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-ping" />
              Waiting for worker slot…
            </span>
            <span className="text-yellow-400/80 font-mono">0%</span>
          </div>
          <div className="h-2 bg-slate-900/80 border border-slate-700/50 rounded-full overflow-hidden">
            <div className="h-full bg-yellow-500/40 rounded-full w-full animate-pulse" />
          </div>
        </div>
      )}

      {/* Real-time Transcription Progress Bar (0 to 100%) */}
      {status === 'processing' && (
        <div className="space-y-2 pt-1 animate-fade-in">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-brand-400 animate-pulse" />
              <span className="text-slate-300 font-medium">Transcribing audio</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-brand-300 font-bold font-mono text-sm tracking-tight">
                {pct}%
              </span>
            </div>
          </div>

          <div className="h-3 bg-slate-900/90 border border-slate-700/70 rounded-full overflow-hidden p-0.5 relative shadow-inner">
            <div
              className="h-full bg-gradient-to-r from-brand-600 via-brand-500 to-indigo-400 rounded-full transition-all duration-500 ease-out relative overflow-hidden shadow-sm"
              style={{ width: `${pct}%` }}
            >
              <div className="absolute inset-0 bg-white/20 animate-pulse" />
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>Audio stream progress</span>
            <span>{pct === 0 ? 'Loading Whisper model…' : `${pct}% completed`}</span>
          </div>
        </div>
      )}

      {/* Meta info */}
      {(detectedLanguage || durationSeconds !== undefined || processingSeconds !== undefined) && (
        <div className="flex flex-wrap gap-3 pt-2 border-t border-slate-700/50">
          {detectedLanguage && (
            <div className="text-xs">
              <span className="text-slate-600">Language: </span>
              <span className="text-brand-400 font-medium">{detectedLanguage}</span>
            </div>
          )}
          {durationSeconds !== undefined && (
            <div className="text-xs">
              <span className="text-slate-600">Duration: </span>
              <span className="text-slate-300 font-medium">{formatDuration(durationSeconds)}</span>
            </div>
          )}
          {processingSeconds !== undefined && (
            <div className="text-xs">
              <span className="text-slate-600">Processing: </span>
              <span className="text-slate-300 font-medium">{formatDuration(processingSeconds)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default StatusPanel
