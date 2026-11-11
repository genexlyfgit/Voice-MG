import React, { useState } from 'react'
import { toast } from 'sonner'
import { Mail, Lock, Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react'

interface Props {
  onLogin: (email: string) => void
}

const VALID_EMAIL = 'admin@gentranscribe.com'
const VALID_PASSWORD = 'admin123'

const Login: React.FC<Props> = ({ onLogin }) => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (email.trim().toLowerCase() !== VALID_EMAIL || password !== VALID_PASSWORD) {
      setError('Invalid email or password.')
      toast.error('Invalid email or password.')
      return
    }

    setSubmitting(true)
    setTimeout(() => {
      setSubmitting(false)
      toast.success('Signed in successfully.')
      onLogin(email)
    }, 500)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-10 relative overflow-hidden">
      {/* Ambient color wash tying back to the brand mark */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_70%_45%_at_15%_-10%,rgba(99,102,241,0.10),transparent),radial-gradient(ellipse_60%_40%_at_100%_0%,rgba(20,184,166,0.08),transparent)]" />

      <div className="relative z-10 w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <img src="/logo-full.png" alt="GenTranscribe" className="h-12 w-auto object-contain" />
        </div>

        <div className="card-flat p-7 shadow-xl shadow-slate-200/60">
          <h1 className="text-xl font-bold text-slate-900 text-center">Welcome back</h1>
          <p className="text-sm text-slate-500 text-center mt-1 mb-6">Sign in to access your transcription dashboard</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="input-base pl-10 text-sm"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input-base pl-10 pr-10 text-sm"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 text-slate-500 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                Remember me
              </label>
              <a href="#" className="text-brand-600 hover:text-brand-700 font-medium">Forgot password?</a>
            </div>

            <button
              id="login-submit-btn"
              type="submit"
              disabled={submitting}
              className="w-full py-3 text-sm justify-center inline-flex items-center gap-2 font-semibold rounded-xl
                         bg-gradient-to-r from-brand-600 to-violet-600 hover:from-brand-500 hover:to-violet-500
                         text-white shadow-lg shadow-brand-600/25 hover:shadow-brand-600/35 transition-all duration-200
                         disabled:opacity-60 disabled:cursor-not-allowed
                         focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          GenTranscribe AI · Secure access for authorized users only
        </p>
      </div>
    </div>
  )
}

export default Login
