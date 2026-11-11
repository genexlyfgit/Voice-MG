import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000, // 30 s for upload; polling calls are short
})

export interface Language {
  code: string
  name: string
  nativeName: string
}

export interface TranscribeResponse {
  job_id: string
  status: string
  message: string
  progress?: number
}

export interface JobStatus {
  job_id: string
  status: 'queued' | 'processing' | 'done' | 'error'
  progress?: number
  message: string
  transcript?: string
  original_transcript?: string
  english_transcript?: string
  comparison?: Array<{ start: number; end: number; native: string; english: string }>
  detected_language?: string
  duration_seconds?: number
  processing_seconds?: number
  filename?: string
  segments?: Array<{ start: number; end: number; text: string }>
}

export interface TranscribeOptions {
  language?: string          // ISO-639-1 code or 'auto'
  model: string
  include_timestamps: boolean
  beam_size: number
  vad_filter: boolean
  compute_type: string
}

export const healthCheck = () =>
  api.get<{ status: string; model_loaded: boolean; device: string }>('/health')

export const getLanguages = () =>
  api.get<{ languages: Language[] }>('/languages')

export const submitTranscription = (
  file: File,
  options: TranscribeOptions,
  onUploadProgress?: (pct: number) => void,
) => {
  const form = new FormData()
  form.append('file', file)
  form.append('options', JSON.stringify(options))

  return api.post<TranscribeResponse>('/transcribe', form, {
    timeout: 0, // no timeout for upload
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onUploadProgress && e.total) {
        onUploadProgress(Math.round((e.loaded * 100) / e.total))
      }
    },
  })
}

export const getJobStatus = (jobId: string) =>
  api.get<JobStatus>(`/transcribe/${jobId}`)

export interface HistoryItem {
  id: string
  filename: string | null
  status: string
  language: string | null
  detected_language: string | null
  duration_seconds: number | null
  processing_seconds: number | null
  created_at: string
}

export const getHistory = (limit = 50) =>
  api.get<{ enabled: boolean; jobs: HistoryItem[] }>('/history', { params: { limit } })

export interface HistoryDetail {
  id: string
  filename: string | null
  status: string
  language: string | null
  detected_language: string | null
  transcript: string | null
  original_transcript: string | null
  english_transcript: string | null
  comparison: Array<{ start: number; end: number; native: string; english: string }> | null
  segments: Array<{ start: number; end: number; text: string }> | null
  duration_seconds: number | null
  processing_seconds: number | null
  created_at: string
}

export const getHistoryDetail = (jobId: string) =>
  api.get<HistoryDetail>(`/history/${jobId}`)
