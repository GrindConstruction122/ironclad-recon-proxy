import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-04-22.dahlia',
})

export async function POST(request: NextRequest) {
  try {
    const { promoCode } = await request.json()

    if (!promoCode || typeof promoCode !== 'string' || !promoCode.trim()) {
      return NextResponse.json({ error: 'No promo code provided.' }, { status: 400 })
    }

    const promoCodes = await stripe.promotionCodes.list({
      code: promoCode.trim().toUpperCase(),
      active: true,
      limit: 1,
    })

    if (promoCodes.data.length === 0) {
      return NextResponse.json({ error: 'Invalid or expired promo code.' }, { status: 400 })
    }

    return NextResponse.json({
      valid: true,
      discountDescription: 'Discount applied',
      promotionCodeId: promoCodes.data[0].id,
    })
  } catch (err: any) {
    console.error('Promo validation error:', err)
    return NextResponse.json({ error: 'Could not validate promo code.' }, { status: 500 })
  }
}