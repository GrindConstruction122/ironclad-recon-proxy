import "./print.css";
'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CATEGORIES, type Tool } from '@/lib/tools'
import { uploadFileToSupabase, deleteFileFromSupabase, type UploadedFileRef } from '@/lib/upload'

type RunStatus = 'idle' | 'uploading' | 'running' | 'complete' | 'error'

interface PendingFile {
  file: File
  name: string
  size: number
  sizeFormatted: string
  uploaded?: UploadedFileRef
  uploading?: boolean
  error?: string
}

const MAX_FILE_SIZE = 32 * 1024 * 1024      // 32 MB per file
const MAX_TOTAL_SIZE = 40 * 1024 * 1024     // 40 MB combined

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function modelColor(model: string): string {
  return model === 'sonnet' ? '#f59e0b' : '#94a3b8'
}

export default function RunPage() {
  const [activeCatId, setActiveCatId] = useState('prebid')
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null)
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [projectName, setProjectName] = useState('')
  const [context, setContext] = useState('')
  const [status, setStatus] = useState<RunStatus>('idle')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tokensUsed, setTokensUsed] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [blockedFile, setBlockedFile] = useState<{ name: string; sizeMB: number; reason: 'oversize' | 'total' } | null>(null)

  const outputRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  const totalSize = pendingFiles.reduce((sum, f) => sum + f.size, 0)
  const totalSizeMB = totalSize / (1024 * 1024)

  function selectTool(tool: Tool) {
    setSelectedTool(tool)
    setStatus('idle')
    setOutput('')
    setError(null)
    setTokensUsed(null)
  }

  function selectCategory(catId: string) {
    setActiveCatId(catId)
    setSelectedTool(null)
    setStatus('idle')
    setOutput('')
    setError(null)
    setTokensUsed(null)
  }

  function resetRun() {
    setStatus('idle')
    setOutput('')
    setError(null)
    setTokensUsed(null)
  }

  async function handleFiles(incoming: FileList | File[]) {
    const filesArr = Array.from(incoming)

    // Check each file individually
    for (const f of filesArr) {
      if (f.size > MAX_FILE_SIZE) {
        setBlockedFile({ name: f.name, sizeMB: f.size / (1024 * 1024), reason: 'oversize' })
        return
      }
    }

    // Check combined total
    const newTotal = totalSize + filesArr.reduce((s, f) => s + f.size, 0)
    if (newTotal > MAX_TOTAL_SIZE) {
      const newestFile = filesArr[filesArr.length - 1]
      setBlockedFile({ name: newestFile.name, sizeMB: newTotal / (1024 * 1024), reason: 'total' })
      return
    }

    // Dedupe by name
    const existingNames = new Set(pendingFiles.map(f => f.name))
    const newPending: PendingFile[] = filesArr
      .filter(f => !existingNames.has(f.name))
      .map(f => ({
        file: f,
        name: f.name,
        size: f.size,
        sizeFormatted: formatSize(f.size),
        uploading: true,
      }))

    if (newPending.length === 0) return

    setPendingFiles(prev => [...prev, ...newPending])

    // Upload each to Supabase
    for (const pf of newPending) {
      try {
        const uploaded = await uploadFileToSupabase(pf.file)
        setPendingFiles(prev => prev.map(f =>
          f.name === pf.name ? { ...f, uploaded, uploading: false } : f
        ))
      } catch (err: any) {
        setPendingFiles(prev => prev.map(f =>
          f.name === pf.name ? { ...f, uploading: false, error: err.message } : f
        ))
      }
    }
  }

  async function removeFile(idx: number) {
    const target = pendingFiles[idx]
    if (target.uploaded?.path) {
      try {
        await deleteFileFromSupabase(target.uploaded.path)
      } catch (err) {
        console.warn('Failed to delete from storage', err)
      }
    }
    setPendingFiles(prev => prev.filter((_, i) => i !== idx))
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }, [pendingFiles, totalSize])

  const activeCat = CATEGORIES.find(c => c.id === activeCatId)!

  async function handleRun() {
    if (!selectedTool) { setError('Select a tool first.'); return }
    if (!projectName.trim()) { setError('Enter a project name.'); return }

    // Make sure no files are still uploading
    if (pendingFiles.some(f => f.uploading)) {
      setError('Files still uploading. Wait a moment.')
      return
    }

    // Filter to successfully uploaded files only
    const readyFiles = pendingFiles.filter(f => f.uploaded && !f.error)
    const failedFiles = pendingFiles.filter(f => f.error)
    if (failedFiles.length > 0) {
      setError(`${failedFiles.length} file(s) failed to upload. Remove them and retry.`)
      return
    }

    setStatus('running')
    setOutput('')
    setError(null)
    setTokensUsed(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }

      const fileRefs = readyFiles.map(f => ({
        name: f.uploaded!.name,
        signedUrl: f.uploaded!.signedUrl,
        mimeType: f.uploaded!.mimeType,
        path: f.uploaded!.path,
      }))

      const response = await fetch('/api/ironclad', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          toolId: selectedTool.id,
          projectName,
          context,
          fileRefs,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || `Request failed: ${response.status}`)
      }

      setOutput(data.output || '')
      setTokensUsed(data.tokens_used || null)
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
    a.download = `${projectName || 'ironclad'}-${selectedTool?.id || 'output'}-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleCopy() {
    if (output) navigator.clipboard.writeText(output)
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#080c12', color: '#f0f6ff', fontFamily: 'sans-serif' }}>

      {blockedFile && (
        <LargeFileModal
          fileName={blockedFile.name}
          fileSizeMB={blockedFile.sizeMB}
          reason={blockedFile.reason}
          onClose={() => setBlockedFile(null)}
          supabase={supabase}
        />
      )}

      <div style={{ background: 'linear-gradient(180deg,#050810 0%,#0d1520 100%)', borderBottom: '2px solid rgba(14,165,233,0.4)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, background: '#0ea5e9', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 14 }}>IC</div>
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
          <Link href="/dashboard" style={{ color: '#94a3b8', fontSize: '0.8rem', textDecoration: 'none' }}>← Dashboard</Link>
        </div>
      </div>

      <div style={{ background: '#0d1520', borderBottom: '1px solid rgba(14,165,233,0.15)', padding: '20px 32px' }}>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{ border: `2px dashed ${dragOver ? '#0ea5e9' : 'rgba(14,165,233,0.35)'}`, borderRadius: 6, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 24, cursor: 'pointer', background: dragOver ? 'rgba(14,165,233,0.07)' : 'rgba(14,165,233,0.03)', transition: 'all 0.2s' }}
        >
          <input ref={fileInputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.txt" style={{ display: 'none' }} onChange={e => e.target.files && handleFiles(e.target.files)} />
          <span style={{ fontSize: '2rem' }}>📁</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: '0.9rem', letterSpacing: 3, textTransform: 'uppercase', color: '#38bdf8', marginBottom: 2 }}>DROP PROJECT DOCUMENTS HERE</div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
              Up to 32 MB per file · 40 MB total per analysis · PDF, images, or text
            </div>
            {pendingFiles.length > 0 && (
              <div style={{ fontSize: '0.7rem', color: totalSize > MAX_TOTAL_SIZE * 0.85 ? '#fbbf24' : '#64748b', marginTop: 4, fontWeight: 600 }}>
                Total: {totalSizeMB.toFixed(1)} MB / 40 MB
              </div>
            )}
          </div>
          {pendingFiles.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} onClick={e => e.stopPropagation()}>
              {pendingFiles.map((f, i) => (
                <div key={i} style={{
                  background: f.error ? 'rgba(239,68,68,0.12)' : f.uploading ? 'rgba(245,158,11,0.12)' : 'rgba(14,165,233,0.12)',
                  border: `1px solid ${f.error ? 'rgba(239,68,68,0.3)' : f.uploading ? 'rgba(245,158,11,0.3)' : 'rgba(14,165,233,0.3)'}`,
                  color: f.error ? '#fca5a5' : f.uploading ? '#fbbf24' : '#38bdf8',
                  fontSize: '0.7rem', padding: '4px 10px', borderRadius: 2, display: 'flex', alignItems: 'center', gap: 6
                }}>
                  {f.uploading ? '⏳' : f.error ? '⚠️' : '📄'} {f.name} ({f.sizeFormatted})
                  {f.uploading && <span style={{ fontSize: '0.65rem' }}>uploading...</span>}
                  <button onClick={() => removeFile(i)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: 0 }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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

      <div style={{ display: 'flex', background: '#0d1520', borderBottom: '1px solid rgba(14,165,233,0.2)', padding: '0 32px', overflowX: 'auto' }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => selectCategory(cat.id)}
            style={{ padding: '12px 20px', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem', letterSpacing: 2, textTransform: 'uppercase', color: activeCatId === cat.id ? '#38bdf8' : '#94a3b8', borderBottom: `3px solid ${activeCatId === cat.id ? '#0ea5e9' : 'transparent'}`, background: activeCatId === cat.id ? 'rgba(14,165,233,0.06)' : 'none', border: 'none', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {cat.icon} {cat.name}
            <span style={{ background: activeCatId === cat.id ? 'rgba(14,165,233,0.25)' : '#1e2d42', color: activeCatId === cat.id ? '#38bdf8' : '#94a3b8', fontSize: '0.6rem', padding: '1px 5px', borderRadius: 2 }}>
              {cat.tools.length}
            </span>
          </button>
        ))}
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        <div style={{ flex: 1, padding: '24px 32px', overflowY: 'auto' }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 900, fontSize: '1.2rem', letterSpacing: 4, textTransform: 'uppercase', color: '#f0f6ff' }}>{activeCat.icon} {activeCat.name}</div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>{activeCat.desc}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 14 }}>
            {activeCat.tools.map(tool => (
              <div
                key={tool.id}
                onClick={() => selectTool(tool)}
                style={{ background: selectedTool?.id === tool.id ? 'rgba(14,165,233,0.12)' : '#0d1520', border: `1px solid ${selectedTool?.id === tool.id ? '#0ea5e9' : 'rgba(14,165,233,0.12)'}`, borderRadius: 4, padding: 18, cursor: 'pointer', transition: 'all 0.15s' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                  <h3 style={{ fontWeight: 700, fontSize: '0.85rem', color: selectedTool?.id === tool.id ? '#38bdf8' : '#f0f6ff', lineHeight: 1.3 }}>{tool.name}</h3>
                  <span style={{ fontSize: '0.55rem', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: modelColor(tool.model), background: tool.model === 'sonnet' ? 'rgba(245,158,11,0.1)' : 'rgba(148,163,184,0.1)', padding: '2px 5px', borderRadius: 2, flexShrink: 0, marginLeft: 6 }}>
                    {tool.model === 'sonnet' ? 'Sonnet' : 'Haiku'}
                  </span>
                </div>
                <p style={{ fontSize: '0.72rem', color: '#94a3b8', lineHeight: 1.5, marginBottom: 12 }}>{tool.desc}</p>
                <button
                  onClick={e => { e.stopPropagation(); selectTool(tool) }}
                  style={{ background: 'rgba(14,165,233,0.15)', border: '1px solid rgba(14,165,233,0.3)', color: '#38bdf8', fontSize: '0.65rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', padding: '6px 12px', borderRadius: 2, cursor: 'pointer' }}
                >
                  ▶ SELECT TOOL
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ width: 480, borderLeft: '1px solid rgba(14,165,233,0.15)', display: 'flex', flexDirection: 'column', background: '#0d1520' }}>

          <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(14,165,233,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#94a3b8' }}>
              {selectedTool ? `${activeCat.name} → ${selectedTool.name}` : 'Select a Tool'}
            </div>
            {status === 'running' && <span style={{ fontSize: '0.65rem', color: '#0ea5e9', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>● ANALYZING...</span>}
            {status === 'complete' && <span style={{ fontSize: '0.65rem', color: '#22c55e', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>✓ COMPLETE</span>}
          </div>

          {selectedTool && status === 'idle' && (
            <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(14,165,233,0.1)' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 6 }}>Additional Context (Optional)</div>
              <textarea
                value={context}
                onChange={e => setContext(e.target.value)}
                placeholder="Add any specific questions, project details, or focus areas..."
                rows={3}
                style={{ width: '100%', background: 'rgba(14,165,233,0.05)', border: '1px solid rgba(14,165,233,0.2)', borderRadius: 4, padding: '8px 10px', color: '#f0f6ff', fontSize: '0.78rem', resize: 'none', outline: 'none' }}
              />
            </div>
          )}

          {selectedTool && (status === 'idle' || status === 'error') && (
            <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(14,165,233,0.1)' }}>
              {error && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: '0.75rem', padding: '8px 12px', borderRadius: 4, marginBottom: 10 }}>
                  {error}
                </div>
              )}
              <button
                onClick={handleRun}
                style={{ width: '100%', background: '#0ea5e9', border: 'none', color: '#fff', fontWeight: 900, fontSize: '0.75rem', letterSpacing: 3, textTransform: 'uppercase', padding: '12px', borderRadius: 4, cursor: 'pointer' }}
              >
                ▶ RUN THIS TOOL
              </button>
              {pendingFiles.length === 0 && (
                <div style={{ fontSize: '0.65rem', color: '#94a3b8', textAlign: 'center', marginTop: 8 }}>
                  No documents uploaded — will generate a general framework
                </div>
              )}
            </div>
          )}

          <div ref={outputRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
            {status === 'idle' && !selectedTool && (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem', padding: 24 }}>
                Select a tool from the grid and click Run This Tool.
              </div>
            )}
            {status === 'idle' && selectedTool && (
              <div style={{ color: '#94a3b8', fontSize: '0.78rem', lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, color: '#38bdf8', marginBottom: 8, fontSize: '0.8rem' }}>{selectedTool.name}</div>
                <div>{selectedTool.desc}</div>
                <div style={{ marginTop: 12, padding: '8px 10px', background: 'rgba(14,165,233,0.05)', borderRadius: 4, border: '1px solid rgba(14,165,233,0.1)' }}>
                  <span style={{ fontWeight: 700, color: modelColor(selectedTool.model) }}>
                    {selectedTool.model === 'sonnet' ? '⚡ Sonnet' : '◆ Haiku'}
                  </span>
                  <span style={{ marginLeft: 6, fontSize: '0.7rem' }}>
                    {selectedTool.model === 'sonnet' ? '— Deep forensic analysis' : '— Fast document generation'}
                  </span>
                </div>
              </div>
            )}
            {status === 'running' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
                <div style={{ width: 40, height: 40, border: '3px solid rgba(14,165,233,0.2)', borderTop: '3px solid #0ea5e9', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <div style={{ color: '#94a3b8', fontSize: '0.8rem', textAlign: 'center' }}>
                  Analyzing documents...<br />
                  <span style={{ fontSize: '0.7rem', color: '#64748b' }}>This may take 30–120 seconds for large files</span>
                </div>
                <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
              </div>
            )}
            {status === 'complete' && output && (
              <pre style={{ fontSize: '0.78rem', color: '#cbd5e1', fontFamily: 'monospace', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                {output}
              </pre>
            )}
            {status === 'complete' && !output && (
              <div style={{ color: '#94a3b8', fontSize: '0.8rem', textAlign: 'center', padding: 24 }}>
                Run completed but no output was returned. Try again.
              </div>
            )}
            {status === 'error' && (
              <div style={{ color: '#fca5a5', fontSize: '0.8rem', padding: 8 }}>{error}</div>
            )}
          </div>

          {status === 'complete' && (
            <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(14,165,233,0.15)', display: 'flex', gap: 8, alignItems: 'center' }}>
              {tokensUsed && (
                <span style={{ fontSize: '0.65rem', color: '#94a3b8', marginRight: 'auto' }}>
                  {tokensUsed.toLocaleString()} tokens used
                </span>
              )}
              <button onClick={handleCopy} style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)', color: '#38bdf8', fontSize: '0.65rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', padding: '6px 12px', borderRadius: 2, cursor: 'pointer' }}>COPY</button>
              <button onClick={handleExport} style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)', color: '#38bdf8', fontSize: '0.65rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', padding: '6px 12px', borderRadius: 2, cursor: 'pointer' }}>EXPORT TXT</button>
              <button onClick={resetRun} style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)', color: '#38bdf8', fontSize: '0.65rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', padding: '6px 12px', borderRadius: 2, cursor: 'pointer' }}>NEW RUN</button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

function LargeFileModal({ fileName, fileSizeMB, reason, onClose, supabase }: {
  fileName: string
  fileSizeMB: number
  reason: 'oversize' | 'total'
  onClose: () => void
  supabase: ReturnType<typeof createBrowserClient>
}) {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.email) setEmail(user.email)
    })()
  }, [supabase])

  async function handleSubmit() {
    if (!email.trim()) { setSubmitError('Enter your email.'); return }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          feature: 'large_plan_set_mode',
          file_size_mb: Math.round(fileSizeMB * 10) / 10,
          user_id: user?.id || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setSubmitted(true)
    } catch (err: any) {
      setSubmitError(err.message || 'Could not save. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const title = reason === 'oversize' ? 'File Too Large' : 'Combined Upload Too Large'
  const message = reason === 'oversize'
    ? <><strong style={{ color: '#fff' }}>{fileName}</strong> is {fileSizeMB.toFixed(1)} MB. RECON handles up to 32 MB per file.<br /><br />Large-plan-set support is coming soon. For now, run analyses one file at a time, or split your plan set into sections (drawings, specs, contract).</>
    : <>Combined upload is {fileSizeMB.toFixed(1)} MB. RECON handles up to 40 MB total per analysis.<br /><br />Remove a file or run separately. Large-plan-set support is coming soon.</>

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
      <div style={{ background: '#0d1520', border: '1px solid rgba(14,165,233,0.3)', borderRadius: 6, padding: 28, maxWidth: 520, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontWeight: 900, fontSize: '1.1rem', letterSpacing: 3, textTransform: 'uppercase', color: '#38bdf8' }}>
            📋 {title}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1, padding: 0 }}>×</button>
        </div>

        <div style={{ color: '#cbd5e1', fontSize: '0.85rem', lineHeight: 1.6, marginBottom: 18 }}>
          {message}
        </div>

        {!submitted ? (
          <>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: 8, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>
              Want early access to bigger plan sets?
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                style={{ flex: 1, background: 'rgba(14,165,233,0.05)', border: '1px solid rgba(14,165,233,0.25)', borderRadius: 4, padding: '10px 12px', color: '#f0f6ff', fontSize: '0.85rem', outline: 'none' }}
              />
              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{ background: '#0ea5e9', border: 'none', color: '#fff', fontWeight: 900, fontSize: '0.7rem', letterSpacing: 2, textTransform: 'uppercase', padding: '10px 18px', borderRadius: 4, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}
              >
                {submitting ? '...' : 'Notify Me'}
              </button>
            </div>
            {submitError && (
              <div style={{ marginTop: 10, fontSize: '0.75rem', color: '#fca5a5' }}>{submitError}</div>
            )}
          </>
        ) : (
          <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80', fontSize: '0.85rem', padding: '12px 16px', borderRadius: 4 }}>
            ✓ You're on the list. We'll email you when bigger plan sets are supported.
          </div>
        )}
      </div>
    </div>
  )
}