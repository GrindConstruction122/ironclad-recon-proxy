'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Run {
  id: string
  created_at: string
  project_name: string
  status: string
  hard_stop_count: number
  flag_count: number
  m17_status: string
}

interface Subscription {
  status: string
  plan: string
  current_period_end: string
  stripe_customer_id: string
  token_limit: number
  tokens_used: number
  tokens_banked: number
}

interface Props {
  user: { email: string; id: string }
  subscription: Subscription
  runs: Run[]
}

const planLabels: Record<string, string> = {
  breach:   'RECON Breach',
  tactical: 'RECON Tactical',
  command:  'RECON Command',
}

const m17Colors: Record<string, string> = {
  CLEARED: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  LOCKED:  'text-red-400 bg-red-400/10 border-red-400/20',
  PENDING: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return n.toString()
}

export default function DashboardClient({ user, subscription, runs }: Props) {
  const [signingOut,   setSigningOut]   = useState(false)
  const [buyingTopUp,  setBuyingTopUp]  = useState(false)
  const [topUpMessage, setTopUpMessage] = useState<string | null>(null)
  const router = useRouter()

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function handleSignOut() {
    setSigningOut(true)
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function handleTopUp() {
    setBuyingTopUp(true)
    setTopUpMessage(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      const response = await fetch('/api/topup', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      window.location.href = data.url
    } catch (err: any) {
      setTopUpMessage(err.message || 'Something went wrong.')
      setBuyingTopUp(false)
    }
  }

  const tokensAvailable = subscription.token_limit - subscription.tokens_used
  const tokenPct        = Math.min(100, Math.round((subscription.tokens_used / subscription.token_limit) * 100))
  const tokensLow       = tokenPct >= 80
  const tokensDepleted  = tokensAvailable <= 0 && (subscription.tokens_banked || 0) <= 0
  const totalAvailable  = tokensAvailable + (subscription.tokens_banked || 0)

  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—'

  return (
    <div className="min-h-screen bg-[#111827] text-white">
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-[#1E40AF] rounded flex items-center justify-center">
            <span className="text-xs font-black">IC</span>
          </div>
          <span className="font-bold tracking-widest text-sm uppercase text-white/70">IRONCLAD RECON</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-white/40 text-sm hidden md:block">{user.email}</span>
          <button onClick={handleSignOut} disabled={signingOut}
            className="text-sm text-white/40 hover:text-white transition-colors disabled:opacity-30">
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-black tracking-tight mb-1">Dashboard</h1>
            <p className="text-white/40 text-sm">{planLabels[subscription.plan] || subscription.plan} · Renews {periodEnd}</p>
          </div>
          <Link href="/run"
            className={`font-bold text-sm px-5 py-2.5 rounded-lg transition-colors tracking-wide ${
              tokensDepleted ? 'bg-white/10 text-white/30 cursor-not-allowed pointer-events-none' : 'bg-[#1E40AF] hover:bg-[#1d3aaa] text-white'
            }`}>
            + New Run
          </Link>
        </div>

        <div className={`rounded-xl border p-6 mb-8 ${
          tokensDepleted ? 'border-red-500/30 bg-red-900/10' :
          tokensLow      ? 'border-yellow-500/30 bg-yellow-900/10' :
                           'border-white/10 bg-white/5'
        }`}>
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-white/40 mb-1">Token Usage This Month</p>
              <p className="text-2xl font-black">
                {formatTokens(subscription.tokens_used)}
                <span className="text-white/30 text-base font-normal"> / {formatTokens(subscription.token_limit)}</span>
              </p>
              {(subscription.tokens_banked || 0) > 0 && (
                <p className="text-xs text-[#1E40AF] mt-1 font-bold">+ {formatTokens(subscription.tokens_banked)} banked from Top-Up</p>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              {tokensDepleted ? (
                <div>
                  <p className="text-red-400 text-xs font-bold mb-2">Tokens exhausted</p>
                  <button onClick={handleTopUp} disabled={buyingTopUp}
                    className="bg-[#1E40AF] hover:bg-[#1d3aaa] text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors disabled:opacity-40">
                    {buyingTopUp ? 'Redirecting...' : 'Buy 100K Tokens — $15'}
                  </button>
                </div>
              ) : tokensLow ? (
                <div>
                  <p className="text-yellow-400 text-xs font-bold mb-2">Running low</p>
                  <button onClick={handleTopUp} disabled={buyingTopUp}
                    className="bg-white/10 hover:bg-white/20 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors disabled:opacity-40">
                    {buyingTopUp ? 'Redirecting...' : 'Top-Up 100K — $15'}
                  </button>
                </div>
              ) : (
                <p className="text-white/40 text-sm">{formatTokens(totalAvailable)} remaining</p>
              )}
            </div>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${
              tokensDepleted ? 'bg-red-500' : tokensLow ? 'bg-yellow-500' : 'bg-[#1E40AF]'
            }`} style={{ width: `${tokenPct}%` }} />
          </div>
          <p className="text-white/30 text-xs mt-2">{tokenPct}% used · Resets {periodEnd}</p>
          {topUpMessage && <p className="text-red-400 text-sm mt-3">{topUpMessage}</p>}
        </div>

        <div className="grid grid-cols-3 gap-4 mb-10">
          {[
            { label: 'Total Runs',        value: runs.length },
            { label: 'M17 Cleared',       value: runs.filter(r => r.m17_status === 'CLEARED').length },
            { label: 'Hard Stops Caught', value: runs.reduce((sum, r) => sum + (r.hard_stop_count || 0), 0) },
          ].map((stat) => (
            <div key={stat.label} className="bg-white/5 border border-white/10 rounded-xl p-5">
              <p className="text-3xl font-black mb-1">{stat.value}</p>
              <p className="text-white/40 text-xs tracking-wide uppercase">{stat.label}</p>
            </div>
          ))}
        </div>

        <div>
          <h2 className="text-xs font-bold tracking-[0.2em] uppercase text-white/40 mb-4">Recent Runs</h2>
          {runs.length === 0 ? (
            <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center">
              <p className="text-white/30 text-sm mb-4">No runs yet.</p>
              <Link href="/run" className="bg-[#1E40AF] hover:bg-[#1d3aaa] text-white font-bold text-sm px-5 py-2.5 rounded-lg transition-colors">
                Run your first project →
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <div key={run.id} className="bg-white/5 border border-white/10 rounded-xl px-5 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-sm">{run.project_name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <p className="text-white/30 text-xs">
                          {new Date(run.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        {run.hard_stop_count > 0 && <span className="text-xs text-red-400">{run.hard_stop_count} hard stop{run.hard_stop_count > 1 ? 's' : ''}</span>}
                        {run.flag_count > 0 && <span className="text-xs text-yellow-400">{run.flag_count} flag{run.flag_count > 1 ? 's' : ''}</span>}
                      </div>
                    </div>
                    {run.m17_status && (
                      <span className={`text-xs font-bold px-2.5 py-1 rounded border tracking-wider ${m17Colors[run.m17_status] || m17Colors.PENDING}`}>
                        M17 {run.m17_status}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}