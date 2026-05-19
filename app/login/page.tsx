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
    <div className="min-h-screen bg-[#061E45] text-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm">

        {/* Logo — centered, big */}
        <div className="flex flex-col items-center mb-10">
          <img
            src="/grind-recon-logo.png"
            alt="GRIND RECON"
            style={{ width: 200, height: 200, objectFit: 'contain', marginBottom: '1rem' }}
          />
          <p style={{
            color: '#7F9DB1',
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            textAlign: 'center',
            margin: 0,
          }}>
            // KNOW WHAT YOU'RE WALKING INTO — BEFORE YOU BID IT //
          </p>
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
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-[#3D4EAC] transition-colors"
              />
            </div>
            {error && (
              <p className="text-red-400 text-sm mb-4">{error}</p>
            )}
            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors"
              style={{ background: '#3D4EAC' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#003B66')}
              onMouseLeave={e => (e.currentTarget.style.background = '#3D4EAC')}
            >
              {loading ? 'Sending...' : 'Send login link'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}