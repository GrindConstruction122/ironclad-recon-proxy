import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'

export default async function DashboardPage() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {}
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('status, plan, current_period_end, stripe_customer_id, token_limit, tokens_used, tokens_banked')
    .eq('user_id', user.id)
    .single()

  if (!subscription || subscription.status !== 'active') redirect('/pricing')

  const { data: runs } = await supabase
    .from('runs')
    .select('id, created_at, project_name, status, hard_stop_count, flag_count, m17_status')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  return (
    <DashboardClient
      user={{ email: user.email!, id: user.id }}
      subscription={subscription}
      runs={runs || []}
    />
  )
}