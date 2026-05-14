'use client'

import "./print.css"
import { useState, useRef, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
  const [copyConfirm, setCopyConfirm] = useState(false)

  const outputRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Auto-scroll output into view when complete
  useEffect(() => {
    if (status === 'complete' && outputRef.current) {
      outputRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [status])

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

    for (const f of filesArr) {
      if (f.size > MAX_FILE_SIZE) {
        setBlockedFile({ name: f.name, sizeMB: f.size / (1024 * 1024), reason: 'oversize' })
        return
      }
    }

    const newTotal = totalSize + filesArr.reduce((s, f) => s + f.size, 0)
    if (newTotal > MAX_TOTAL_SIZE) {
      const newestFile = filesArr[filesArr.length - 1]
      setBlockedFile({ name: newestFile.name, sizeMB: newTotal / (1024 * 1024), reason: 'total' })
      return
    }

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

    if (pendingFiles.some(f => f.uploading)) {
      setError('Files still uploading. Wait a moment.')
      return
    }

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
    const filename = `${projectName || 'ironclad'}-${selectedTool?.id || 'output'}-${new Date().toISOString().split('T')[0]}.txt`
    const blob = new Blob([output], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function handleCopy() {
    if (!output) return
    navigator.clipboard.writeText(output)
    setCopyConfirm(true)
    setTimeout(() => setCopyConfirm(false), 1500)
  }

  function handlePrint() {
    window.print()
  }

  return (
    <div style={{ minHeight: '100vh', background: '#080c12', color: '#f0f6ff', fontFamily: 'Arial, sans-serif' }}>

      {blockedFile && (
        <LargeFileModal
          fileName={blockedFile.name}
          fileSizeMB={blockedFile.sizeMB}
          reason={blockedFile.reason}
          onClose={() => setBlockedFile(null)}
          supabase={supabase}
        />
      )}

      {/* HEADER */}
      <div className="no-print" style={{ background: 'linear-gradient(180deg,#050810 0%,#0d1520 100%)', borderBottom: '2px solid rgba(14,165,233,0.4)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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

      {/* MAIN CENTERED COLUMN */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 24px 80px' }}>

        {/* FILE DROP ZONE */}
        <div className="no-print" style={{ marginBottom: 20 }}>
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

        {/* PROJECT NAME */}
        <div className="no-print" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#94a3b8', flexShrink: 0 }}>Project Name</span>
          <input
            type="text"
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            placeholder="e.g. Dolson Self Storage — Phase 2"
            style={{ flex: 1, background: 'rgba(14,165,233,0.05)', border: '1px solid rgba(14,165,233,0.2)', borderRadius: 4, padding: '10px 14px', color: '#f0f6ff', fontSize: '0.9rem', outline: 'none', fontFamily: 'Arial, sans-serif' }}
          />
        </div>

        {/* CATEGORY TABS */}
        <div className="no-print" style={{ display: 'flex', borderBottom: '1px solid rgba(14,165,233,0.2)', marginBottom: 20, overflowX: 'auto' }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => selectCategory(cat.id)}
              style={{ padding: '12px 18px', cursor: 'pointer', fontWeight: 700, fontSize: '0.75rem', letterSpacing: 2, textTransform: 'uppercase', color: activeCatId === cat.id ? '#38bdf8' : '#94a3b8', borderBottom: `3px solid ${activeCatId === cat.id ? '#0ea5e9' : 'transparent'}`, background: activeCatId === cat.id ? 'rgba(14,165,233,0.06)' : 'none', border: 'none', borderBottomWidth: 3, borderBottomStyle: 'solid', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'Arial, sans-serif' }}
            >
              {cat.icon} {cat.name}
              <span style={{ background: activeCatId === cat.id ? 'rgba(14,165,233,0.25)' : '#1e2d42', color: activeCatId === cat.id ? '#38bdf8' : '#94a3b8', fontSize: '0.6rem', padding: '1px 5px', borderRadius: 2 }}>
                {cat.tools.length}
              </span>
            </button>
          ))}
        </div>

        {/* CATEGORY HEADER */}
        <div className="no-print" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 900, fontSize: '1.2rem', letterSpacing: 4, textTransform: 'uppercase', color: '#f0f6ff' }}>{activeCat.icon} {activeCat.name}</div>
          <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: 4 }}>{activeCat.desc}</div>
        </div>

        {/* TOOL GRID */}
        <div className="no-print" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 14, marginBottom: 24 }}>
          {activeCat.tools.map(tool => (
            <div
              key={tool.id}
              onClick={() => selectTool(tool)}
              style={{ background: selectedTool?.id === tool.id ? 'rgba(14,165,233,0.12)' : '#0d1520', border: `1px solid ${selectedTool?.id === tool.id ? '#0ea5e9' : 'rgba(14,165,233,0.12)'}`, borderRadius: 4, padding: 18, cursor: 'pointer', transition: 'all 0.15s' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                <h3 style={{ fontWeight: 700, fontSize: '0.9rem', color: selectedTool?.id === tool.id ? '#38bdf8' : '#f0f6ff', lineHeight: 1.3, margin: 0 }}>{tool.name}</h3>
                <span style={{ fontSize: '0.55rem', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: modelColor(tool.model), background: tool.model === 'sonnet' ? 'rgba(245,158,11,0.1)' : 'rgba(148,163,184,0.1)', padding: '2px 5px', borderRadius: 2, flexShrink: 0, marginLeft: 6 }}>
                  {tool.model === 'sonnet' ? 'Sonnet' : 'Haiku'}
                </span>
              </div>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.5, marginBottom: 0, marginTop: 0 }}>{tool.desc}</p>
            </div>
          ))}
        </div>

        {/* CONTEXT + RUN — visible when tool selected and not yet running */}
        {selectedTool && (status === 'idle' || status === 'error') && (
          <div className="no-print" style={{ background: '#0d1520', border: '1px solid rgba(14,165,233,0.2)', borderRadius: 6, padding: 20, marginBottom: 24 }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 4 }}>SELECTED TOOL</div>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: '#38bdf8', marginBottom: 14 }}>{selectedTool.name}</div>

            <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#94a3b8', marginBottom: 6 }}>Additional Context (Optional)</div>
            <textarea
              value={context}
              onChange={e => setContext(e.target.value)}
              placeholder="Add any specific questions, project details, or focus areas..."
              rows={3}
              style={{ width: '100%', background: 'rgba(14,165,233,0.05)', border: '1px solid rgba(14,165,233,0.2)', borderRadius: 4, padding: '10px 12px', color: '#f0f6ff', fontSize: '0.85rem', resize: 'vertical', outline: 'none', fontFamily: 'Arial, sans-serif', marginBottom: 14, boxSizing: 'border-box' }}
            />

            {error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: '0.8rem', padding: '10px 14px', borderRadius: 4, marginBottom: 14 }}>
                {error}
              </div>
            )}

            <button
              onClick={handleRun}
              style={{ width: '100%', background: '#0ea5e9', border: 'none', color: '#fff', fontWeight: 900, fontSize: '0.85rem', letterSpacing: 3, textTransform: 'uppercase', padding: '14px', borderRadius: 4, cursor: 'pointer', fontFamily: 'Arial, sans-serif' }}
            >
              ▶ RUN THIS TOOL
            </button>
            {pendingFiles.length === 0 && (
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', textAlign: 'center', marginTop: 8 }}>
                No documents uploaded — will generate a general framework
              </div>
            )}
          </div>
        )}

        {/* RUNNING STATE */}
        {status === 'running' && (
          <div className="no-print" style={{ background: '#0d1520', border: '1px solid rgba(14,165,233,0.2)', borderRadius: 6, padding: 40, textAlign: 'center', marginBottom: 24 }}>
            <div style={{ width: 48, height: 48, border: '4px solid rgba(14,165,233,0.2)', borderTop: '4px solid #0ea5e9', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
            <div style={{ color: '#38bdf8', fontSize: '0.85rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>● ANALYZING DOCUMENTS</div>
            <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: 6 }}>This may take 30–120 seconds for large files</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {/* OUTPUT */}
        {status === 'complete' && output && (
          <div ref={outputRef} className="print-content" style={{ background: '#0d1520', border: '1px solid rgba(14,165,233,0.2)', borderRadius: 6, padding: '32px 40px', marginBottom: 16, fontFamily: 'Arial, sans-serif' }}>
            <div className="markdown-body" style={{ color: '#e2e8f0', fontSize: 15, lineHeight: 1.7 }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ node, ...props }) => <h1 style={{ fontWeight: 900, fontSize: 24, color: '#f0f6ff', marginTop: '1.5em', marginBottom: '0.5em', letterSpacing: 1 }} {...props} />,
                  h2: ({ node, ...props }) => <h2 style={{ fontWeight: 800, fontSize: 20, color: '#f0f6ff', marginTop: '1.4em', marginBottom: '0.5em' }} {...props} />,
                  h3: ({ node, ...props }) => <h3 style={{ fontWeight: 800, fontSize: 17, color: '#38bdf8', marginTop: '1.3em', marginBottom: '0.4em' }} {...props} />,
                  h4: ({ node, ...props }) => <h4 style={{ fontWeight: 700, fontSize: 15, color: '#f0f6ff', marginTop: '1.2em', marginBottom: '0.4em' }} {...props} />,
                  p: ({ node, ...props }) => <p style={{ fontSize: 15, lineHeight: 1.7, marginTop: '0.5em', marginBottom: '0.8em' }} {...props} />,
                  ul: ({ node, ...props }) => <ul style={{ paddingLeft: '1.6em', marginTop: '0.4em', marginBottom: '0.8em' }} {...props} />,
                  ol: ({ node, ...props }) => <ol style={{ paddingLeft: '1.6em', marginTop: '0.4em', marginBottom: '0.8em' }} {...props} />,
                  li: ({ node, ...props }) => <li style={{ marginBottom: '0.3em', lineHeight: 1.6 }} {...props} />,
                  strong: ({ node, ...props }) => <strong style={{ color: '#f0f6ff', fontWeight: 800 }} {...props} />,
                  em: ({ node, ...props }) => <em style={{ color: '#cbd5e1' }} {...props} />,
                  code: ({ node, ...props }) => (
                    <code
                      className="citation"
                      style={{
                        background: 'rgba(14,165,233,0.12)',
                        color: '#7dd3fc',
                        padding: '1px 6px',
                        borderRadius: 3,
                        fontSize: '0.88em',
                        fontFamily: 'Consolas, Monaco, monospace',
                      }}
                      {...props}
                    />
                  ),
                  pre: ({ node, ...props }) => (
                    <pre
                      style={{
                        background: 'rgba(8,12,18,0.6)',
                        border: '1px solid rgba(14,165,233,0.15)',
                        borderRadius: 4,
                        padding: 14,
                        overflowX: 'auto',
                        marginTop: '0.6em',
                        marginBottom: '0.8em',
                        fontSize: 14,
                        lineHeight: 1.5,
                      }}
                      {...props}
                    />
                  ),
                  table: ({ node, ...props }) => (
                    <div style={{ overflowX: 'auto', marginTop: '0.8em', marginBottom: '1em' }}>
                      <table
                        style={{
                          borderCollapse: 'collapse',
                          width: '100%',
                          fontSize: 14,
                        }}
                        {...props}
                      />
                    </div>
                  ),
                  th: ({ node, ...props }) => (
                    <th
                      style={{
                        background: 'rgba(14,165,233,0.12)',
                        border: '1px solid rgba(14,165,233,0.25)',
                        padding: '8px 12px',
                        textAlign: 'left',
                        fontWeight: 800,
                        color: '#f0f6ff',
                      }}
                      {...props}
                    />
                  ),
                  td: ({ node, ...props }) => (
                    <td
                      style={{
                        border: '1px solid rgba(14,165,233,0.15)',
                        padding: '8px 12px',
                        verticalAlign: 'top',
                      }}
                      {...props}
                    />
                  ),
                  blockquote: ({ node, ...props }) => (
                    <blockquote
                      style={{
                        borderLeft: '3px solid #0ea5e9',
                        paddingLeft: 14,
                        margin: '0.8em 0',
                        color: '#cbd5e1',
                        fontStyle: 'italic',
                      }}
                      {...props}
                    />
                  ),
                  hr: ({ node, ...props }) => (
                    <hr
                      style={{
                        border: 'none',
                        borderTop: '1px solid rgba(14,165,233,0.2)',
                        margin: '1.4em 0',
                      }}
                      {...props}
                    />
                  ),
                  a: ({ node, ...props }) => (
                    <a
                      style={{ color: '#38bdf8', textDecoration: 'underline' }}
                      target="_blank"
                      rel="noopener noreferrer"
                      {...props}
                    />
                  ),
                }}
              >
                {output}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {/* ACTION BAR */}
        {status === 'complete' && output && (
          <div className="no-print" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
            {tokensUsed && (
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', marginRight: 'auto' }}>
                {tokensUsed.toLocaleString()} tokens used
              </span>
            )}
            <button onClick={handleCopy} style={{ background: copyConfirm ? 'rgba(34,197,94,0.18)' : 'rgba(14,165,233,0.12)', border: `1px solid ${copyConfirm ? 'rgba(34,197,94,0.4)' : 'rgba(14,165,233,0.25)'}`, color: copyConfirm ? '#4ade80' : '#38bdf8', fontSize: '0.7rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: 'Arial, sans-serif' }}>
              {copyConfirm ? '✓ COPIED' : 'COPY'}
            </button>
            <button onClick={handleExport} style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)', color: '#38bdf8', fontSize: '0.7rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: 'Arial, sans-serif' }}>EXPORT TXT</button>
            <button onClick={handlePrint} style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)', color: '#38bdf8', fontSize: '0.7rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: 'Arial, sans-serif' }}>🖨 PRINT</button>
            <button onClick={resetRun} style={{ background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)', color: '#38bdf8', fontSize: '0.7rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', padding: '8px 14px', borderRadius: 2, cursor: 'pointer', fontFamily: 'Arial, sans-serif' }}>NEW RUN</button>
          </div>
        )}

        {status === 'complete' && !output && (
          <div className="no-print" style={{ color: '#94a3b8', fontSize: '0.85rem', textAlign: 'center', padding: 24, background: '#0d1520', border: '1px solid rgba(14,165,233,0.15)', borderRadius: 6 }}>
            Run completed but no output was returned. Try again.
          </div>
        )}

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