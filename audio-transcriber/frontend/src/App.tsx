import { useEffect, useState } from 'react'
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

interface FileJob {
  file: File
  status: AppStatus
  message: string
  uploadPercent: number
  transcribePercent: number
  transcript: string
  editedTranscript: string
  originalTranscript: string
  englishTranscript: string
  comparison: JobStatus['comparison']
  segments: JobStatus['segments']
  detectedLanguage?: string
  durationSeconds?: number
  processingSeconds?: number
}

function makeJob(file: File): FileJob {
  return {
    file,
    status: 'idle',
    message: '',
    uploadPercent: 0,
    transcribePercent: 0,
    transcript: '',
    editedTranscript: '',
    originalTranscript: '',
    englishTranscript: '',
    comparison: undefined,
    segments: undefined,
    detectedLanguage: undefined,
    durationSeconds: undefined,
    processingSeconds: undefined,
  }
}

export default function App() {
  // files / per-file jobs
  const [jobs, setJobs] = useState<FileJob[]>([])
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [batchRunning, setBatchRunning] = useState(false)

  // languages
  const [languages, setLanguages] = useState<Language[]>([])
  const [selectedLang, setSelectedLang] = useState('auto')

  // backend health
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [device, setDevice] = useState('cpu')

  // settings
  const [showSettings, setShowSettings] = useState(false)
  const [model, setModel] = useState('gemini-3.5-transcribe')
  const [computeType, setComputeType] = useState('int8')
  const [beamSize, setBeamSize] = useState(1)
  const [vadFilter, setVadFilter] = useState(true)
  const [includeTimestamps, setIncludeTimestamps] = useState(true)

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

  const updateJob = (index: number, patch: Partial<FileJob>) => {
    setJobs((prev) => prev.map((j, i) => (i === index ? { ...j, ...patch } : j)))
  }

  // ---- File management ----
  const addFiles = (files: File[]) => {
    setJobs((prev) => [...prev, ...files.map(makeJob)])
  }

  const removeFile = (index: number) => {
    setJobs((prev) => prev.filter((_, i) => i !== index))
  }

  // ---- Poll a single job until done/error ----
  const pollJob = (jobId: string, index: number): Promise<void> => {
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        try {
          const res = await getJobStatus(jobId)
          const job = res.data
          updateJob(index, {
            message: job.message,
            transcribePercent: typeof job.progress === 'number' ? job.progress : 0,
          })
          if (job.status === 'done') {
            clearInterval(interval)
            updateJob(index, {
              status: 'done',
              transcribePercent: 100,
              transcript: job.transcript ?? '',
              editedTranscript: job.transcript ?? '',
              originalTranscript: job.original_transcript ?? '',
              englishTranscript: job.english_transcript ?? '',
              comparison: job.comparison,
              segments: job.segments,
              detectedLanguage: job.detected_language,
              durationSeconds: job.duration_seconds,
              processingSeconds: job.processing_seconds,
            })
            resolve()
          } else if (job.status === 'error') {
            clearInterval(interval)
            updateJob(index, { status: 'error', message: job.message })
            resolve()
          } else {
            updateJob(index, { status: job.status as AppStatus })
          }
        } catch (e: unknown) {
          const err = e as { response?: { data?: { detail?: string } }; message?: string }
          clearInterval(interval)
          updateJob(index, {
            status: 'error',
            message: err?.response?.data?.detail ?? 'Lost connection to backend',
          })
          resolve()
        }
      }, POLL_INTERVAL_MS)
    })
  }

  // ---- Transcribe all queued files, one at a time ----
  const handleTranscribeAll = async () => {
    if (jobs.length === 0 || !backendOk) return
    setBatchRunning(true)

    const options: TranscribeOptions = {
      language: selectedLang === 'auto' ? undefined : selectedLang,
      model,
      include_timestamps: includeTimestamps,
      beam_size: beamSize,
      vad_filter: vadFilter,
      compute_type: computeType,
    }

    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i].status === 'done') continue // skip already-completed files on retry
      setActiveIndex(i)
      updateJob(i, { status: 'uploading', message: 'Uploading audio file…', uploadPercent: 0, transcribePercent: 0 })

      try {
        const res = await submitTranscription(jobs[i].file, options, (pct) => {
          updateJob(i, { uploadPercent: pct })
        })
        const { job_id } = res.data
        updateJob(i, { status: 'queued', message: 'Job queued — waiting for the model…' })
        await pollJob(job_id, i)
      } catch (e: unknown) {
        const err = e as { response?: { data?: { detail?: string } }; message?: string }
        updateJob(i, {
          status: 'error',
          message: err?.response?.data?.detail ?? err?.message ?? 'Upload failed',
        })
      }
    }

    setBatchRunning(false)
    setActiveIndex(null)
  }

  const isRunning = batchRunning
  const canTranscribe = jobs.length > 0 && backendOk === true && !isRunning
  const activeJob = activeIndex !== null ? jobs[activeIndex] : null
  const doneCount = jobs.filter((j) => j.status === 'done').length

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
            Audio transcription powered by <span className="text-brand-400 font-medium">Gemini</span>
          </p>
        </header>

        <main className="space-y-5">
          {/* Upload card */}
          <section className="glass-card p-6">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-4">
              1 · Audio Files {jobs.length > 0 && <span className="text-slate-600 normal-case font-normal">({jobs.length} selected)</span>}
            </h2>
            <AudioUpload
              files={jobs.map((j) => j.file)}
              onFilesAdd={addFiles}
              onFileRemove={removeFile}
              disabled={isRunning}
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
            <p className="text-xs text-slate-600 mt-2">
              Each file is transcribed and, if a language other than Auto-detect is picked, translated into
              it — every file gets its own separate .txt output.
            </p>
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

          {/* Status panel — reflects the file currently being processed */}
          <StatusPanel
            status={activeJob ? activeJob.status : (jobs.length > 0 && doneCount === jobs.length ? 'done' : 'idle')}
            message={
              activeJob
                ? `File ${activeIndex! + 1}/${jobs.length}: ${activeJob.file.name} — ${activeJob.message}`
                : (jobs.length > 0 ? `${doneCount}/${jobs.length} files transcribed` : '')
            }
            uploadPercent={activeJob?.uploadPercent ?? 0}
            transcribePercent={activeJob?.transcribePercent ?? 0}
            detectedLanguage={activeJob?.detectedLanguage}
            durationSeconds={activeJob?.durationSeconds}
            processingSeconds={activeJob?.processingSeconds}
            backendOk={backendOk}
            device={device}
          />

          {/* Transcribe button */}
          <button
            id="transcribe-btn"
            onClick={handleTranscribeAll}
            disabled={!canTranscribe}
            className="btn-primary w-full py-4 text-base justify-center"
          >
            {isRunning ? (
              <>
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Processing {activeIndex !== null ? activeIndex + 1 : 0}/{jobs.length}…
              </>
            ) : (
              <>
                <Mic2 className="w-5 h-5" />
                Transcribe {jobs.length > 1 ? `${jobs.length} Files` : 'Audio'}
              </>
            )}
          </button>

          {/* Per-file transcript results */}
          {jobs.map((job, i) => (
            job.status === 'done' ? (
              <TranscriptViewer
                key={`${job.file.name}-${i}`}
                transcript={job.editedTranscript}
                originalTranscript={job.originalTranscript}
                englishTranscript={job.englishTranscript}
                comparison={job.comparison}
                segments={job.segments}
                filename={job.file.name}
                detectedLanguage={job.detectedLanguage}
                includeTimestamps={includeTimestamps}
                onTranscriptChange={(text) => updateJob(i, { editedTranscript: text })}
              />
            ) : job.status === 'error' ? (
              <div key={`${job.file.name}-${i}`} className="glass-card p-4 border border-red-900/40">
                <p className="text-sm font-semibold text-red-400">{job.file.name} failed</p>
                <p className="text-xs text-slate-500 mt-1">{job.message}</p>
              </div>
            ) : null
          ))}
        </main>

        <footer className="text-center mt-16 text-slate-700 text-xs">
          Powered by Gemini · Each file produces its own transcript
        </footer>
      </div>
    </div>
  )
}
