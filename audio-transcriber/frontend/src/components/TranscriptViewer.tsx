import React, { useState } from 'react'
import {
  Copy, Download, CheckCheck, FileText, Edit3, FileOutput,
} from 'lucide-react'

interface Segment {
  start: number
  end: number
  text: string
}

interface ComparisonRow {
  start: number
  end: number
  native: string
  english: string
}

interface Props {
  transcript: string
  originalTranscript?: string
  englishTranscript?: string
  comparison?: ComparisonRow[]
  segments?: Segment[]
  filename?: string
  detectedLanguage?: string
  includeTimestamps: boolean
  onTranscriptChange: (text: string) => void
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>')
}

function formatTs(secs: number) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const TranscriptViewer: React.FC<Props> = ({
  transcript, originalTranscript, englishTranscript, comparison, segments, filename, detectedLanguage, includeTimestamps, onTranscriptChange,
}) => {
  const [copied, setCopied] = useState(false)
  const isTranslated = !!originalTranscript && originalTranscript !== transcript

  const handleCopy = async () => {
    await navigator.clipboard.writeText(transcript)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const download = (text: string, suffix: string) => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const base = filename ? filename.replace(/\.[^.]+$/, '') : 'transcript'
    a.href = url
    a.download = `${base}${suffix}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDownload = () => download(transcript, isTranslated ? `_${detectedLanguage ?? 'translated'}` : '_transcript')
  const handleDownloadOriginal = () => originalTranscript && download(originalTranscript, '_original')

  const handleDownloadComparisonPdf = () => {
    if (!comparison || comparison.length === 0) return
    const win = window.open('', '_blank')
    if (!win) return
    const base = filename ? filename.replace(/\.[^.]+$/, '') : 'transcript'
    const rows = comparison.map((r) => `
      <tr>
        <td class="ts">${formatTs(r.start)} &rarr; ${formatTs(r.end)}</td>
        <td class="native" dir="auto">${escapeHtml(r.native)}</td>
        <td class="english" dir="auto">${escapeHtml(r.english)}</td>
      </tr>`).join('')
    win.document.write(`<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(base)} - comparison</title>
          <style>
            body { font-family: 'Noto Sans', Arial, sans-serif; padding: 24px; color: #111; }
            h1 { font-size: 18px; margin-bottom: 4px; }
            p.sub { color: #555; font-size: 12px; margin-top: 0; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
            th { background: #f1f1f1; }
            td.ts { white-space: nowrap; font-family: monospace; color: #555; width: 110px; }
            td.native, td.english { width: 44%; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(base)} — Native vs. English Comparison</h1>
          <p class="sub">Timestamped, audio-synced side-by-side transcript for verification / annotation.</p>
          <table>
            <thead><tr><th>Timestamp</th><th>Native script</th><th>English</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <script>window.onload = () => window.print()</script>
        </body>
      </html>`)
    win.document.close()
  }

  const handleDownloadEnglish = () => englishTranscript && download(englishTranscript, '_english')

  return (
    <div className="glass-card p-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
            <FileText className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Transcript</h2>
            {detectedLanguage && (
              <p className="text-xs text-slate-500">
                Detected: <span className="text-brand-600 font-medium">{detectedLanguage}</span>
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
            {copied ? <CheckCheck className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
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
      <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
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

      {/* Original-language transcript (shown when translated) */}
      {isTranslated && (
        <details className="mt-4 group">
          <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-800 transition-colors select-none flex items-center justify-between">
            <span>▶ Show original-language transcript (as spoken)</span>
            <button
              onClick={(e) => { e.preventDefault(); handleDownloadOriginal() }}
              className="btn-secondary text-xs py-1 px-2 ml-2"
              title="Download original transcript"
            >
              <Download className="w-3.5 h-3.5" />
              Original TXT
            </button>
          </summary>
          <pre
            className="mt-2 max-h-60 overflow-y-auto text-xs text-slate-500 whitespace-pre-wrap font-mono leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-3"
            dir="auto"
          >
            {originalTranscript}
          </pre>
        </details>
      )}

      {/* Native vs. English comparison (always available for cloud jobs) */}
      {comparison && comparison.length > 0 && (
        <details className="mt-4 group">
          <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-800 transition-colors select-none flex items-center justify-between">
            <span>▶ Native vs. English comparison ({comparison.length} segments)</span>
            <span className="flex items-center gap-2">
              <button
                onClick={(e) => { e.preventDefault(); handleDownloadEnglish() }}
                className="btn-secondary text-xs py-1 px-2"
                title="Download English transcript"
              >
                <Download className="w-3.5 h-3.5" />
                English TXT
              </button>
              <button
                onClick={(e) => { e.preventDefault(); handleDownloadComparisonPdf() }}
                className="btn-secondary text-xs py-1 px-2"
                title="Open printable comparison table (save as PDF)"
              >
                <FileOutput className="w-3.5 h-3.5" />
                Comparison PDF
              </button>
            </span>
          </summary>
          <div className="mt-2 max-h-72 overflow-y-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-slate-400 text-left">
                  <th className="py-1 pr-2 font-medium">Time</th>
                  <th className="py-1 pr-2 font-medium">Native</th>
                  <th className="py-1 font-medium">English</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row, i) => (
                  <tr key={i} className="border-b border-slate-200 align-top">
                    <td className="py-1.5 pr-2 font-mono text-slate-400 whitespace-nowrap">
                      {formatTs(row.start)}&rarr;{formatTs(row.end)}
                    </td>
                    <td className="py-1.5 pr-2 text-slate-700" dir="auto">{row.native}</td>
                    <td className="py-1.5 text-slate-500" dir="auto">{row.english}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* Segment timestamps (if available and enabled) */}
      {includeTimestamps && segments && segments.length > 0 && (
        <details className="mt-4 group">
          <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-800 transition-colors select-none">
            ▶ Show raw segments with timestamps ({segments.length})
          </summary>
          <div className="mt-2 max-h-60 overflow-y-auto space-y-1">
            {segments.map((seg, i) => (
              <div key={i} className="flex gap-3 text-xs py-1 border-b border-slate-200">
                <span className="flex-shrink-0 font-mono text-slate-400">
                  [{formatTs(seg.start)} → {formatTs(seg.end)}]
                </span>
                <span className="text-slate-600" dir="auto">{seg.text.trim()}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

export default TranscriptViewer
