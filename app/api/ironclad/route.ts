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

// Hard limits from Anthropic API
const MAX_PDF_PAGES   = 580   // Anthropic hard limit is 600 — we stop at 580 for safety headroom
const MAX_TOKENS_SAFE = 900000 // Anthropic hard limit is 1,000,000 — we stop at 900K for headroom
const TOKENS_PER_PAGE = 1500  // Conservative estimate for drawing sets (scanned sheets run 1500-3000)
const SYSTEM_PROMPT_TOKENS = 5000 // Estimate for RECON_PREAMBLE + tool.prompt

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
  pageCount?: number  // Optional — populated by client if available
}

/**
 * Fetch file from Supabase signed URL, upload to Anthropic Files API,
 * return the Anthropic file_id.
 */
async function uploadToAnthropicFiles(fileRef: FileRef): Promise<string> {
  const fetchRes = await fetch(fileRef.signedUrl)
  if (!fetchRes.ok) {
    throw new Error(`Failed to fetch file from storage: ${fetchRes.status}`)
  }
  const fileBlob = await fetchRes.blob()

  const file = new File([fileBlob], fileRef.name, { type: fileRef.mimeType })

  const uploaded = await (anthropic as any).beta.files.upload({
    file,
  })

  return uploaded.id
}

/**
 * Pre-flight check: estimate token usage before making the API call.
 * Returns an error string if the estimated token count would exceed safe limits,
 * or null if it looks safe to proceed.
 */
function preflightTokenCheck(fileRefs: FileRef[]): string | null {
  const pdfFiles = fileRefs.filter(f => f.mimeType === 'application/pdf')

  for (const pdf of pdfFiles) {
    if (pdf.pageCount && pdf.pageCount > MAX_PDF_PAGES) {
      const maxSafePages = MAX_PDF_PAGES
      return (
        `"${pdf.name}" has ${pdf.pageCount} pages, which exceeds the ${MAX_PDF_PAGES}-page limit. ` +
        `Please split this file into sections of ${maxSafePages} pages or fewer and upload each section separately. ` +
        `Split by discipline — Civil, Structural, Architectural, MEP.`
      )
    }
  }

  // Estimate total tokens across all PDFs
  const totalPageEstimate = pdfFiles.reduce((sum, f) => sum + (f.pageCount || 100), 0)
  const estimatedTokens = (totalPageEstimate * TOKENS_PER_PAGE) + SYSTEM_PROMPT_TOKENS

  if (estimatedTokens > MAX_TOKENS_SAFE) {
    const maxSafePages = Math.floor(
      (MAX_TOKENS_SAFE - SYSTEM_PROMPT_TOKENS) / TOKENS_PER_PAGE
    )
    return (
      `The uploaded documents are estimated to exceed the processing limit ` +
      `(~${Math.round(estimatedTokens / 1000)}K tokens estimated, 900K maximum). ` +
      `Please split your plan set into sections of approximately ${maxSafePages} pages or fewer. ` +
      `Most plan sets should be split by discipline — Civil, Structural, Architectural, MEP.`
    )
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

    // ── PRE-FLIGHT CHECK ──
    // Estimate token usage before hitting the API. Returns a user-friendly
    // error message if the upload would exceed safe limits.
    if (fileRefs.length > 0) {
      const preflightError = preflightTokenCheck(fileRefs)
      if (preflightError) {
        return NextResponse.json({ error: preflightError }, { status: 400 })
      }
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
    const maxTokens = tool.model === 'sonnet' ? 10000 : 4000

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

    const errorMessage = err?.error?.error?.message || err?.message || ''

    // ── 600-PAGE PDF LIMIT ──
    // Anthropic rejects the entire request before processing starts.
    if (errorMessage.includes('maximum of 600 PDF pages')) {
      return NextResponse.json({
        error:
          'This plan set exceeds the 600-page limit. Please split the file into sections ' +
          'of under 580 pages and upload each section separately. Split by discipline — ' +
          'Civil, Structural, Architectural, MEP.',
      }, { status: 400 })
    }

    // ── CONTEXT WINDOW / TOKEN LIMIT ──
    // File is within page count but generates too many tokens.
    // Also catches the timeout scenario where the request ran too long
    // and Vercel killed it before the API could respond.
    if (
      errorMessage.includes('prompt is too long') ||
      errorMessage.includes('tokens > 1000000 maximum') ||
      err.status === 524 ||
      err.status === 408 ||
      errorMessage.includes('timed out')
    ) {
      const match = errorMessage.match(/(\d[\d,]*)\s*tokens?\s*>\s*(\d[\d,]*)\s*maximum/)
      const submitted = match ? parseInt(match[1].replace(/,/g, '')).toLocaleString() : null
      const baseMsg =
        'This plan set is too large to process in a single upload. ' +
        'Please split the file into sections of approximately 150 pages or fewer and upload each section separately. ' +
        'Split by discipline — Civil, Structural, Architectural, MEP. ' +
        'Spec books and project manuals can typically be uploaded separately from drawing sets.'
      const tokenDetail = submitted ? ` (Estimated size: ~${submitted} tokens, 1,000,000 maximum.)` : ''
      return NextResponse.json({ error: baseMsg + tokenDetail }, { status: 400 })
    }

    // ── OVERLOADED ──
    if (err.status === 529 || errorMessage.includes('Overloaded')) {
      return NextResponse.json({
        error: 'Anthropic servers are temporarily overloaded. Please wait 30 seconds and try again.',
      }, { status: 503 })
    }

    // ── RATE LIMIT ──
    if (err.status === 429 || errorMessage.includes('rate_limit')) {
      return NextResponse.json({
        error: 'Rate limit reached. Please wait a moment and try again.',
      }, { status: 429 })
    }

    // ── API CREDIT ISSUE ──
    if (errorMessage.includes('credit')) {
      return NextResponse.json({
        error: 'API credit issue. Please contact support.',
      }, { status: 402 })
    }

    // ── FILE FETCH FAILURE ──
    if (errorMessage.includes('Failed to fetch file')) {
      return NextResponse.json({
        error: 'Could not retrieve uploaded file. Please try uploading again.',
      }, { status: 500 })
    }

    // ── GENERIC FALLBACK ──
    return NextResponse.json({
      error: 'Something went wrong. Please try again.',
    }, { status: err.status || 500 })
  }
}