'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function handleLogin() {
    if (!email.trim()) { setError('Enter your email address.'); return }
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSent(true)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#111827] text-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-10 justify-center">
          <div className="w-8 h-8 bg-[#1E40AF] rounded flex items-center justify-center">
            <span className="text-xs font-black">IC</span>
          </div>
          <span className="font-bold tracking-widest text-sm uppercase text-white/80">
            IRONCLAD RECON
          </span>
        </div>

        {sent ? (
          <div className="text-center">
            <p className="text-2xl font-black mb-3">Check your email</p>
            <p className="text-white/50 text-sm">
              We sent a login link to <span className="text-white">{email}</span>.
              Click it to sign in.
            </p>
          </div>
        ) : (
          <div>
            <h1 className="text-2xl font-black mb-2 text-center">Sign in</h1>
            <p className="text-white/40 text-sm text-center mb-8">
              Enter your email and we'll send you a link.
            </p>

            <div className="mb-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="you@company.com"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-[#1E40AF] transition-colors"
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm mb-4">{error}</p>
            )}

            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full bg-[#1E40AF] hover:bg-[#1d3aaa] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg transition-colors"
            >
              {loading ? 'Sending...' : 'Send login link'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}