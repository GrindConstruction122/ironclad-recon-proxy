'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

const plans = [
  {
    id: 'breach',
    name: 'RECON Breach',
    price: 49,
    priceId: process.env.NEXT_PUBLIC_STRIPE_BREACH_PRICE_ID,
    description: 'Solo estimator. Entry-level forensic review.',
    tokens: '100,000 tokens/month',
    features: [
      '100,000 tokens per month',
      'Full 17-module forensic audit',
      'Hard stop enforcement',
      'PDF export',
      '30-day run history',
      'Email support',
    ],
    highlight: false,
    cta: 'Start with Breach',
  },
  {
    id: 'tactical',
    name: 'RECON Tactical',
    price: 149,
    priceId: process.env.NEXT_PUBLIC_STRIPE_TACTICAL_PRICE_ID,
    description: 'Active estimating teams. Full audit capability.',
    tokens: '400,000 tokens/month',
    features: [
      '400,000 tokens per month',
      'Full 17-module forensic audit',
      'Hard stop enforcement',
      'PDF + TXT export',
      '1-year run history',
      'Submittal Checker access',
      'Priority support',
    ],
    highlight: true,
    cta: 'Start with Tactical',
  },
  {
    id: 'command',
    name: 'RECON Command',
    price: 299,
    priceId: process.env.NEXT_PUBLIC_STRIPE_COMMAND_PRICE_ID,
    description: 'Preconstruction teams. Maximum capacity.',
    tokens: '1,000,000 tokens/month',
    features: [
      '1,000,000 tokens per month',
      'Full 17-module forensic audit',
      'Hard stop enforcement',
      'All export formats',
      'Unlimited run history',
      'All add-on modules',
      'Multi-user access',
      'Dedicated support',
    ],
    highlight: false,
    cta: 'Start with Command',
  },
]

export default function PricingPage() {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function handleSubscribe(planId: string, priceId: string | undefined) {
    if (!priceId) { setError('Price configuration error. Contact support.'); return }
    setLoading(planId)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { window.location.href = '/login'; return }
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ priceId, planId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Checkout failed')
      window.location.href = data.url
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Try again.')
      setLoading(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#111827] text-white">
      <div className="border-b border-white/10 px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#1E40AF] rounded flex items-center justify-center">
            <span className="text-xs font-black tracking-wider">IC</span>
          </div>
          <span className="font-bold tracking-widest text-sm uppercase text-white/80">IRONCLAD RECON</span>
        </div>
        <a href="/login" className="text-sm text-white/50 hover:text-white transition-colors">Already have an account →</a>
      </div>

      <div className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
        <p className="text-[#1E40AF] text-xs font-bold tracking-[0.25em] uppercase mb-4">GRIND Construction Services LLC</p>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4 leading-tight">
          Know What You're Walking Into.<br />
          <span className="text-[#1E40AF]">Before You Bid It.</span>
        </h1>
        <p className="text-white/50 text-lg max-w-xl mx-auto">
          IRONCLAD RECON catches missed scope, unsupported quantities, and bid errors before they cost you money.
        </p>
      </div>

      <div className="max-w-5xl mx-auto px-6 pb-16 grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <div key={plan.id} className={`relative rounded-xl border p-8 flex flex-col ${plan.highlight ? 'border-[#1E40AF] bg-[#1E40AF]/10' : 'border-white/10 bg-white/5'}`}>
            {plan.highlight && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-[#1E40AF] text-white text-xs font-bold px-3 py-1 rounded-full tracking-widest uppercase">Most Popular</span>
              </div>
            )}
            <div className="mb-6">
              <h2 className="font-black text-lg tracking-tight mb-1">{plan.name}</h2>
              <p className="text-white/50 text-sm leading-snug">{plan.description}</p>
            </div>
            <div className="mb-2">
              <span className="text-4xl font-black">${plan.price}</span>
              <span className="text-white/40 text-sm ml-1">/month</span>
            </div>
            <div className="mb-8">
              <span className="text-xs font-bold text-[#1E40AF] tracking-widest uppercase">{plan.tokens}</span>
            </div>
            <ul className="space-y-3 mb-10 flex-1">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <span className="text-[#1E40AF] mt-0.5 flex-shrink-0">✓</span>
                  <span className="text-white/70">{feature}</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => handleSubscribe(plan.id, plan.priceId)}
              disabled={loading !== null}
              className={`w-full py-3 rounded-lg font-bold text-sm tracking-wide transition-all ${plan.highlight ? 'bg-[#1E40AF] hover:bg-[#1d3aaa] text-white' : 'bg-white/10 hover:bg-white/20 text-white'} disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {loading === plan.id ? 'Redirecting...' : plan.cta}
            </button>
          </div>
        ))}
      </div>

      <div className="max-w-5xl mx-auto px-6 pb-24">
        <div className="border border-white/10 bg-white/5 rounded-xl px-8 py-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <p className="font-black text-sm tracking-wide mb-1">Hit your token limit?</p>
            <p className="text-white/50 text-sm">Token Top-Up adds 100,000 tokens for $15 — one-time, no commitment. Available from your dashboard.</p>
          </div>
          <div className="flex-shrink-0 text-right">
            <div><span className="text-2xl font-black">$15</span><span className="text-white/40 text-sm ml-1">one-time</span></div>
            <div className="text-xs text-[#1E40AF] font-bold tracking-widest mt-1">100,000 TOKENS</div>
          </div>
        </div>
      </div>

      {error && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-900/90 border border-red-500/40 text-red-200 text-sm px-5 py-3 rounded-lg">{error}</div>
      )}

      <div className="border-t border-white/10 py-8 text-center text-white/30 text-xs tracking-wider">
        IRONCLAD RECON · GRIND Construction Services LLC · Newburgh, NY
      </div>
    </div>
  )
}
