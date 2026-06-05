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
      expand: ['data.coupon'],
    })

    if (promoCodes.data.length === 0) {
      return NextResponse.json({ error: 'Invalid or expired promo code.' }, { status: 400 })
    }

    const promo = promoCodes.data[0]
    const coupon = (promo as any).coupon as {
      percent_off?: number | null
      amount_off?: number | null
      currency?: string | null
      duration?: string
      duration_in_months?: number | null
    }

    let discountDescription = 'Discount applied'
    if (coupon.percent_off) {
      discountDescription = `${coupon.percent_off}% off`
    } else if (coupon.amount_off && coupon.currency) {
      discountDescription = `$${(coupon.amount_off / 100).toFixed(2)} off`
    }
    if (coupon.duration === 'once') {
      discountDescription += ' (first month)'
    } else if (coupon.duration === 'repeating' && coupon.duration_in_months) {
      discountDescription += ` for ${coupon.duration_in_months} months`
    } else if (coupon.duration === 'forever') {
      discountDescription += ' forever'
    }

    return NextResponse.json({
      valid: true,
      discountDescription,
      promotionCodeId: promo.id,
    })
  } catch (err: any) {
    console.error('Promo validation error:', err)
    return NextResponse.json({ error: 'Could not validate promo code.' }, { status: 500 })
  }
}