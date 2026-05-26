'use client'
import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <img src="/grind-recon-logo.png" alt="GRIND RECON" style={{ width: 80, height: 80, objectFit: 'contain', marginBottom: 16 }} />
          <div style={{ fontWeight: 900, fontSize: '1.6rem', letterSpacing: 5, textTransform: 'uppercase', color: '#ffffff' }}>
            GRIND <span style={{ color: '#3D4EAC' }}>RECON</span>
          </div>
          <div style={{ fontSize: '0.6rem', letterSpacing: 3, textTransform: 'uppercase', color: '#7F9DB1', marginTop: 6 }}>
            // KNOW WHAT YOU'RE WALKING INTO //
          </div>
        </div>

        <div style={{ background: '#0d0d0d', border: '1px solid #003B66', borderRadius: 6, padding: 32 }}>
          <div style={{ fontWeight: 800, fontSize: '1rem', letterSpacing: 3, textTransform: 'uppercase', color: '#C3E3EB', marginBottom: 24, textAlign: 'center' }}>
            {isSignUp ? 'CREATE ACCOUNT' : 'SIGN IN'}
          </div>

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

          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#7F9DB1', display: 'block', marginBottom: 6 }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              style={{ width: '100%', background: '#000000', border: '1px solid #003B66', borderRadius: 4, padding: '12px 14px', color: '#f0f6ff', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
            />
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