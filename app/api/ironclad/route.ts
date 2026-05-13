import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/service'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { CATEGORIES, RECON_PREAMBLE } from '@/lib/tools'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  maxRetries: 3,
})

const SONNET = 'claude-sonnet-4-6'
const HAIKU  = 'claude-haiku-4-5'

export const maxDuration = 300
export const runtime = 'nodejs'

function findTool(toolId: string) {
  for (const cat of CATEGORIES) {
    const tool = cat.tools.find(t => t.id === toolId)
    if (tool) return tool
  }
  return null
}

interface FileRef {
  name: string
  signedUrl: string
  mimeType: string
  path: string
}

/**
 * Fetch file from Supabase signed URL, upload to Anthropic Files API,
 * return the Anthropic file_id.
 */
async function uploadToAnthropicFiles(fileRef: FileRef): Promise<string> {
  // Fetch the file from Supabase
  const fetchRes = await fetch(fileRef.signedUrl)
  if (!fetchRes.ok) {
    throw new Error(`Failed to fetch file from storage: ${fetchRes.status}`)
  }
  const fileBlob = await fetchRes.blob()

  // Wrap as File-like object for Anthropic SDK
  const file = new File([fileBlob], fileRef.name, { type: fileRef.mimeType })

  // Upload to Anthropic Files API (beta)
  const uploaded = await (anthropic as any).beta.files.upload({
    file,
  })

  return uploaded.id
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

    let body: any
    try {
      body = await request.json()
    } catch (e) {
      return NextResponse.json({ error: 'Failed to parse request body' }, { status: 400 })
    }

    const { toolId, projectName = 'Untitled Project', context = '', fileRefs = [] } = body as {
      toolId: string
      projectName?: string
      context?: string
      fileRefs?: FileRef[]
    }

    if (!toolId) {
      return NextResponse.json({ error: 'No tool specified' }, { status: 400 })
    }

    const tool = findTool(toolId)
    if (!tool) {
      return NextResponse.json({ error: 'Tool not found' }, { status: 404 })
    }

    // Upload all files to Anthropic Files API in parallel
    const contentBlocks: any[] = []
    if (fileRefs.length > 0) {
      const uploadResults = await Promise.allSettled(
        fileRefs.map(fr => uploadToAnthropicFiles(fr))
      )

      const failed = uploadResults.filter(r => r.status === 'rejected')
      if (failed.length > 0) {
        const firstError = (failed[0] as PromiseRejectedResult).reason
        console.error('File upload to Anthropic failed:', firstError)
        return NextResponse.json({
          error: `Failed to upload ${failed.length} of ${fileRefs.length} file(s). Try again or use smaller files.`
        }, { status: 500 })
      }

      for (let i = 0; i < uploadResults.length; i++) {
        const result = uploadResults[i]
        if (result.status !== 'fulfilled') continue
        const fileId = result.value
        const fileRef = fileRefs[i]

        if (fileRef.mimeType === 'application/pdf') {
          contentBlocks.push({
            type: 'document',
            source: { type: 'file', file_id: fileId }
          })
        } else if (fileRef.mimeType.startsWith('image/')) {
          contentBlocks.push({
            type: 'image',
            source: { type: 'file', file_id: fileId }
          })
        } else {
          // Text files — fetch and inline as text
          const textRes = await fetch(fileRef.signedUrl)
          const text = await textRes.text()
          contentBlocks.push({ type: 'text', text: `[File: ${fileRef.name}]\n${text}` })
        }
      }
    }

    const userText = contentBlocks.length === 0 && !context
      ? `No documents uploaded. Project name: ${projectName}. Tool: ${tool.name}. Provide a generic framework and checklist for this analysis type with key questions an estimator should be asking. Per the preamble, mark all claims as [GENERIC FRAMEWORK].`
      : context || `Project: ${projectName}. Tool: ${tool.name}. Analyze the uploaded documents and provide your full analysis per the output discipline rules in the preamble.`

    contentBlocks.push({ type: 'text', text: userText })

    const model     = tool.model === 'sonnet' ? SONNET : HAIKU
    const maxTokens = tool.model === 'sonnet' ? 6000 : 3000

    const systemPrompt = RECON_PREAMBLE + tool.prompt

    const { data: run, error: runError } = await serviceClient
      .from('runs')
      .insert({ user_id: user.id, project_name: projectName, status: 'pending' })
      .select('id')
      .single()

    if (runError || !run) {
      return NextResponse.json({ error: 'Failed to create run' }, { status: 500 })
    }

    const message = await (anthropic as any).beta.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: contentBlocks }],
      betas: ['files-api-2025-04-14'],
    })

    const output = message.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')

    const totalTokens = (message.usage?.input_tokens || 0) + (message.usage?.output_tokens || 0)

    await serviceClient.from('runs').update({
      status: 'complete',
      tokens_used: totalTokens,
      raw_output: output,
      updated_at: new Date().toISOString(),
    }).eq('id', run.id)

    await serviceClient.rpc('deduct_tokens', { p_user_id: user.id, p_tokens: totalTokens })

    return NextResponse.json({ run_id: run.id, output, tokens_used: totalTokens })

  } catch (err: any) {
    console.error('IRONCLAD API error:', err)
    
    let userMessage = 'Something went wrong. Please try again.'
    if (err.status === 529 || err.message?.includes('Overloaded')) {
      userMessage = 'Anthropic servers are temporarily overloaded. Please wait 30 seconds and try again.'
    } else if (err.status === 429 || err.message?.includes('rate_limit')) {
      userMessage = 'Rate limit reached. Please wait a moment and try again.'
    } else if (err.message?.includes('credit')) {
      userMessage = 'API credit issue. Please contact support.'
    } else if (err.message?.includes('Failed to fetch file')) {
      userMessage = 'Could not retrieve uploaded file. Try uploading again.'
    }
    
    return NextResponse.json({ error: userMessage }, { status: err.status || 500 })
  }
}