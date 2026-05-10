'use client'

import { useState, useRef, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type RunStatus = 'idle' | 'running' | 'complete' | 'error'

export default function RunPage() {
  const [projectName, setProjectName] = useState('')
  const [projectInput, setProjectInput] = useState('')
  const [status, setStatus] = useState<RunStatus>('idle')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [currentModule, setCurrentModule] = useState<number | null>(null)

  const outputRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  useEffect(() => {
    const match = output.match(/MODULE (\d+)/g)
    if (match && match.length > 0) {
      const last = match[match.length - 1]
      const num = parseInt(last.replace('MODULE ', ''))
      setCurrentModule(num)
    }
  }, [output])

  async function handleRun() {
    if (!projectName.trim()) { setError('Enter a project name.'); return }
    if (!projectInput.trim()) { setError('Enter project scope or paste your document text.'); return }

    setStatus('running')
    setOutput('')
    setError(null)
    setCurrentModule(1)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }

      const response = await fetch('/api/ironclad', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ projectName, projectInput }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || `Request failed: ${response.status}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let fullOutput = ''

      if (!reader) throw new Error('No response stream')

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              if (parsed.type === 'text_delta') {
                fullOutput += parsed.text
                setOutput(fullOutput)
              } else if (parsed.type === 'error') {
                throw new Error(parsed.error)
              }
            } catch {}
          }
        }
      }

      setStatus('complete')
    } catch (err: any) {
      setError(err.message || 'Run failed. Try again.')
      setStatus('error')
    }
  }

  function handleExport() {
    if (!output) return
    const blob = new Blob([output], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectName || 'ironclad-run'}-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const moduleProgress = currentModule ? Math.round((currentModule / 17) * 100) : 0

  return (
    <div className="min-h-screen bg-[#111827] text-white flex flex-col">
      <div className="border-b border-white/10 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-[#1E40AF] rounded flex items-center justify-center">
            <span className="text-xs font-black">IC</span>
          </div>
          <span className="font-bold tracking-widest text-sm uppercase text-white/70">IRONCLAD RECON</span>
          <span className="text-white/20 text-sm">v2.4</span>
        </div>
        <Link href="/dashboard" className="text-sm text-white/40 hover:text-white transition-colors">
          ← Dashboard
        </Link>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <div className="lg:w-[400px] flex-shrink-0 border-b lg:border-b-0 lg:border-r border-white/10 p-6 flex flex-col gap-5">
          <div>
            <h1 className="text-lg font-black tracking-tight mb-1">New Run</h1>
            <p className="text-white/40 text-sm">Paste your project scope or document text. IRONCLAD runs all 17 modules.</p>
          </div>

          <div>
            <label className="block text-xs font-bold tracking-widest uppercase text-white/50 mb-2">Project Name</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Dolson Self Storage — Phase 2"
              disabled={status === 'running'}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-[#1E40AF] transition-colors disabled:opacity-40"
            />
          </div>

          <div className="flex-1 flex flex-col">
            <label className="block text-xs font-bold tracking-widests uppercase text-white/50 mb-2">Project Scope / Document Input</label>
            <textarea
              value={projectInput}
              onChange={(e) => setProjectInput(e.target.value)}
              placeholder="Paste bid package summary, scope descriptions, drawing notes, spec sections, or any project input here."
              disabled={status === 'running'}
              className="flex-1 w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-[#1E40AF] transition-colors resize-none disabled:opacity-40 min-h-[200px]"
            />
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-500/30 rounded-lg px-4 py-3 text-red-300 text-sm">{error}</div>
          )}

          <button
            onClick={handleRun}
            disabled={status === 'running'}
            className="bg-[#1E40AF] hover:bg-[#1d3aaa] disabled:bg-[#1E40AF]/40 text-white font-black text-sm py-3 rounded-lg transition-colors tracking-widest uppercase disabled:cursor-not-allowed"
          >
            {status === 'running' ? 'Running...' : 'Run IRONCLAD'}
          </button>

          {status === 'running' && (
            <div>
              <div className="flex items-center justify-between text-xs text-white/40 mb-1.5">
                <span>Module {currentModule} of 17</span>
                <span>{moduleProgress}%</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-[#1E40AF] rounded-full transition-all duration-300" style={{ width: `${moduleProgress}%` }} />
              </div>
            </div>
          )}

          {status === 'complete' && output && (
            <button
              onClick={handleExport}
              className="bg-white/10 hover:bg-white/15 text-white text-xs font-bold py-2.5 rounded-lg transition-colors tracking-wide"
            >
              Export TXT
            </button>
          )}
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="border-b border-white/10 px-6 py-3 flex items-center justify-between flex-shrink-0">
            <span className="text-xs font-bold tracking-widest uppercase text-white/40">IRONCLAD Output</span>
            {status === 'complete' && <span className="text-xs font-bold text-emerald-400 tracking-widest uppercase">✓ Run Complete</span>}
            {status === 'running' && <span className="text-xs text-[#1E40AF] tracking-widest uppercase font-bold animate-pulse">● Live</span>}
          </div>

          <div ref={outputRef} className="flex-1 overflow-y-auto p-6">
            {status === 'idle' && (
              <div className="h-full flex items-center justify-center">
                <div className="text-center max-w-sm">
                  <p className="text-white/30 text-sm">Enter project details and press Run IRONCLAD. All 17 modules will execute in sequence.</p>
                </div>
              </div>
            )}
            {(status === 'running' || status === 'complete' || status === 'error') && output && (
              <pre className="text-sm text-white/80 font-mono whitespace-pre-wrap leading-relaxed">{output}</pre>
            )}
            {status === 'error' && !output && (
              <div className="h-full flex items-center justify-center">
                <p className="text-red-400 text-sm">Run failed. Check input and try again.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}