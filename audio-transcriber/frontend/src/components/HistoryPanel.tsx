import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, FileAudio, CheckCircle2, XCircle, Clock, DatabaseZap, X, Loader2 } from 'lucide-react'
import { getHistory, getHistoryDetail, type HistoryItem, type HistoryDetail } from '../services/api'
import TranscriptViewer from './TranscriptViewer'

function formatDuration(secs: number | null) {
  if (secs === null || secs === undefined) return '—'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}m ${s}s`
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const STATUS_STYLE: Record<string, string> = {
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  error: 'bg-red-50 text-red-700 border-red-200',
  processing: 'bg-brand-50 text-brand-700 border-brand-200',
  queued: 'bg-amber-50 text-amber-700 border-amber-200',
}

const HistoryPanel: React.FC = () => {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<HistoryDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback((manual = false) => {
    setLoading(true)
    setError(null)
    getHistory(50)
      .then((res) => {
        setEnabled(res.data.enabled)
        setItems(res.data.jobs)
        if (manual) toast.success('History refreshed.')
      })
      .catch(() => {
        setError('Could not load history from the server.')
        if (manual) toast.error('Could not load history from the server.')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const openDetail = (item: HistoryItem) => {
    if (item.status !== 'done') {
      toast.error('This job has no saved transcript to open.')
      return
    }
    setSelectedId(item.id)
    setDetail(null)
    setDetailLoading(true)
    getHistoryDetail(item.id)
      .then((res) => setDetail(res.data))
      .catch(() => toast.error('Could not load this transcript.'))
      .finally(() => setDetailLoading(false))
  }

  const closeDetail = () => { setSelectedId(null); setDetail(null) }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Transcription history</h2>
          <p className="text-xs text-slate-400 mt-0.5">Saved transcripts, most recent first — click a row to open and download</p>
        </div>
        <button
          onClick={() => load(true)}
          className="btn-secondary text-xs py-1.5 px-3"
          disabled={loading}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {!enabled && !loading && (
        <div className="card-flat p-4 border-amber-200 bg-amber-50/60 flex items-start gap-3">
          <DatabaseZap className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-700">
            History database is not reachable right now. Finished jobs won't be listed here until it's back online.
          </p>
        </div>
      )}

      {error && (
        <div className="card-flat p-4 border-red-200 bg-red-50/60">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {!error && enabled && items.length === 0 && !loading && (
        <div className="card-flat p-8 text-center">
          <FileAudio className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No transcriptions yet.</p>
          <p className="text-xs text-slate-400 mt-1">Completed jobs will show up here.</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => openDetail(item)}
              className="w-full text-left glass-card p-4 flex items-center gap-3 hover:border-brand-300 hover:shadow-sm transition-all"
            >
              <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                <FileAudio className="w-4 h-4 text-slate-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-slate-900 truncate" title={item.filename ?? undefined}>
                  {item.filename || 'Untitled audio'}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-slate-400">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(item.created_at)}</span>
                  {item.detected_language && <span>Lang: <span className="text-slate-600 font-medium">{item.detected_language}</span></span>}
                  {item.duration_seconds != null && <span>Audio: {formatDuration(item.duration_seconds)}</span>}
                  {item.processing_seconds != null && <span>Took: {formatDuration(item.processing_seconds)}</span>}
                </div>
              </div>
              <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium capitalize ${STATUS_STYLE[item.status] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                {item.status === 'done' ? <CheckCircle2 className="w-3 h-3" /> : item.status === 'error' ? <XCircle className="w-3 h-3" /> : null}
                {item.status}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Detail modal — transcript text/PDF only, never the source audio */}
      {selectedId && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 overflow-y-auto">
          <div className="absolute inset-0 bg-slate-900/50" onClick={closeDetail} />
          <div className="relative z-10 w-full max-w-2xl mt-4 mb-8">
            <div className="flex items-center justify-end mb-2">
              <button
                onClick={closeDetail}
                className="w-8 h-8 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-900 flex items-center justify-center shadow-sm"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {detailLoading && (
              <div className="card-flat p-10 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
              </div>
            )}
            {!detailLoading && detail && (
              <TranscriptViewer
                transcript={detail.transcript ?? ''}
                originalTranscript={detail.original_transcript ?? undefined}
                englishTranscript={detail.english_transcript ?? undefined}
                comparison={detail.comparison ?? undefined}
                segments={detail.segments ?? undefined}
                filename={detail.filename ?? undefined}
                detectedLanguage={detail.detected_language ?? undefined}
                includeTimestamps={!!(detail.segments && detail.segments.length > 0)}
                onTranscriptChange={() => {}}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default HistoryPanel
