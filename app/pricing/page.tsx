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
    tokens: '200,000 tokens/month',
    features: [
      '200,000 tokens per month',
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
  const [promoCode, setPromoCode] = useState('')
  const [promoApplied, setPromoApplied] = useState(false)
  const [promoError, setPromoError] = useState<string | null>(null)
  const [promoChecking, setPromoChecking] = useState(false)
  const [discountDescription, setDiscountDescription] = useState<string | null>(null)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function handleApplyPromo() {
    const code = promoCode.trim().toUpperCase()
    if (!code) return
    setPromoChecking(true)
    setPromoError(null)
    setPromoApplied(false)
    setDiscountDescription(null)

    try {
      const response = await fetch('/api/checkout/validate-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promoCode: code }),
      })
      const data = await response.json()

      if (!response.ok) {
        setPromoError(data.error || 'Invalid promo code.')
      } else {
        setPromoApplied(true)
        setPromoError(null)
        setDiscountDescription(data.discountDescription || 'Discount applied')
      }
    } catch {
      setPromoError('Could not validate promo code. Try again.')
    } finally {
      setPromoChecking(false)
    }
  }

  function handlePromoKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleApplyPromo()
  }

  function handlePromoChange(e: React.ChangeEvent<HTMLInputElement>) {
    setPromoCode(e.target.value.toUpperCase())
    setPromoApplied(false)
    setPromoError(null)
    setDiscountDescription(null)
  }

  async function handleSubscribe(planId: string, priceId: string | undefined) {
    if (!priceId) { setError('Price configuration error. Contact support.'); return }
    setLoading(planId)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { window.location.href = '/login'; return }

      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          priceId,
          planId,
          promoCode: promoApplied ? promoCode.trim().toUpperCase() : undefined,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        if (data.error?.toLowerCase().includes('promo')) {
          setPromoApplied(false)
          setPromoError(data.error)
        } else {
          setError(data.error || 'Checkout failed')
        }
        setLoading(null)
        return
      }

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
          <div className="w-8 h-8 bg-[#3D4EAC] rounded flex items-center justify-center">
            <span className="text-xs font-black tracking-wider">GR</span>
          </div>
          <span className="font-bold tracking-widest text-sm uppercase text-white/80">GRIND RECON</span>
        </div>
        <a href="/login" className="text-sm text-white/50 hover:text-white transition-colors">
          Already have an account &rarr;
        </a>
      </div>

      <div className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
        <p className="text-[#3D4EAC] text-xs font-bold tracking-[0.25em] uppercase mb-4">
          GRIND Construction Services LLC
        </p>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4 leading-tight">
          Know What You&apos;re Walking Into.<br />
          <span className="text-[#3D4EAC]">Before You Bid It.</span>
        </h1>
        <p className="text-white/50 text-lg max-w-xl mx-auto">
          GRIND RECON catches missed scope, unsupported quantities, and bid errors before they cost you money.
        </p>
      </div>

      <div className="max-w-sm mx-auto px-6 pb-10">
        <p className="text-xs text-white/40 font-bold tracking-widest uppercase text-center mb-3">
          Have a promo code?
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={promoCode}
            onChange={handlePromoChange}
            onKeyDown={handlePromoKeyDown}
            placeholder="ENTER CODE"
            maxLength={32}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm font-bold tracking-widest text-white placeholder:text-white/20 focus:outline-none focus:border-[#3D4EAC] transition-colors uppercase"
          />
          <button
            onClick={handleApplyPromo}
            disabled={!promoCode.trim() || promoChecking}
            className="px-4 py-2.5 bg-[#3D4EAC] hover:bg-[#3344aa] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-black tracking-widest uppercase rounded-lg transition-colors"
          >
            {promoChecking ? '...' : 'Apply'}
          </button>
        </div>

        {promoApplied && (
          <div className="mt-2 flex items-center gap-2 text-sm text-emerald-400 font-bold">
            <span>&#10003;</span>
            <span>{discountDescription} &mdash; applied at checkout.</span>
          </div>
        )}
        {promoError && (
          <div className="mt-2 text-sm text-red-400 font-bold">
            {promoError}
          </div>
        )}
      </div>

      <div className="max-w-5xl mx-auto px-6 pb-16 grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`relative rounded-xl border p-8 flex flex-col ${
              plan.highlight
                ? 'border-[#3D4EAC] bg-[#3D4EAC]/10'
                : 'border-white/10 bg-white/5'
            }`}
          >
            {plan.highlight && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="bg-[#3D4EAC] text-white text-xs font-bold px-3 py-1 rounded-full tracking-widest uppercase">
                  Most Popular
                </span>
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
              <span className="text-xs font-bold text-[#3D4EAC] tracking-widest uppercase">
                {plan.tokens}
              </span>
            </div>

            <ul className="space-y-3 mb-10 flex-1">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <span className="text-[#3D4EAC] mt-0.5 flex-shrink-0">&#10003;</span>
                  <span className="text-white/70">{feature}</span>
                </li>
              ))}
            </ul>

            {promoApplied && (
              <div className="mb-3 text-xs text-emerald-400 font-bold tracking-wide text-center">
                &#10003; Promo applied
              </div>
            )}

            <button
              onClick={() => handleSubscribe(plan.id, plan.priceId)}
              disabled={loading !== null}
              className={`w-full py-3 rounded-lg font-bold text-sm tracking-wide transition-all ${
                plan.highlight
                  ? 'bg-[#3D4EAC] hover:bg-[#3344aa] text-white'
                  : 'bg-white/10 hover:bg-white/20 text-white'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
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
            <p className="text-white/50 text-sm">
              Token Top-Up adds 100,000 tokens for $15 &mdash; one-time, no commitment. Available from your dashboard.
            </p>
          </div>
          <div className="flex-shrink-0 text-right">
            <div>
              <span className="text-2xl font-black">$15</span>
              <span className="text-white/40 text-sm ml-1">one-time</span>
            </div>
            <div className="text-xs text-[#3D4EAC] font-bold tracking-widest mt-1">100,000 TOKENS</div>
          </div>
        </div>
      </div>

      {error && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-900/90 border border-red-500/40 text-red-200 text-sm px-5 py-3 rounded-lg z-50">
          {error}
        </div>
      )}

      <div className="border-t border-white/10 py-8 text-center text-white/30 text-xs tracking-wider">
        GRIND RECON &copy; GRIND Construction Services LLC &copy; Newburgh, NY
      </div>
    </div>
  )
}