import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic2, Settings2, Clock, ChevronDown } from 'lucide-react'
import AudioUpload from './components/AudioUpload'
import LanguageSelector from './components/LanguageSelector'
import StatusPanel from './components/StatusPanel'
import TranscriptViewer from './components/TranscriptViewer'
import {
  healthCheck, getLanguages, submitTranscription, getJobStatus,
  type Language, type JobStatus, type TranscribeOptions,
} from './services/api'

type AppStatus = 'idle' | 'uploading' | 'queued' | 'processing' | 'done' | 'error'

const POLL_INTERVAL_MS = 1000
const MODELS = ['gemini-3.5-transcribe', 'large-v3', 'large-v2', 'medium', 'small', 'base', 'tiny']
const COMPUTE_TYPES = ['int8', 'float16', 'float32']

export default function App() {
  // file
  const [file, setFile] = useState<File | null>(null)
  const [audioDuration, setAudioDuration] = useState<number | null>(null)

  // languages
  const [languages, setLanguages] = useState<Language[]>([])
  const [selectedLang, setSelectedLang] = useState('auto')

  // backend health
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [device, setDevice] = useState('cpu')

  // job state
  const [appStatus, setAppStatus] = useState<AppStatus>('idle')
  const [statusMsg, setStatusMsg] = useState('')
  const [uploadPercent, setUploadPercent] = useState(0)
  const [transcribePercent, setTranscribePercent] = useState(0)
  const [jobId, setJobId] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // transcript
  const [jobResult, setJobResult] = useState<JobStatus | null>(null)
  const [editedTranscript, setEditedTranscript] = useState('')

  // settings
  const [showSettings, setShowSettings] = useState(false)
  const [model, setModel] = useState('gemini-3.5-transcribe')
  const [computeType, setComputeType] = useState('int8')
  const [beamSize, setBeamSize] = useState(1)
  const [vadFilter, setVadFilter] = useState(true)
  const [includeTimestamps, setIncludeTimestamps] = useState(false)

  // ---- Backend health check ----
  useEffect(() => {
    const check = async () => {
      try {
        const res = await healthCheck()
        setBackendOk(true)
        setDevice(res.data.device)
      } catch {
        setBackendOk(false)
      }
    }
    check()
    const id = setInterval(check, 15000)
    return () => clearInterval(id)
  }, [])

  // ---- Load languages ----
  useEffect(() => {
    getLanguages()
      .then((res) => setLanguages(res.data.languages))
      .catch(() => {/* will retry on next health check */})
  }, [backendOk])

  // ---- Derive audio duration from file ----
  useEffect(() => {
    if (!file) { setAudioDuration(null); return }
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    audio.src = url
    audio.onloadedmetadata = () => {
      setAudioDuration(isFinite(audio.duration) ? audio.duration : null)
      URL.revokeObjectURL(url)
    }
    audio.onerror = () => URL.revokeObjectURL(url)
  }, [file])

  // ---- Polling ----
  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const startPolling = useCallback((id: string) => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const res = await getJobStatus(id)
        const job = res.data
        setStatusMsg(job.message)
        if (typeof job.progress === 'number') {
          setTranscribePercent(job.progress)
        }
        if (job.status === 'done') {
          stopPolling()
          setAppStatus('done')
          setTranscribePercent(100)
          setJobResult(job)
          setEditedTranscript(job.transcript ?? '')
        } else if (job.status === 'error') {
          stopPolling()
          setAppStatus('error')
        } else {
          setAppStatus(job.status)
        }
      } catch (e: unknown) {
        const err = e as { response?: { data?: { detail?: string } }; message?: string }
        setStatusMsg(err?.response?.data?.detail ?? 'Lost connection to backend')
        setAppStatus('error')
        stopPolling()
      }
    }, POLL_INTERVAL_MS)
  }, [stopPolling])

  useEffect(() => () => stopPolling(), [stopPolling])

  // ---- Transcribe ----
  const handleTranscribe = async () => {
    if (!file || !backendOk) return
    setAppStatus('uploading')
    setStatusMsg('Uploading audio file…')
    setUploadPercent(0)
    setTranscribePercent(0)
    setJobResult(null)
    setEditedTranscript('')

    const options: TranscribeOptions = {
      language: selectedLang === 'auto' ? undefined : selectedLang,
      model,
      include_timestamps: includeTimestamps,
      beam_size: beamSize,
      vad_filter: vadFilter,
      compute_type: computeType,
    }

    try {
      const res = await submitTranscription(file, options, (pct) => {
        setUploadPercent(pct)
      })
      const { job_id } = res.data
      setJobId(job_id)
      setAppStatus('queued')
      setStatusMsg('Job queued — waiting for the model…')
      startPolling(job_id)
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string }
      setAppStatus('error')
      setStatusMsg(err?.response?.data?.detail ?? err?.message ?? 'Upload failed')
    }
  }

  const isRunning = ['uploading', 'queued', 'processing'].includes(appStatus)
  const canTranscribe = file !== null && backendOk === true && !isRunning

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Background gradient blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-brand-900/20 blur-3xl" />
        <div className="absolute top-1/3 -right-32 w-80 h-80 rounded-full bg-indigo-900/15 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-72 h-72 rounded-full bg-violet-900/10 blur-3xl" />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-4 py-10 sm:py-16">
        {/* Hero header */}
        <header className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-600/20 border border-brand-500/30 mb-4">
            <Mic2 className="w-8 h-8 text-brand-400" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-50">
            VoiceScribe
          </h1>
          <p className="mt-2 text-slate-400 text-base sm:text-lg">
            Offline audio transcription powered by <span className="text-brand-400 font-medium">Whisper</span>
          </p>
        </header>

        <main className="space-y-5">
          {/* Upload card */}
          <section className="glass-card p-6">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-4">
              1 · Audio File
            </h2>
            <AudioUpload
              file={file}
              onFileSelect={(f) => { setFile(f); setAppStatus('idle'); setTranscribePercent(0); setJobResult(null); setStatusMsg('') }}
              onFileClear={() => { setFile(null); setAudioDuration(null); setAppStatus('idle'); setTranscribePercent(0); setJobResult(null); setStatusMsg('') }}
              disabled={isRunning}
              audioDuration={audioDuration}
            />
          </section>

          {/* Language card */}
          <section className="glass-card p-6 relative z-20">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-4">
              2 · Language
            </h2>
            <LanguageSelector
              languages={languages}
              selected={selectedLang}
              onChange={setSelectedLang}
              disabled={isRunning}
            />
          </section>

          {/* Advanced settings (collapsible) */}
          <section className="glass-card overflow-hidden">
            <button
              id="toggle-settings-btn"
              onClick={() => setShowSettings((s) => !s)}
              className="w-full flex items-center justify-between px-6 py-4 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                <span className="text-sm font-medium">Advanced Settings</span>
              </div>
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showSettings ? 'rotate-180' : ''}`} />
            </button>

            {showSettings && (
              <div className="px-6 pb-6 space-y-5 border-t border-slate-700/50 pt-4 animate-fade-in">
                {/* Model */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                    Transcription Model
                  </label>
                  <select
                    id="model-select"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={isRunning}
                    className="input-base text-sm"
                  >
                    {MODELS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-600 mt-1">
                    {model.startsWith('gemini')
                      ? 'Runs on Gemini\'s servers — fast, no local compute settings needed.'
                      : 'large-v3 gives best accuracy; tiny is fastest.'}
                  </p>
                </div>

                {!model.startsWith('gemini') && (
                  <>
                    {/* Compute type */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                        Compute Type
                      </label>
                      <select
                        id="compute-type-select"
                        value={computeType}
                        onChange={(e) => setComputeType(e.target.value)}
                        disabled={isRunning}
                        className="input-base text-sm"
                      >
                        {COMPUTE_TYPES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-600 mt-1">int8 = fast CPU; float16 = GPU recommended.</p>
                    </div>

                    {/* Beam size */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">
                        Beam Size: {beamSize}
                      </label>
                      <input
                        id="beam-size-slider"
                        type="range"
                        min={1}
                        max={10}
                        value={beamSize}
                        onChange={(e) => setBeamSize(Number(e.target.value))}
                        disabled={isRunning}
                        className="w-full accent-brand-500"
                      />
                      <p className="text-xs text-slate-600 mt-1">Higher = more accurate but slower.</p>
                    </div>
                  </>
                )}

                {/* Toggles */}
                <div className="space-y-3">
                  <label id="vad-filter-label" className="flex items-center justify-between cursor-pointer group">
                    <div>
                      <p className="text-sm font-medium text-slate-300">Voice Activity Detection</p>
                      <p className="text-xs text-slate-600">Skip silent segments automatically</p>
                    </div>
                    <div className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${vadFilter ? 'bg-brand-600' : 'bg-slate-700'}`}
                      onClick={() => !isRunning && setVadFilter((v) => !v)}>
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${vadFilter ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </div>
                  </label>

                  <label id="timestamps-label" className="flex items-center justify-between cursor-pointer group">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        <p className="text-sm font-medium text-slate-300">Include Timestamps</p>
                      </div>
                      <p className="text-xs text-slate-600">Prepend [HH:MM:SS] to each segment</p>
                    </div>
                    <div className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${includeTimestamps ? 'bg-brand-600' : 'bg-slate-700'}`}
                      onClick={() => !isRunning && setIncludeTimestamps((v) => !v)}>
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${includeTimestamps ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </div>
                  </label>
                </div>
              </div>
            )}
          </section>

          {/* Status panel */}
          <StatusPanel
            status={appStatus}
            message={statusMsg}
            uploadPercent={uploadPercent}
            transcribePercent={transcribePercent}
            detectedLanguage={jobResult?.detected_language}
            durationSeconds={jobResult?.duration_seconds}
            processingSeconds={jobResult?.processing_seconds}
            backendOk={backendOk}
            device={device}
          />

          {/* Transcribe button */}
          <button
            id="transcribe-btn"
            onClick={handleTranscribe}
            disabled={!canTranscribe}
            className="btn-primary w-full py-4 text-base justify-center"
          >
            {isRunning ? (
              <>
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Processing…
              </>
            ) : (
              <>
                <Mic2 className="w-5 h-5" />
                Transcribe Audio
              </>
            )}
          </button>

          {/* Transcript viewer */}
          {appStatus === 'done' && jobResult && (
            <TranscriptViewer
              transcript={editedTranscript}
              segments={jobResult.segments}
              filename={file?.name}
              detectedLanguage={jobResult.detected_language}
              includeTimestamps={includeTimestamps}
              onTranscriptChange={setEditedTranscript}
            />
          )}
        </main>

        <footer className="text-center mt-16 text-slate-700 text-xs">
          Powered by faster-whisper · Runs entirely on your machine · No data leaves your device
        </footer>
      </div>
    </div>
  )
}
