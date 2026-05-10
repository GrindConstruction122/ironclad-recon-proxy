import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
apiVersion: '2026-04-22.dahlia',
})

export const PLANS = {
  breach: {
    name: 'IRONCLAD Recon Breach',
    tokenCap: 100000,
    priceId: process.env.STRIPE_BREACH_PRICE_ID,
  },
  tactical: {
    name: 'IRONCLAD Recon Tactical',
    tokenCap: 400000,
    priceId: process.env.STRIPE_TACTICAL_PRICE_ID,
  },
  command: {
    name: 'IRONCLAD Recon Command',
    tokenCap: 1000000,
    priceId: process.env.STRIPE_COMMAND_PRICE_ID,
  },
}