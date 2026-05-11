import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/service'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { CATEGORIES } from '@/lib/tools'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const SONNET = 'claude-sonnet-4-20250514'
const HAIKU  = 'claude-haiku-4-5-20251001'

function findTool(toolId: string) {
  for (const cat of CATEGORIES) {
    const tool = cat.tools.find(t => t.id === toolId)
    if (tool) return tool
  }
  return null
}

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

    const formData = await request.formData()
    const toolId      = formData.get('toolId') as string
    const context     = formData.get('context') as string || ''
    const files       = formData.getAll('files') as File[]
    const projectName = formData.get('projectName') as string || 'Untitled Project'

    if (!toolId) {
      return NextResponse.json({ error: 'No tool specified' }, { status: 400 })
    }

    const tool = findTool(toolId)
    if (!tool) {
      return NextResponse.json({ error: 'Tool not found' }, { status: 404 })
    }

    const contentBlocks: any[] = []

    for (const file of files) {
      const buffer = await file.arrayBuffer()
      const base64 = Buffer.from(buffer).toString('base64')
      const mimeType = file.type

      if (mimeType === 'application/pdf') {
        contentBlocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 }
        })
      } else if (mimeType.startsWith('image/')) {
        contentBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: base64 }
        })
      } else {
        const text = Buffer.from(buffer).toString('utf-8')
        contentBlocks.push({ type: 'text', text: `[File: ${file.name}]\n${text}` })
      }
    }

    const userText = files.length === 0 && !context
      ? 'No documents uploaded. Provide a general framework and checklist for this analysis type with key questions an estimator should be asking.'
      : context || 'Analyze the uploaded documents and provide your full analysis.'

    contentBlocks.push({ type: 'text', text: userText })

    const model     = tool.model === 'sonnet' ? SONNET : HAIKU
    const maxTokens = tool.model === 'sonnet' ? 4000 : 2000

    const { data: run } = await serviceClient
      .from('runs')
      .insert({
        user_id:      user.id,
        project_name: projectName,
        status:       'pending',
      })
      .select('id')
      .single()

    const encoder = new TextEncoder()
    let fullOutput = ''
    let totalInputTokens  = 0
    let totalOutputTokens = 0

    const stream = new ReadableStream({
      async start(controller) {
        try {
          if (run) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'run_id', run_id: run.id })}\n\n`))
          }

          const response = await anthropic.messages.stream({
            model,
            max_tokens: maxTokens,
            system:     tool.prompt,
            messages:   [{ role: 'user', content: contentBlocks }],
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

          if (run) {
            await serviceClient.from('runs').update({
              status:      'complete',
              tokens_used: totalTokens,
              raw_output:  fullOutput,
              updated_at:  new Date().toISOString(),
            }).eq('id', run.id)
          }

          await serviceClient.rpc('deduct_tokens', {
            p_user_id: user.id,
            p_tokens:  totalTokens,
          })

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'tokens_used', tokens: totalTokens })}\n\n`))
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`))
          controller.close()

        } catch (err: any) {
          if (run) {
            await serviceClient.from('runs').update({
              status:     'error',
              updated_at: new Date().toISOString(),
            }).eq('id', run.id)
          }
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
    console.error('Tool API error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}