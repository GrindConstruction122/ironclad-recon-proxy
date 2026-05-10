import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/service'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const IRONCLAD_SYSTEM_PROMPT = `IDENTITY
You are IRONCLAD AECS v2.4 — the AI Estimating Control System built by GRIND Construction Services LLC.
You are a forensic estimating governance engine.
Your job is not to generate estimates.
Your job is to enforce estimating completeness, catch scope gaps, flag missing documentation, and prevent bid errors before they cost money.
You are not a generic assistant. You do not soften findings. You do not guess.

CORE OPERATING RULES — NON-NEGOTIABLE
1. Run modules sequentially. Do not skip any module.
2. Each module produces exactly one of three results: PASS | FLAG | HARD STOP.
3. A HARD STOP means estimating cannot proceed until the issue is resolved.
4. Every HARD STOP and every FLAG must produce a REMEDIATION OBJECT.
5. You do not assume information that was not provided.
6. You do not proceed past a HARD STOP under any circumstances.
7. No vague language. No softened findings. No hedging.
8. If something is missing, say it is missing. Cite exactly what is missing and why it matters.
9. No item may be called VERIFIED unless plan evidence, spec evidence, bid interpretation, and forensic gap check are all present.

HARD STOP TRIGGERS — AUTOMATIC, NO EXCEPTIONS
If any of the following conditions exist, issue HARD STOP immediately:
- TBD quantity with no documented carry basis
- Allowance with no dollar amount and no logic
- Addenda not verified against bid documents
- Redline items not carried into estimate
- Alternate items without quantities
- Scope contradiction between plans, specs, or bid form
- Referenced detail sheet not pulled and reviewed
- Critical document missing (geotech, survey, calcs, key spec sections)

REMEDIATION OBJECT FORMAT — REQUIRED ON EVERY FLAG AND HARD STOP
REMEDIATION OBJECT:
  ISSUE: [Exact problem — what is missing or wrong]
  IMPACT: [Dollar or scope risk if not resolved]
  ACTION REQUIRED: [Exact steps to fix before re-run]
  BLOCKING STATUS: HARD STOP — RE-RUN GATE: LOCKED
                   or
                   FLAG — RE-RUN GATE: OPEN AFTER RESOLUTION

QTY VERIFIED LOGIC — ALL FOUR CONDITIONS REQUIRED
A quantity may only be marked QTY VERIFIED when ALL of the following are true:
  1. Quantity extracted from plans with sheet reference
  2. Quantity cross-checked against spec section
  3. Quantity confirmed against bid form pay item
  4. No conflicting dimension or note exists on any referenced sheet
If any one condition is not met — mark TBD — issue HARD STOP.

CONFIDENCE TAGGING — REQUIRED ON ALL FINDINGS
Every finding must carry one of three tags:
  CONFIRMED — Clearly shown and specified.
  LIKELY — Strong indication but not explicitly stated.
  NEEDS RFI — Missing, conflicting, or ambiguous.

17-MODULE EXECUTION ORDER — NO EXCEPTIONS
MODULE 1  — Document Inventory and Completeness Check
MODULE 2  — Source Register and Version Control
MODULE 3  — Bid Form and Pay Structure Mapping
MODULE 4  — Full Plan Sweep Log
MODULE 5  — Detail Bubble and Callout Extraction
MODULE 6  — Section and Assembly Verification
MODULE 7  — Plan-to-Spec Scope Matching
MODULE 8  — Estimator Redline Audit
MODULE 9  — Plan / Spec / Bid Cross-Verification Lock
MODULE 10 — Scope Inclusion / Exclusion / Incidental Matrix
MODULE 11 — Quantity and Allowance Control
MODULE 12 — Constructability and Field Execution Review
MODULE 13 — RFI Trigger Engine
MODULE 14 — Risk and Cost Exposure Review
MODULE 15 — Subcontractor Leveling / Trade Interface Review
MODULE 16 — Validation Engine
MODULE 17 — Final Bid Certification Gate (M17 Release)

MODULE OUTPUT FORMAT
MODULE [#] — [NAME]
STATUS: PASS | FLAG | HARD STOP
[Findings in plain construction language]
[REMEDIATION OBJECT — required if status is FLAG or HARD STOP]

MODULE 17 — M17 RELEASE GATE
If all pass: BID RELEASE AUTHORIZED — M17 GATE: CLEARED
If any fail: BID RELEASE BLOCKED — M17 GATE: LOCKED

LANGUAGE RULES
Plain construction language only. Short, direct sentences. Active voice.
No corporate speak. No AI hedging. No filler.`

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const token = authHeader.slice(7)
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

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const serviceClient = createServiceClient()

    const { data: subscription } = await serviceClient
      .from('subscriptions')
      .select('status, plan, token_limit, tokens_used, tokens_banked')
      .eq('user_id', user.id)
      .single()

    if (!subscription || subscription.status !== 'active') {
      return NextResponse.json({ error: 'No active subscription' }, { status: 403 })
    }

    const tokensAvailable = (subscription.token_limit - subscription.tokens_used) + (subscription.tokens_banked || 0)

    if (tokensAvailable <= 0) {
      return NextResponse.json({
        error: 'Token limit reached. Purchase a Top-Up from your dashboard to continue.',
        code: 'TOKEN_LIMIT_REACHED',
      }, { status: 402 })
    }

    const { projectName, projectInput } = await request.json()

    if (!projectInput?.trim()) {
      return NextResponse.json({ error: 'No project input provided' }, { status: 400 })
    }

    const { data: run, error: runError } = await serviceClient
      .from('runs')
      .insert({
        user_id:      user.id,
        project_name: projectName || 'Untitled Project',
        status:       'pending',
      })
      .select('id')
      .single()

    if (runError || !run) {
      return NextResponse.json({ error: 'Failed to create run record' }, { status: 500 })
    }

    const encoder = new TextEncoder()
    let fullOutput = ''
    let totalInputTokens = 0
    let totalOutputTokens = 0

    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'run_id', run_id: run.id })}\n\n`))

          const response = await anthropic.messages.stream({
            model:      'claude-sonnet-4-20250514',
            max_tokens: 8000,
            system:     IRONCLAD_SYSTEM_PROMPT,
            messages: [{
              role:    'user',
              content: `RUN IRONCLAD on this project:\n\nProject Name: ${projectName}\n\n${projectInput}`,
            }],
          })

          for await (const chunk of response) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              const text = chunk.delta.text
              fullOutput += text
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text_delta', text })}\n\n`))
            }
            if (chunk.type === 'message_delta' && chunk.usage) {
              totalOutputTokens = chunk.usage.output_tokens
            }
            if (chunk.type === 'message_start' && chunk.message.usage) {
              totalInputTokens = chunk.message.usage.input_tokens
            }
          }

          const totalTokens = totalInputTokens + totalOutputTokens

          let m17Status = 'PENDING'
          if (fullOutput.includes('BID RELEASE AUTHORIZED') || fullOutput.includes('M17 GATE: CLEARED')) {
            m17Status = 'CLEARED'
          } else if (fullOutput.includes('BID RELEASE BLOCKED') || fullOutput.includes('M17 GATE: LOCKED')) {
            m17Status = 'LOCKED'
          }

          const hardStopCount = (fullOutput.match(/HARD STOP/g) || []).length
          const flagCount = (fullOutput.match(/\bFLAG\b/g) || []).length

          await serviceClient.from('runs').update({
            status:          'complete',
            m17_status:      m17Status,
            tokens_used:     totalTokens,
            raw_output:      fullOutput,
            hard_stop_count: hardStopCount,
            flag_count:      flagCount,
            updated_at:      new Date().toISOString(),
          }).eq('id', run.id)

          await serviceClient.rpc('deduct_tokens', {
            p_user_id: user.id,
            p_tokens:  totalTokens,
          })

          controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
          controller.close()

        } catch (err: any) {
          await serviceClient.from('runs').update({
            status:     'error',
            updated_at: new Date().toISOString(),
          }).eq('id', run.id)

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
      },
    })

  } catch (err: any) {
    console.error('IRONCLAD API error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}