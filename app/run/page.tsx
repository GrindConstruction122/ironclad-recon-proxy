'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CATEGORIES, type Tool, type Category } from '@/lib/tools'

type RunStatus = 'idle' | 'running' | 'complete' | 'error'

interface UploadedFile {
  file: File
  name: string
  size: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export default function RunPage() {
  const [activeCatId, setActiveCatId]     = useState('prebid')
  const [selectedTool, setSelectedTool]   = useState<Tool | null>(null)
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [projectName, setProjectName]     = useState('')
  const [context, setContext]             = useState('')
  const [status, setStatus]               = useState<RunStatus>('idle')
  const [output, setOutput]               = useState('')
  const [error, setError]                 = useState<string | null>(null)
  const [tokensUsed, setTokensUsed]       = useState<number | null>(null)
  const [dragOver, setDragOver]           = useState(false)

  const outputRef  = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router     = useRouter()

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  function handleFiles(files: FileList | File[]) {
    const newFiles = Array.from(files).map(f => ({
      file: f,
      name: f.name,
      size: formatSize(f.size),
    }))
    setUploadedFiles(prev => {
      const existing = new Set(prev.map(f => f.name))
      return [...prev, ...newFiles.filter(f => !existing.has(f.name))]
    })
  }

  function removeFile(idx: number) {
    setUploadedFiles(prev => prev.filter((_, i) => i !== idx))
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }, [])

  const activeCat = CATEGORIES.find(c => c.id === activeCatId)!

  async function handleRun() {
    if (!selectedTool) { setError('Select a tool first.'); return }
    if (!projectName.trim()) { setError('Enter a project name.'); return }

    setStatus('running')
    setOutput('')
    setError(null)
    setTokensUsed(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }

      const formData = new FormData()
      formData.append('toolId', selectedTool.id)
      formData.append('projectName', projectName)
      formData.append('context', context)
      uploadedFiles.forEach(f => formData.append('files', f.file))

      const response = await fetch('/api/ironclad', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || `Request failed: ${response.status}`)
      }

      const reader  = response.body?.getReader()
      const decoder = new TextDecoder()
      let fullOutput = ''

      if (!reader) throw new Error('No response stream')

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              if (parsed.type === 'text_delta') {
                fullOutput += parsed.text
                setOutput(fullOutput)
              } else if (parsed.type === 'tokens_used') {
                setTokensUsed(parsed.tokens)
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
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${projectName || 'ironclad'}-${selectedTool?.id || 'output'}-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleCopy() {
    if (output) navigator.clipboard.writeText(output)
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#080c12', color: '#f0f6ff', fontFamily: 'sans-serif' }}>

      {/* HEADER */}
      <div style={{ background: 'linear-gradient(180deg, #050810 0%, #0d1520 100%)', borderBottom: '2px solid rgba(14,165,233,0.4)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, background: '#0ea5e9', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 14, letterSpacing: 1 }}>IC</div>
          <div>
            <div style={{ fontWeight: 900, fontSize: '1.4rem', letterSpacing: 6, textTransform: 'uppercase', lineHeight: 1 }}>
              IRONCLAD <span style={{ color: '#0ea5e9' }}>RECON</span>
            </div>
            <div style={{ fontSize: '0.6rem', letterSpacing: 4, textTransform: 'uppercase', color: '#94a3b8', marginTop: 2 }}>
              // KNOW WHAT YOU'RE WALKING INTO — BEFORE YOU BID IT //
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.35)', color: '#4ade80', fontSize: '0.6rem', fontWeight: 700, letterSpacing: 2, padding: '4px 10px', borderRadius: 2, textTransform: 'uppercase' }}>
            ● SERVER ACTIVE
          </div>
          <Link href="/dashboard" style={{ color: '#94a3b8', fontSize: '0.8rem', textDecoration: 'none' }}>
            ← Dashboard
          </Link>
        </div>
      </div>

      {/* UPLOAD ZONE */}
      <div style={{ background: '#0d1520', borderBottom: '1px solid rgba(14,165,233,0.15)', padding: '20px 32px' }}>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? '#0ea5e9' : 'rgba(14,165,233,0.35)'}`,
            borderRadius: 6,
            padding: '20px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            cursor: 'pointer',
            background: dragOver ? 'rgba(14,165,233,0.07)' : 'rgba(14,165,233,0.03)',
            transition: 'all 0.2s',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.txt,.doc,.docx"
            style={{ display: 'none' }}
            onChange={e => e.target.files && handleFiles(e.target.files)}
          />
          <span style={{ fontSize: '2rem' }}>📁</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: '0.9rem', letterSpacing: 3, textTransform: 'uppercase', color: '#38bdf8', marginBottom: 2 }}>
              DROP PROJECT DOCUMENTS HERE
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
              Bid packages · Contracts · Specs · Drawings · Scope docs — PDF, images, or text files
            </div>
          </div>
          {uploadedFiles.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginLeft: 'auto' }} onClick={e => e.stopPropagation()}>
              {uploadedFiles.map((f, i) => (
                <div key={i} style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.3)', color: '#38bdf8', fontSize: '0.7rem', padding: '4px 10px', borderRadius: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  📄 {f.name} ({f.size})
                  <button onClick={() => removeFile(i)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: 0 }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* PROJECT NAME */}
      <div style={{ background: '#0d1520', borderBottom: '1px solid rgba(14,165,233,0.1)', padding: '12px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#94a3b8', flexShrink: 0 }}>Project Name</span>
        <input
          type="text"
          value={projectName}
          onChange={e => setProjectName(e.target.value)}
          placeholder="e.g. Dolson Self Storage — Phase 2"
          style={{ flex: 1, background: 'rgba(14,165,233,0.05)', border: '1px solid rgba(14,165,233,0.2)', borderRadius: 4, padding: '8px 12px', color: '#f0f6ff', fontSize: '0.85rem', outline: 'none' }}
        />
      </div>

      {/* CATEGORY TABS */}
      <div style={{ display: 'flex', background: '#0d1520', borderBottom: '1px solid rgba(14,165,233,0.2)', padding: '0 32px', overflowX: 'auto' }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => { setActiveCatId(cat.id); setSelectedTool(null) }}
            style={{
              padding: '12px 20px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.78rem',
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: activeCatId === cat.id ? '#38bdf8' : '#94a3b8',
              borderBottom: activeCatId === cat.id ? '3px solid #0ea5e9' : '3px solid transparent',
              background: activeCatId === cat.id ? 'rgba(14,165,233,0.06)' : 'none',
              border: 'none',
              borderBottomStyle: 'solid',
              borderBottomWidth: 3,
              borderBottomColor: activeCatId === cat.id ? '#0ea5e9' : 'transparent',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s',
            }}
          >
            {cat.icon} {cat.name}
            <span style={{ background: activeCatId === cat.id ? 'rgba(14,165,233,0.25)' : '#1e2d42', color: activeCatId === cat.id ? '#38bdf8' : '#94a3b8', fontSize: '0.6rem', padding: '1px 5px', borderRadius: 2 }}>
              {cat.tools.length}
            </span>
          </button>
        ))}
      </div>

      {/* MAIN CONTENT */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* TOOLS GRID */}
        <div style={{ flex: 1, padding: '24px 32px', overflowY: 'auto' }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 900, fontSize: '1.2rem', letterSpacing: 4, textTransform: 'uppercase', color: '#f0f6ff' }}>
              {activeCat.icon} {activeCat.name}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>{activeCat.desc}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {activeCat.tools.map(tool => (
              <div
                key={tool.id}
                onClick={() => setSelectedTool(tool)}
                style={{
                  background: selectedTool?.id === tool.id ? 'rgba(14,165,233,0.12)' : '#0d1520',
                  border: `1px solid ${selectedTool?.id === tool.id ? '#0ea5e9' : 'rgba(14,165,233,0.12)'}`,
                  borderRadius: 4,
                  padding: 18,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                  <h3 style={{ fontWeight: 700, fontSize: '0.85rem', color: selectedTool?.id === tool.id ? '#38bdf8' : '#f0f6ff', lineHeight: 1.3 }}>{tool.name}</h3>
                  <span style={{ fontSize: '0.55rem', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: tool.model === 'sonnet' ? '#f59e0b' : '#94a3b8', background: tool.model === 'sonnet' ? 'rgba(245,158,11,0.1)' : 'rgba(148,163,184,0.1)', padding: '2px 5px', borderRadius: 2, flexShrink: 0, marginLeft: 6 }}>
                    {tool.model === 'sonnet' ? 'Sonnet' : 'Haiku'}
                  </span>
                </div>
                <p style={{ fontSize: '0.72rem', color: '#94a3b8', lineHeight: 1.5, marginBottom: 12 }}>{tool.desc}</p>
                <button
                  onClick={e => { e.stopPropagation(); setSelectedTool(tool) }}
                  style={{ background: 'rgba(14,165,233,0.15)', border: '1px solid rgba(14,165,233,0.3)', color: '#38bdf8', fontSize: '0.65rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', padding: '6px 12px', borderRadius: 2, cursor: 'pointer' }}
                >
                  ▶ SELECT TOOL
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* OUTPUT PANEL */}
        <div style={{ width: 480, borderLeft: '1px solid rgba(14,165,233,0.15)', display: 'flex', flexDirection: 'column', background: '#0d1520' }}>

          {/* Panel header */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(14,165,233,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#94a3b8' }}>
              {selectedTool ? `${activeCat.name} → ${selectedTool.name}` : 'Select a Tool'}
            </div>
            {status === 'running' && (
              <span style={{ fontSize: '0.65rem', color: '#0ea5e9', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>● LIVE</span>
            )}
            {status === 'complete' && (
              <span style={{ fontSize: '0.65rem', color: '#22c55e', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>✓ COMPLETE</span>
            )}
          </div>

          {/* Context input */}
          {selectedTool && status === 'idle' && (
            <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(14,165,233,0.1)' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 6 }}>
                Additional Context (Optional)
              </div>
              <textarea
                value={context}
                onChange={e => setContext(e.target.value)}
                placeholder="Add any specific questions, project details, or focus areas for this analysis..."
                rows={3}
                style={{ width: '100%', background: 'rgba(14,165,233,0.05)', border: '1px solid rgba(14,165,233,0.2)', borderRadius: 4, padding: '8px 10px', color: '#f0f6ff', fontSize: '0.78rem', resize: 'none', outline: 'none' }}
              />
            </div>
          )}

          {/* Run button */}
          {selectedTool && (status === 'idle' || status === 'error') && (
            <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(14,165,233,0.1)' }}>
              {error && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: '0.75rem', padding: '8px 12px', borderRadius: 4, marginBottom: 10 }}>
                  {error}
                </div>
              )}
              <button
                onClick={handleRun}
                disabled={false}
                style={{ width: '100%', background: '#0ea5e9', border: 'none', color: '#fff', fontWeight: 900, fontSize: '0.75rem', letterSpacing: 3, textTransform: 'uppercase', padding: '12px', borderRadius: 4, cursor: 'pointer' }}
              >
                ▶ RUN THIS TOOL
              </button>
              {uploadedFiles.length === 0 && (
                <div style={{ fontSize: '0.65rem', color: '#94a3b8', textAlign: 'center', marginTop: 8 }}>
                  No documents uploaded — will generate a general framework
                </div>
              )}
            </div>
          )}

          {/* Output content */}
          <div ref={outputRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
            {status === 'idle' && !selectedTool && (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem', padding: 24 }}>
                Select a tool from the grid and click Run This Tool. Upload project documents for document-specific analysis.
              </div>
            )}
            {status === 'idle' && selectedTool && (
              <div style={{ color: '#94a3b8', fontSize: '0.78rem', lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, color: '#38bdf8', marginBottom: 8, fontSize: '0.8rem' }}>{selectedTool.name}</div>
                <div>{selectedTool.desc}</div>
                <div style={{ marginTop: 12, padding: '8px 10px', background: 'rgba(14,165,233,0.05)', borderRadius: 4, border: '1px solid rgba(14,165,233,0.1)' }}>
                  <span style={{ fontWeight: 700, color: tool_model_label(selectedTool.model) }}>
                    {selectedTool.model === 'sonnet' ? '⚡ Sonnet' : '◆ Haiku'}
                  </span>
                  <span style={{ marginLeft: 6, fontSize: '0.7rem' }}>
                    {selectedTool.model === 'sonnet' ? '— Deep forensic analysis' : '— Fast document generation'}
                  </span>
                </div>
              </div>
            )}
            {(status === 'running' || status === 'complete') && output && (
              <pre style={{ fontSize: '0.78rem', color: '#cbd5e1', fontFamily: 'monospace', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                {output}
              </pre>
            )}
            {status === 'error' && !output && (
              <div style={{ color: '#fca5a5', fontSize: '0.8rem' }}>Run failed. Check your connection and try again.</div>
            )}
          </div>

          {/* Bottom actions */}
          {status === 'complete' && output && (
            <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(14,165,233,0.15)', display: 'flex', gap: 8 }}>
              {tokensUsed && (
                <span style={{ fontSize: '0.65rem', color: '#94a3b8', display: 'flex', alignItems: 'center', marginRight: 'auto' }}>
                  {tokensUsed.toLocaleString()} tokens used
                </span>
              )}
              <button onClick={handleCopy} style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)', color: '#38bdf8', fontSize: '0.65rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', padding: '6px 12px', borderRadius: 2, cursor: 'pointer' }}>
                COPY
              </button>
              <button onClick={handleExport} style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)', color: '#38bdf8', fontSize: '0.65rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', padding: '6px 12px', borderRadius: 2, cursor: 'pointer' }}>
                EXPORT TXT
              </button>
              <button
                onClick={() => { setStatus('idle'); setOutput(''); setTokensUsed(null) }}
                style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)', color: '#38bdf8', fontSize: '0.65rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', padding: '6px 12px', borderRadius: 2, cursor: 'pointer' }}
              >
                NEW RUN
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function tool_model_label(model: string): string {
  return model === 'sonnet' ? '#f59e0b' : '#94a3b8'
}
