import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, feature, file_size_mb, user_id } = body

    if (!email || !feature) {
      return NextResponse.json({ error: 'Email and feature required' }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }

    const serviceClient = createServiceClient()

    const { error } = await serviceClient
      .from('feature_waitlist')
      .insert({
        email: email.toLowerCase().trim(),
        feature,
        file_size_mb: file_size_mb || null,
        user_id: user_id || null,
      })

    if (error) {
      console.error('Waitlist insert error:', error)
      return NextResponse.json({ error: 'Failed to save. Try again.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (err: any) {
    console.error('Waitlist API error:', err)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}