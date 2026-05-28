'use client'
import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function handleSubmit() {
    setLoading(true)
    setError(null)
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setError('Account created — you can now sign in.')
        setIsSignUp(false)
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        router.push('/run')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#000814', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 420, padding: '0 24px' }}>

        {/* HEADER */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <img
            src="/Recon.png"
            alt="GRIND RECON"
            style={{ width: 140, height: 140, objectFit: 'contain', display: 'block', margin: '0 auto 16px auto' }}
          />
          <div style={{ fontWeight: 900, fontSize: '0.85rem', letterSpacing: 3, textTransform: 'uppercase', color: '#C3E3EB' }}>
            "KNOW WHAT YOU'RE WALKING INTO"
          </div>
        </div>

        <div style={{ background: '#0d0d0d', border: '1px solid #003B66', borderRadius: 6, padding: 32 }}>
          <div style={{ fontWeight: 800, fontSize: '1rem', letterSpacing: 3, textTransform: 'uppercase', color: '#C3E3EB', marginBottom: 24, textAlign: 'center' }}>
            {isSignUp ? 'CREATE ACCOUNT' : 'SIGN IN'}
          </div>

          {/* EMAIL */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#7F9DB1', display: 'block', marginBottom: 6 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              style={{ width: '100%', background: '#000000', border: '1px solid #003B66', borderRadius: 4, padding: '12px 14px', color: '#f0f6ff', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {/* PASSWORD with eyeball */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#7F9DB1', display: 'block', marginBottom: 6 }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                style={{ width: '100%', background: '#000000', border: '1px solid #003B66', borderRadius: 4, padding: '12px 44px 12px 14px', color: '#f0f6ff', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#7F9DB1', display: 'flex', alignItems: 'center' }}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div style={{ background: 'rgba(61,78,172,0.1)', border: '1px solid rgba(61,78,172,0.3)', color: '#C3E3EB', fontSize: '0.8rem', padding: '10px 14px', borderRadius: 4, marginBottom: 16 }}>
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{ width: '100%', background: '#3D4EAC', border: 'none', color: '#ffffff', fontWeight: 900, fontSize: '0.85rem', letterSpacing: 3, textTransform: 'uppercase', padding: '14px', borderRadius: 4, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? '...' : isSignUp ? 'CREATE ACCOUNT' : 'SIGN IN'}
          </button>

          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button
              onClick={() => { setIsSignUp(!isSignUp); setError(null) }}
              style={{ background: 'none', border: 'none', color: '#7F9DB1', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}
            >
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}