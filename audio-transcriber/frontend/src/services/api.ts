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
