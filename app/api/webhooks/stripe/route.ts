import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-04-22.dahlia',
})

const PLAN_TOKEN_LIMITS: Record<string, number> = {
  breach:   100_000,
  tactical: 400_000,
  command:  1_000_000,
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err: any) {
    console.error('Webhook signature failed:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = createServiceClient()

  try {
    switch (event.type) {

      case 'customer.subscription.created': {
        const sub = event.data.object as Stripe.Subscription
        const planId = sub.metadata.plan_id || getPlanFromPriceId(sub.items.data[0].price.id)
        const userId = sub.metadata.user_id
        if (!userId || !planId) break

        const periodStart = (sub as any).current_period_start
        const periodEnd   = (sub as any).current_period_end

        await supabase.from('subscriptions').upsert({
          user_id:                userId,
          stripe_customer_id:     sub.customer as string,
          stripe_subscription_id: sub.id,
          status:                 sub.status,
          plan:                   planId,
          token_limit:            PLAN_TOKEN_LIMITS[planId] ?? 0,
          tokens_used:            0,
          tokens_banked:          0,
          current_period_start:   periodStart ? new Date(periodStart * 1000).toISOString() : null,
          current_period_end:     periodEnd   ? new Date(periodEnd   * 1000).toISOString() : null,
          updated_at:             new Date().toISOString(),
        }, { onConflict: 'user_id' })
        break
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice
        const subId = (invoice as any).subscription as string
        if (!subId) break

        const stripeSub = await stripe.subscriptions.retrieve(subId)
        const userId  = stripeSub.metadata.user_id
        const planId  = stripeSub.metadata.plan_id || getPlanFromPriceId(stripeSub.items.data[0].price.id)
        if (!userId || !planId) break

        const periodStart = (stripeSub as any).current_period_start
        const periodEnd   = (stripeSub as any).current_period_end

        await supabase.from('subscriptions').update({
          status:               'active',
          plan:                 planId,
          token_limit:          PLAN_TOKEN_LIMITS[planId] ?? 0,
          tokens_used:          0,
          current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
          current_period_end:   periodEnd   ? new Date(periodEnd   * 1000).toISOString() : null,
          updated_at:           new Date().toISOString(),
        }).eq('user_id', userId)
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const userId = sub.metadata.user_id
        const planId = sub.metadata.plan_id || getPlanFromPriceId(sub.items.data[0].price.id)
        if (!userId) break

        const periodStart = (sub as any).current_period_start
        const periodEnd   = (sub as any).current_period_end

        await supabase.from('subscriptions').update({
          status:               sub.status,
          plan:                 planId,
          token_limit:          PLAN_TOKEN_LIMITS[planId ?? ''] ?? 0,
          current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
          current_period_end:   periodEnd   ? new Date(periodEnd   * 1000).toISOString() : null,
          updated_at:           new Date().toISOString(),
        }).eq('user_id', userId)
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const userId = sub.metadata.user_id
        if (!userId) break

        await supabase.from('subscriptions').update({
          status:      'canceled',
          token_limit: 0,
          updated_at:  new Date().toISOString(),
        }).eq('user_id', userId)
        break
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent
        if (pi.metadata.type !== 'topup') break
        const userId = pi.metadata.user_id
        if (!userId) break

        await supabase.rpc('add_banked_tokens', {
          p_user_id: userId,
          p_tokens:  100_000,
        })

        await supabase.from('topup_purchases').insert({
          user_id:                  userId,
          stripe_payment_intent_id: pi.id,
          tokens_added:             100_000,
          amount_paid:              pi.amount,
        })
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subId = (invoice as any).subscription as string
        if (!subId) break

        const stripeSub = await stripe.subscriptions.retrieve(subId)
        const userId = stripeSub.metadata.user_id
        if (!userId) break

        await supabase.from('subscriptions').update({
          status:     'past_due',
          updated_at: new Date().toISOString(),
        }).eq('user_id', userId)
        break
      }
    }

    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error('Webhook handler error:', err)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}

function getPlanFromPriceId(priceId: string): string | null {
  const map: Record<string, string> = {
    [process.env.STRIPE_BREACH_PRICE_ID!]:   'breach',
    [process.env.STRIPE_TACTICAL_PRICE_ID!]: 'tactical',
    [process.env.STRIPE_COMMAND_PRICE_ID!]:  'command',
  }
  return map[priceId] ?? null
}