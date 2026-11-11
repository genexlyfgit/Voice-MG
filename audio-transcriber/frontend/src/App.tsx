import { useEffect, useState } from 'react'
import { Toaster, toast } from 'sonner'
import {
  Mic2, Settings2, Clock, LayoutDashboard, History,
  FileAudio2, CheckCircle2, Cpu, Menu, X, LogOut,
  Upload, Globe2,
} from 'lucide-react'
import AudioUpload from './components/AudioUpload'
import LanguageSelector from './components/LanguageSelector'
import StatusPanel from './components/StatusPanel'
import TranscriptViewer from './components/TranscriptViewer'
import Login from './components/Login'
import HistoryPanel from './components/HistoryPanel'
import {
  healthCheck, getLanguages, submitTranscription, getJobStatus,
  type Language, type JobStatus, type TranscribeOptions,
} from './services/api'

const AUTH_STORAGE_KEY = 'gt_auth_email'

type AppStatus = 'idle' | 'uploading' | 'queued' | 'processing' | 'done' | 'error'
type Tab = 'files' | 'language' | 'settings' | 'history'

const POLL_INTERVAL_MS = 1000
const MODELS = ['gemini-3.5-transcribe', 'large-v3', 'large-v2', 'medium', 'small', 'base', 'tiny']
const MODEL_LABELS: Record<string, string> = {
  'gemini-3.5-transcribe': 'GenTranscribe Cloud (recommended)',
  'large-v3': 'large-v3',
  'large-v2': 'large-v2',
  medium: 'medium',
  small: 'small',
  base: 'base',
  tiny: 'tiny',
}
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

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}m ${s}s`
}

export default function App() {
  // auth
  const [userEmail, setUserEmail] = useState<string | null>(() => localStorage.getItem(AUTH_STORAGE_KEY))

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

  // ui
  const [activeTab, setActiveTab] = useState<Tab>('files')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // settings
  const [model, setModel] = useState('gemini-3.5-transcribe')
  const [computeType, setComputeType] = useState('int8')
  const [beamSize, setBeamSize] = useState(1)
  const [vadFilter, setVadFilter] = useState(true)
  const [includeTimestamps, setIncludeTimestamps] = useState(true)

  // ---- Backend health check ----
  useEffect(() => {
    let prev: boolean | null = null
    const check = async () => {
      try {
        const res = await healthCheck()
        setBackendOk(true)
        setDevice(res.data.device)
        if (prev === false) toast.success('Backend connection restored.')
        prev = true
      } catch {
        setBackendOk(false)
        if (prev !== false) toast.error('Lost connection to the backend server.')
        prev = false
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
  const pollJob = (jobId: string, index: number): Promise<boolean> => {
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
            resolve(true)
          } else if (job.status === 'error') {
            clearInterval(interval)
            updateJob(index, { status: 'error', message: job.message })
            toast.error(`Transcription failed: ${job.message}`)
            resolve(false)
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
          resolve(false)
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

    let succeeded = 0
    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i].status === 'done') { succeeded++; continue } // skip already-completed files on retry
      setActiveIndex(i)
      updateJob(i, { status: 'uploading', message: 'Uploading audio file…', uploadPercent: 0, transcribePercent: 0 })

      try {
        const res = await submitTranscription(jobs[i].file, options, (pct) => {
          updateJob(i, { uploadPercent: pct })
        })
        const { job_id } = res.data
        updateJob(i, { status: 'queued', message: 'Job queued — waiting for the model…' })
        if (await pollJob(job_id, i)) succeeded++
      } catch (e: unknown) {
        const err = e as { response?: { data?: { detail?: string } }; message?: string }
        const detail = err?.response?.data?.detail ?? err?.message ?? 'Upload failed'
        updateJob(i, { status: 'error', message: detail })
        toast.error(`${jobs[i].file.name}: ${detail}`)
      }
    }

    if (succeeded > 0) {
      toast.success(`Transcribed ${succeeded} file${succeeded > 1 ? 's' : ''} successfully.`)
    }

    setBatchRunning(false)
    setActiveIndex(null)
  }

  const isRunning = batchRunning
  const canTranscribe = jobs.length > 0 && backendOk === true && !isRunning
  const activeJob = activeIndex !== null ? jobs[activeIndex] : null
  const doneCount = jobs.filter((j) => j.status === 'done').length
  const errorCount = jobs.filter((j) => j.status === 'error').length
  const totalProcessingSecs = jobs.reduce((sum, j) => sum + (j.processingSeconds ?? 0), 0)
  const avgProcessingSecs = doneCount > 0 ? totalProcessingSecs / doneCount : 0

  const TABS: { id: Tab; label: string; icon: typeof Upload }[] = [
    { id: 'files', label: 'Audio Files', icon: Upload },
    { id: 'language', label: 'Language', icon: Globe2 },
    { id: 'settings', label: 'Settings', icon: Settings2 },
    { id: 'history', label: 'History', icon: History },
  ]

  const NAV_ITEMS: { id: Tab; label: string; icon: typeof Upload; match: Tab[] }[] = [
    { id: 'files', label: 'Dashboard', icon: LayoutDashboard, match: ['files', 'language'] },
    { id: 'history', label: 'History', icon: History, match: ['history'] },
    { id: 'settings', label: 'Settings', icon: Settings2, match: ['settings'] },
  ]

  const NavLinks = () => (
    <nav className="flex-1 px-3 py-5 space-y-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon
        const active = item.match.includes(activeTab)
        return (
          <button
            key={item.id}
            onClick={() => { setActiveTab(item.id); setSidebarOpen(false) }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors
              ${active
                ? 'bg-gradient-to-r from-brand-600 to-violet-600 text-white shadow-md shadow-brand-600/25'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}
          >
            <Icon className="w-4 h-4" />
            {item.label}
          </button>
        )
      })}
    </nav>
  )

  const handleLogin = (email: string) => {
    localStorage.setItem(AUTH_STORAGE_KEY, email)
    setUserEmail(email)
  }

  const handleLogout = () => {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    setUserEmail(null)
  }

  if (!userEmail) {
    return (
      <>
        <Toaster position="top-right" richColors closeButton />
        <Login onLogin={handleLogin} />
      </>
    )
  }

  return (
    <div className="min-h-screen lg:h-screen lg:overflow-hidden flex bg-slate-50">
      <Toaster position="top-right" richColors closeButton />
      {/* Ambient color wash tying back to the brand mark */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_70%_45%_at_15%_-10%,rgba(99,102,241,0.08),transparent),radial-gradient(ellipse_60%_40%_at_100%_0%,rgba(20,184,166,0.07),transparent)]" />

      {/* ---------------- Sidebar (desktop) ---------------- */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-slate-200 bg-white relative z-20">
        <div className="flex items-center px-5 h-20 border-b border-slate-200">
          <img src="/logo-full.png" alt="GenTranscribe" className="h-11 w-auto object-contain" />
        </div>

        <NavLinks />

        <div className="p-4 mx-3 mb-4 rounded-2xl bg-gradient-to-br from-brand-50 via-slate-50 to-teal-50 border border-slate-200">
          <div className="flex items-center gap-2 mb-1.5">
            <img src="/logo-icon.png" alt="" className="w-5 h-5 object-contain" />
            <p className="text-xs font-semibold text-slate-800">GenTranscribe AI</p>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            High-accuracy multilingual transcription with automatic translation.
          </p>
        </div>
      </aside>

      {/* ---------------- Sidebar (mobile drawer) ---------------- */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white border-r border-slate-200 flex flex-col animate-slide-up">
            <div className="flex items-center justify-between px-5 h-20 border-b border-slate-200">
              <img src="/logo-full.png" alt="GenTranscribe" className="h-9 w-auto object-contain" />
              <button onClick={() => setSidebarOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <NavLinks />
          </aside>
        </div>
      )}

      {/* ---------------- Main column ---------------- */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0 lg:h-screen">
        {/* Topbar */}
        <header className="h-20 shrink-0 border-b border-slate-200 bg-white/90 backdrop-blur flex items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 shrink-0"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <img src="/logo-icon.png" alt="" className="w-8 h-8 object-contain lg:hidden shrink-0" />
            <div className="min-w-0">
              <h1 className="text-slate-900 font-bold text-lg leading-tight">Dashboard</h1>
              <p className="hidden sm:block text-slate-500 text-xs mt-0.5">Upload audio and get studio-quality transcripts</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {backendOk !== null && (
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-medium
                ${backendOk ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                <span className={`status-dot ${backendOk ? 'bg-emerald-500 animate-pulse-slow' : 'bg-red-500'}`} />
                <span className="hidden xs:inline">{backendOk ? `Online · ${device}` : 'Offline'}</span>
              </div>
            )}
            <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-slate-200">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-brand-600 to-violet-600 text-white text-xs font-bold shrink-0">
                {userEmail.slice(0, 1).toUpperCase()}
              </div>
              <span className="text-xs text-slate-600 font-medium max-w-[140px] truncate">{userEmail}</span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Content: fills remaining viewport on desktop, scrolls naturally on mobile */}
        <main className="flex-1 min-h-0 flex flex-col px-4 sm:px-6 py-4 gap-4 overflow-y-auto lg:overflow-hidden">
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
            <div className="card-flat p-4 flex items-center gap-3.5 hover:shadow-md hover:shadow-slate-200/60 transition-shadow">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
                <FileAudio2 className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="min-w-0">
                <p className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide truncate">Queued</p>
                <p className="text-2xl font-bold text-slate-900 leading-tight">{jobs.length}</p>
              </div>
            </div>
            <div className="card-flat p-4 flex items-center gap-3.5 hover:shadow-md hover:shadow-slate-200/60 transition-shadow">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <p className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide truncate">Completed</p>
                <p className="text-2xl font-bold text-slate-900 leading-tight">{doneCount}<span className="text-slate-400 font-medium text-sm">/{jobs.length || 0}</span></p>
              </div>
            </div>
            <div className="card-flat p-4 flex items-center gap-3.5 hover:shadow-md hover:shadow-slate-200/60 transition-shadow">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide truncate">Avg. time</p>
                <p className="text-2xl font-bold text-slate-900 leading-tight">{avgProcessingSecs > 0 ? formatDuration(avgProcessingSecs) : '—'}</p>
              </div>
            </div>
            <div className="card-flat p-4 flex items-center gap-3.5 hover:shadow-md hover:shadow-slate-200/60 transition-shadow">
              <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
                <Cpu className="w-5 h-5 text-violet-600" />
              </div>
              <div className="min-w-0">
                <p className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide truncate">Compute</p>
                <p className="text-2xl font-bold text-slate-900 leading-tight capitalize">{device}</p>
              </div>
            </div>
          </div>

          {/* Workspace: left (tabs+content, scrolls internally) / right (run panel) */}
          <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
            {/* Left: tabbed workflow */}
            <div className="min-h-0 flex flex-col card-flat overflow-hidden shadow-sm">
              <div className="shrink-0 p-4 pb-0">
                <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100">
                  {TABS.map((t) => {
                    const Icon = t.icon
                    const active = activeTab === t.id
                    return (
                      <button
                        key={t.id}
                        onClick={() => setActiveTab(t.id)}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all
                          ${active
                            ? 'text-brand-700 bg-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-800'}`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {t.label}
                        {t.id === 'files' && jobs.length > 0 && (
                          <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] ${active ? 'bg-brand-50 text-brand-700' : 'bg-slate-200 text-slate-500'}`}>{jobs.length}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-5">
                {activeTab === 'files' && (
                  <AudioUpload
                    files={jobs.map((j) => j.file)}
                    onFilesAdd={addFiles}
                    onFileRemove={removeFile}
                    disabled={isRunning}
                  />
                )}

                {activeTab === 'language' && (
                  <div className="relative z-20">
                    <LanguageSelector
                      languages={languages}
                      selected={selectedLang}
                      onChange={setSelectedLang}
                      disabled={isRunning}
                    />
                    <p className="text-xs text-slate-400 mt-2">
                      Each file is transcribed and, if a language other than Auto-detect is picked, translated into
                      it — every file gets its own separate .txt output.
                    </p>
                  </div>
                )}

                {activeTab === 'settings' && (
                  <div className="space-y-5">
                    {/* Model */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
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
                          <option key={m} value={m}>{MODEL_LABELS[m] ?? m}</option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-400 mt-1">
                        {model.startsWith('gemini')
                          ? 'Runs on our cloud engine — fast, no local compute settings needed.'
                          : 'large-v3 gives best accuracy; tiny is fastest.'}
                      </p>
                    </div>

                    {!model.startsWith('gemini') && (
                      <>
                        {/* Compute type */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
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
                          <p className="text-xs text-slate-400 mt-1">int8 = fast CPU; float16 = GPU recommended.</p>
                        </div>

                        {/* Beam size */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
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
                          <p className="text-xs text-slate-400 mt-1">Higher = more accurate but slower.</p>
                        </div>
                      </>
                    )}

                    {/* Toggles */}
                    <div className="space-y-3">
                      <label id="vad-filter-label" className="flex items-center justify-between cursor-pointer group">
                        <div>
                          <p className="text-sm font-medium text-slate-700">Voice Activity Detection</p>
                          <p className="text-xs text-slate-400">Skip silent segments automatically</p>
                        </div>
                        <div className={`relative w-10 h-5 rounded-full transition-colors duration-200 shrink-0 ${vadFilter ? 'bg-brand-600' : 'bg-slate-200'}`}
                          onClick={() => !isRunning && setVadFilter((v) => !v)}>
                          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${vadFilter ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </div>
                      </label>

                      <label id="timestamps-label" className="flex items-center justify-between cursor-pointer group">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <p className="text-sm font-medium text-slate-700">Include Timestamps</p>
                          </div>
                          <p className="text-xs text-slate-400">Prepend [HH:MM:SS] to each segment</p>
                        </div>
                        <div className={`relative w-10 h-5 rounded-full transition-colors duration-200 shrink-0 ${includeTimestamps ? 'bg-brand-600' : 'bg-slate-200'}`}
                          onClick={() => !isRunning && setIncludeTimestamps((v) => !v)}>
                          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${includeTimestamps ? 'translate-x-5' : 'translate-x-0.5'}`} />
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                {activeTab === 'history' && <HistoryPanel />}

                {/* Per-file transcript results — shown under the Audio Files tab */}
                {activeTab === 'files' && jobs.some((j) => j.status === 'done' || j.status === 'error') && (
                  <div className="mt-5 space-y-4 border-t border-slate-200 pt-5">
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
                        <div key={`${job.file.name}-${i}`} className="card-flat p-4 border-red-200 bg-red-50/50">
                          <p className="text-sm font-semibold text-red-600">{job.file.name} failed</p>
                          <p className="text-xs text-slate-500 mt-1">{job.message}</p>
                        </div>
                      ) : null
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right: run panel */}
            <div className="min-h-0 flex flex-col gap-3 overflow-y-auto">
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

              <button
                id="transcribe-btn"
                onClick={handleTranscribeAll}
                disabled={!canTranscribe}
                className="w-full py-3 text-sm justify-center shrink-0 inline-flex items-center gap-2 font-semibold rounded-xl
                           bg-gradient-to-r from-brand-600 to-violet-600 hover:from-brand-500 hover:to-violet-500
                           text-white shadow-lg shadow-brand-600/25 hover:shadow-brand-600/35 transition-all duration-200
                           disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:from-brand-600 disabled:hover:to-violet-600
                           focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2"
              >
                {isRunning ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Processing {activeIndex !== null ? activeIndex + 1 : 0}/{jobs.length}…
                  </>
                ) : (
                  <>
                    <Mic2 className="w-4 h-4" />
                    Transcribe {jobs.length > 1 ? `${jobs.length} Files` : 'Audio'}
                  </>
                )}
              </button>

              {errorCount > 0 && (
                <div className="card-flat p-3 border-red-200 bg-red-50/50 flex items-center gap-2 shrink-0">
                  <span className="status-dot bg-red-500" />
                  <p className="text-xs text-red-600">{errorCount} file{errorCount > 1 ? 's' : ''} failed.</p>
                </div>
              )}

              <div className="card-flat p-4 hidden xl:block bg-gradient-to-br from-white to-slate-50">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-3">Quick tips</p>
                <ul className="space-y-2.5 text-xs text-slate-500">
                  <li className="flex gap-2.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1 shrink-0" />
                    Batch-upload multiple files — each gets its own transcript.
                  </li>
                  <li className="flex gap-2.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-500 mt-1 shrink-0" />
                    Auto-detect works great for mixed-language audio.
                  </li>
                  <li className="flex gap-2.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-500 mt-1 shrink-0" />
                    Enable timestamps for easier editing review.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
