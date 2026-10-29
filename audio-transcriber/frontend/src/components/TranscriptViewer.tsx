import React, { useState } from 'react'
import {
  Copy, Download, CheckCheck, FileText, Edit3,
} from 'lucide-react'

interface Segment {
  start: number
  end: number
  text: string
}

interface Props {
  transcript: string
  segments?: Segment[]
  filename?: string
  detectedLanguage?: string
  includeTimestamps: boolean
  onTranscriptChange: (text: string) => void
}

function formatTs(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const TranscriptViewer: React.FC<Props> = ({
  transcript, segments, filename, detectedLanguage, includeTimestamps, onTranscriptChange,
}) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(transcript)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const base = filename ? filename.replace(/\.[^.]+$/, '') : 'transcript'
    a.href = url
    a.download = `${base}_transcript.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="glass-card p-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center">
            <FileText className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-100">Transcript</h2>
            {detectedLanguage && (
              <p className="text-xs text-slate-500">
                Detected: <span className="text-brand-400 font-medium">{detectedLanguage}</span>
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="copy-transcript-btn"
            onClick={handleCopy}
            className="btn-secondary text-sm py-2 px-3"
            title="Copy transcript"
          >
            {copied ? <CheckCheck className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy'}</span>
          </button>
          <button
            id="download-txt-btn"
            onClick={handleDownload}
            className="btn-primary text-sm py-2 px-4"
          >
            <Download className="w-4 h-4" />
            Download TXT
          </button>
        </div>
      </div>

      {/* Edit hint */}
      <div className="flex items-center gap-1.5 text-xs text-slate-600 mb-2">
        <Edit3 className="w-3.5 h-3.5" />
        <span>Click to edit before downloading</span>
      </div>

      {/* Textarea */}
      <textarea
        id="transcript-textarea"
        value={transcript}
        onChange={(e) => onTranscriptChange(e.target.value)}
        className="input-base font-mono text-sm leading-relaxed min-h-[300px] resize-y"
        spellCheck={false}
        dir="auto"
        style={{ unicodeBidi: 'plaintext' }}
      />

      {/* Segment timestamps (if available and enabled) */}
      {includeTimestamps && segments && segments.length > 0 && (
        <details className="mt-4 group">
          <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-300 transition-colors select-none">
            ▶ Show raw segments with timestamps ({segments.length})
          </summary>
          <div className="mt-2 max-h-60 overflow-y-auto space-y-1">
            {segments.map((seg, i) => (
              <div key={i} className="flex gap-3 text-xs py-1 border-b border-slate-800">
                <span className="flex-shrink-0 font-mono text-slate-600">
                  [{formatTs(seg.start)} → {formatTs(seg.end)}]
                </span>
                <span className="text-slate-400" dir="auto">{seg.text.trim()}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

export default TranscriptViewer
