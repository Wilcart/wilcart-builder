'use client'
import { useEffect, useState, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import type { BuilderProject, BuilderFile, BuilderMessage } from '@/types/builder'
import type { FileBlock } from '@/lib/builder/claude'
import { buildSrcdoc, getHtmlPages } from '@/lib/builder/preview'
import {
  ChevronLeft, Send, Loader2, Globe, Rocket, Plus, FileText,
  Code2, Eye, ExternalLink, RefreshCw, X, ImagePlus, Sparkles,
  Monitor, Smartphone, Tablet, MoreHorizontal, Wand2, Undo2, History
} from 'lucide-react'
import { cn } from '@/lib/utils'

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })

type ViewMode = 'preview' | 'code'
type DeviceSize = 'desktop' | 'tablet' | 'mobile'

const SUGGESTIONS = [
  '🔧 Create a plumber service website',
  '🍕 Make a modern restaurant landing page',
  '✨ Build a cleaning company homepage',
  '⚡ Design an electrician business site',
  '🌿 Landscaping company website',
  '🏠 Moving company landing page',
]

export default function EditorPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.projectId as string

  const [project, setProject] = useState<BuilderProject | null>(null)
  const [files, setFiles] = useState<BuilderFile[]>([])
  const [activeFile, setActiveFile] = useState<BuilderFile | null>(null)
  const [messages, setMessages] = useState<BuilderMessage[]>([])
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('preview')
  const [deviceSize, setDeviceSize] = useState<DeviceSize>('desktop')
  const [deploying, setDeploying] = useState(false)
  const [deployUrl, setDeployUrl] = useState<string | null>(null)
  const [deployStatus, setDeployStatus] = useState<string | null>(null)
  const [showDeploy, setShowDeploy] = useState(false)
  const [previewKey, setPreviewKey] = useState(0)
  const [uploadedImage, setUploadedImage] = useState<{ base64: string; mediaType: string } | null>(null)
  const [showFiles, setShowFiles] = useState(false)
  const [dotCount, setDotCount] = useState(1)
  // Version history — DB-backed snapshots (persist across page reloads)
  type Snapshot = { id: string; label: string; files: BuilderFile[]; created_at: string }
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [showHistory, setShowHistory] = useState(false)
  // Multi-page preview
  const [previewPage, setPreviewPage] = useState<string>('index.html')

  const imageInputRef = useRef<HTMLInputElement>(null)
  const chatBottomRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const dotRef = useRef<NodeJS.Timeout | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  // Keep a live ref to files so async callbacks always have the latest value
  const filesRef = useRef<BuilderFile[]>([])

  // Keep filesRef in sync so async stream callbacks always see latest files
  useEffect(() => { filesRef.current = files }, [files])

  useEffect(() => {
    loadProject()
    loadMessages()
    loadSnapshots()
  }, [projectId])

  // Listen for page navigation from iframe (internal link clicks)
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === 'navigate' && e.data.page) {
        const targetPage = e.data.page as string
        setPreviewPage(targetPage)
        const targetFile = filesRef.current.find(f => f.path === targetPage)
        if (targetFile && iframeRef.current) {
          iframeRef.current.srcdoc = buildSrcdoc(filesRef.current, targetPage)
        }
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamText])

  // Animate dots while generating
  useEffect(() => {
    if (generating) {
      dotRef.current = setInterval(() => setDotCount(d => d === 3 ? 1 : d + 1), 500)
    } else {
      if (dotRef.current) clearInterval(dotRef.current)
      setDotCount(1)
    }
    return () => { if (dotRef.current) clearInterval(dotRef.current) }
  }, [generating])

  async function loadProject() {
    const res = await fetch(`/api/builder/projects/${projectId}`)
    if (!res.ok) { router.push('/builder'); return }
    const p: BuilderProject = await res.json()
    setProject(p)
    if (p.netlify_deploy_url) setDeployUrl(p.netlify_deploy_url)
    if (p.netlify_deploy_status) setDeployStatus(p.netlify_deploy_status)
    loadFiles(p)
  }

  async function loadFiles(p?: BuilderProject) {
    const res = await fetch(`/api/builder/files/${projectId}`)
    if (!res.ok) return
    const f: BuilderFile[] = await res.json()
    setFiles(f)
    const activeId = (p ?? project)?.active_file_id
    const active = f.find(x => x.id === activeId) ?? f.find(x => x.is_entry) ?? f[0]
    if (active) setActiveFile(active)
  }

  async function loadMessages() {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { data } = await supabase
      .from('builder_messages')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
    if (data) setMessages(data)
  }

  async function loadSnapshots() {
    const res = await fetch(`/api/builder/snapshots/${projectId}`)
    if (!res.ok) return
    const rows: Array<{ id: string; label: string; file_contents: Array<{ id: string; path: string; content: string }>; created_at: string }> = await res.json()
    // Reconstruct Snapshot objects — merge stored content back into file shape
    const snaps: Snapshot[] = rows.map(row => ({
      id: row.id,
      label: row.label,
      created_at: row.created_at,
      // file_contents is [{id, path, content}] — merge with current files on revert
      files: row.file_contents as unknown as BuilderFile[],
    }))
    setSnapshots(snaps)
  }

  async function saveSnapshot(label: string) {
    const currentFiles = filesRef.current
    if (!currentFiles.some(f => f.content && f.content.length > 500)) return
    const fileContents = currentFiles.map(f => ({ id: f.id, path: f.path, content: f.content }))
    const res = await fetch(`/api/builder/snapshots/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, fileContents }),
    })
    if (!res.ok) return
    const { id } = await res.json()
    const snap: Snapshot = { id, label, files: currentFiles.map(f => ({ ...f })), created_at: new Date().toISOString() }
    setSnapshots(prev => [snap, ...prev].slice(0, 10))
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      // Resize to max 1024px on longest side — keeps payload well under 1MB
      const MAX = 1024
      let { width, height } = img
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX }
        else { width = Math.round(width * MAX / height); height = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      // JPEG at 85% quality — sharp enough for AI, small enough to send
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      setUploadedImage({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' })
      URL.revokeObjectURL(objectUrl)
    }

    img.src = objectUrl
  }

  async function sendPrompt() {
    if ((!prompt.trim() && !uploadedImage) || generating) return
    const userPrompt = prompt || 'Recreate this website design'
    const imageToSend = uploadedImage
    setPrompt('')
    setUploadedImage(null)
    setGenerating(true)
    setStreamText('')

    // Save snapshot BEFORE generation so user can revert
    // Must await so snapshot exists before generation completes
    await saveSnapshot(userPrompt.slice(0, 60))

    const userMsg: BuilderMessage = {
      id: crypto.randomUUID(),
      project_id: projectId,
      org_id: '',
      role: 'user',
      content: userPrompt,
      affected_file_ids: null,
      input_tokens: null,
      output_tokens: null,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMsg])

    // IMPORTANT: Strip <file> blocks from history to avoid context overload
    // This is why follow-up prompts were failing — sending 16000 tokens of HTML each time
    const history = messages.slice(-10).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.role === 'assistant'
        ? m.content.replace(/<file path="[^"]+">[\s\S]*?<\/file>/g, '[website code updated]').replace(/```[\s\S]*?```/g, '[code block]').trim()
        : m.content,
    }))

    try {
      const res = await fetch('/api/builder/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, prompt: userPrompt, conversationHistory: history, image: imageToSend }),
      })

      // Show HTTP-level errors in chat (not just console)
      if (!res.ok && res.status !== 200) {
        let errText = `Server error ${res.status}`
        try { const j = await res.json(); errText = j.error ?? j.message ?? errText } catch {}
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(), project_id: projectId, org_id: '', role: 'assistant' as const,
          content: `❌ ${errText}`, affected_file_ids: null, input_tokens: null, output_tokens: null,
          created_at: new Date().toISOString(),
        }])
        setGenerating(false)
        return
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        const lines = text.split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'delta') {
              accumulated += data.text
              setStreamText(accumulated)
            } else if (data.type === 'done') {
              setStreamText('')
              const assistantMsg: BuilderMessage = {
                id: crypto.randomUUID(),
                project_id: projectId,
                org_id: '',
                role: 'assistant',
                content: accumulated,
                affected_file_ids: data.updatedFileIds ?? [],
                input_tokens: null,
                output_tokens: null,
                created_at: new Date().toISOString(),
              }
              setMessages(prev => [...prev, assistantMsg])

              if (data.fileBlocks && data.fileBlocks.length > 0) {
                // Build updated files array from latest ref (avoids stale closure)
                const updatedFiles = filesRef.current.map((f: BuilderFile) => {
                  const match = data.fileBlocks.find((b: FileBlock) => b.path === f.path)
                  return match ? { ...f, content: match.content } : f
                })

                // ✅ DIRECT DOM update — bypasses React render cycle entirely
                const newSrcdoc = buildSrcdoc(updatedFiles, previewPage)
                if (iframeRef.current) {
                  iframeRef.current.srcdoc = newSrcdoc
                }

                // Sync React state for code editor / file list consistency
                setFiles(updatedFiles)
                setActiveFile(prev => {
                  if (!prev) return prev
                  const match = data.fileBlocks.find((b: FileBlock) => b.path === prev.path)
                  return match ? { ...prev, content: match.content } : prev
                })
              }
            } else if (data.type === 'error') {
              setStreamText('')
              const errMsg: BuilderMessage = {
                id: crypto.randomUUID(),
                project_id: projectId,
                org_id: '',
                role: 'assistant',
                content: `Error: ${data.message}`,
                affected_file_ids: null,
                input_tokens: null,
                output_tokens: null,
                created_at: new Date().toISOString(),
              }
              setMessages(prev => [...prev, errMsg])
            }
          } catch {}
        }
      }
    } catch (err) {
      console.error(err)
      setStreamText('')
    }
    setGenerating(false)
  }

  async function revertTo(snap: Snapshot) {
    // Merge stored content back into current file objects (keeps id/mime_type etc)
    const restoredFiles = filesRef.current.map(f => {
      const stored = (snap.files as unknown as Array<{ id: string; path: string; content: string }>)
        .find(s => s.id === f.id || s.path === f.path)
      return stored ? { ...f, content: stored.content } : f
    })
    setFiles(restoredFiles)
    filesRef.current = restoredFiles
    if (iframeRef.current) iframeRef.current.srcdoc = buildSrcdoc(restoredFiles)
    setActiveFile(prev => {
      if (!prev) return prev
      return restoredFiles.find(f => f.id === prev.id) ?? prev
    })
    // Remove this snapshot and newer ones from DB + local state
    await fetch(`/api/builder/snapshots/${projectId}/${snap.id}`, { method: 'DELETE' })
    setSnapshots(prev => prev.filter(s => new Date(s.created_at) < new Date(snap.created_at)))
    setShowHistory(false)
  }

  async function saveFileContent(content: string) {
    if (!activeFile) return
    await fetch(`/api/builder/files/${projectId}/${activeFile.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    setFiles(prev => prev.map(f => f.id === activeFile.id ? { ...f, content } : f))
    setActiveFile(prev => prev ? { ...prev, content } : prev)
  }

  async function deploy() {
    setDeploying(true)
    setDeployStatus('in_progress')
    setShowDeploy(false)
    try {
      const res = await fetch(`/api/builder/deploy/${projectId}`, { method: 'POST' })
      if (!res.ok) {
        let errMsg = 'Deploy failed'
        try { const j = await res.json(); errMsg = j.error ?? errMsg } catch {}
        setDeployStatus('error')
        setDeploying(false)
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(), project_id: projectId, org_id: '', role: 'assistant' as const,
          content: `❌ Deploy failed: ${errMsg}`, affected_file_ids: null, input_tokens: null, output_tokens: null,
          created_at: new Date().toISOString(),
        }])
        return
      }
      pollDeployStatus()
    } catch (err) {
      setDeployStatus('error')
      setDeploying(false)
    }
  }

  function pollDeployStatus() {
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/builder/deploy/${projectId}/status`)
      if (!res.ok) return
      const data = await res.json()
      setDeployStatus(data.status)
      if (data.deployUrl) setDeployUrl(data.deployUrl)
      if (data.status === 'ready' || data.status === 'error') {
        clearInterval(pollRef.current!)
        setDeploying(false)
      }
    }, 3000)
  }

  async function createNewFile() {
    const path = window.prompt('File path (e.g. styles/main.css):')
    if (!path) return
    const res = await fetch(`/api/builder/files/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    if (res.ok) {
      const file = await res.json()
      setFiles(prev => [...prev, file])
      setActiveFile(file)
    }
  }

  // Strip code blocks from message display — show only the human-readable part
  function getDisplayContent(content: string) {
    return content
      // Complete closed blocks
      .replace(/<file path="[^"]+">[\s\S]*?<\/file>/g, '')
      .replace(/<patch>[\s\S]*?<\/patch>/g, '')
      .replace(/<change>[\s\S]*?<\/change>/g, '')
      // Incomplete/truncated blocks (no closing tag — wipe everything from the opening tag onward)
      .replace(/<(file|patch|change)\b[^>]*>[\s\S]*/i, '')
      // Raw HTML fallback (Claude responded without a wrapper tag)
      .replace(/<!DOCTYPE[\s\S]*/i, '')
      .replace(/```[\s\S]*/g, '')
      .trim()
  }

  const srcdoc = buildSrcdoc(files, previewPage)
  const htmlPages = getHtmlPages(files)

  const deviceWidths = { desktop: null, tablet: 768, mobile: 390 } as const
  const devicePx = deviceWidths[deviceSize]

  return (
    <div className="h-screen bg-[#0a0a0f] flex flex-col overflow-hidden font-sans">
      {/* Top Navigation Bar */}
      <header className="h-12 flex items-center gap-3 px-4 border-b border-white/[0.06] flex-shrink-0 bg-[#0d0d14]">
        {/* Back + Logo + Project */}
        <button
          onClick={() => router.push('/builder')}
          className="flex items-center gap-1.5 text-gray-500 hover:text-white transition-colors group"
        >
          <ChevronLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <img src="/logo.png" alt="Wilcart" className="h-5 w-auto flex-shrink-0" />
          <span className="text-white/80 font-medium text-sm truncate max-w-[160px]">
            {project?.name ?? 'Loading...'}
          </span>
        </div>

        <div className="h-4 w-px bg-white/10 mx-1" />

        {/* View mode tabs */}
        <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('preview')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all',
              viewMode === 'preview'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-300'
            )}
          >
            <Eye size={13} /> Preview
          </button>
          <button
            onClick={() => setViewMode('code')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all',
              viewMode === 'code'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-300'
            )}
          >
            <Code2 size={13} /> Code
          </button>
        </div>

        {/* Device size (preview only) */}
        {viewMode === 'preview' && (
          <div className="flex items-center gap-0.5 ml-1">
            {([
              { id: 'desktop', icon: Monitor, label: 'Desktop' },
              { id: 'tablet', icon: Tablet, label: 'Tablet' },
              { id: 'mobile', icon: Smartphone, label: 'Mobile' },
            ] as const).map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setDeviceSize(id)}
                title={label}
                className={cn(
                  'p-1.5 rounded-md transition-all',
                  deviceSize === id ? 'text-[#22c55e] bg-[#22c55e]/10' : 'text-gray-600 hover:text-gray-400'
                )}
              >
                <Icon size={13} />
              </button>
            ))}
          </div>
        )}

        <div className="flex-1" />

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {/* History / Revert */}
          {snapshots.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowHistory(h => !h)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-400 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-all"
                title="Version history"
              >
                <History size={12} />
                <span className="text-[10px] bg-white/10 rounded px-1">{snapshots.length}</span>
              </button>
              {showHistory && (
                <div className="absolute top-full right-0 mt-2 z-50 bg-[#13131a] border border-white/10 rounded-xl p-3 w-72 shadow-2xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white text-xs font-semibold">Version History</span>
                    <button onClick={() => setShowHistory(false)} className="text-gray-600 hover:text-white"><X size={13} /></button>
                  </div>
                  <div className="space-y-1 max-h-56 overflow-y-auto">
                    {snapshots.map((snap, i) => (
                      <button
                        key={snap.id}
                        onClick={() => revertTo(snap)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-white/[0.06] border border-transparent hover:border-white/10 transition-all group"
                      >
                        <Undo2 size={12} className="text-gray-600 group-hover:text-[#22c55e] flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs text-gray-300 truncate">Before: "{snap.label}"</div>
                          <div className="text-[10px] text-gray-600">
                            {new Date(snap.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 pt-2 border-t border-white/[0.06]">
                    <button
                      onClick={() => snapshots[0] && revertTo(snapshots[0])}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-[#22c55e] hover:bg-[#22c55e]/10 rounded-lg transition-colors"
                    >
                      <Undo2 size={12} /> Revert last change
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {deployUrl && (
            <a
              href={deployUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-400 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-all"
            >
              <ExternalLink size={12} /> Live site
            </a>
          )}

          <button
            onClick={() => router.push(`/builder/${projectId}/domains`)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-400 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-all"
          >
            <Globe size={12} /> Domains
          </button>

          <div className="relative">
            <button
              onClick={() => setShowDeploy(!showDeploy)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                deploying
                  ? 'bg-blue-500/20 text-blue-400 cursor-wait'
                  : 'bg-[#22c55e] hover:bg-[#16a34a] text-black shadow-lg shadow-[#22c55e]/20'
              )}
            >
              {deploying ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
              {deploying ? 'Deploying...' : 'Deploy'}
            </button>

            {showDeploy && (
              <div className="absolute top-full right-0 mt-2 z-50 bg-[#13131a] border border-white/10 rounded-xl p-4 w-72 shadow-2xl">
                <h3 className="text-white font-semibold mb-3 text-sm">Deploy to Netlify</h3>
                {deployUrl && (
                  <div className="mb-3 p-2.5 bg-[#22c55e]/5 border border-[#22c55e]/20 rounded-lg">
                    <div className="text-xs font-medium text-[#22c55e] mb-1">
                      {deployStatus === 'ready' ? '● Live' : deployStatus === 'in_progress' ? '⟳ Deploying...' : '○ Not deployed'}
                    </div>
                    <a href={deployUrl} target="_blank" rel="noreferrer"
                      className="text-xs text-blue-400 hover:underline break-all">{deployUrl}</a>
                  </div>
                )}
                <button
                  onClick={deploy}
                  disabled={deploying}
                  className="w-full bg-[#22c55e] hover:bg-[#16a34a] text-black font-semibold py-2 rounded-lg transition-colors text-sm disabled:opacity-50"
                >
                  {deploying ? 'Deploying...' : deployUrl ? 'Redeploy' : 'Deploy Now'}
                </button>
                <button onClick={() => setShowDeploy(false)} className="mt-2 text-xs text-gray-600 hover:text-gray-400 w-full text-center">
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* ─── LEFT: AI Chat Panel ─── */}
        <div className="w-[340px] flex-shrink-0 flex flex-col border-r border-white/[0.06] bg-[#0d0d14]">
          {/* Chat header */}
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2.5">
            <div className="w-7 h-7 bg-gradient-to-br from-[#22c55e] to-[#16a34a] rounded-lg flex items-center justify-center shadow-lg shadow-[#22c55e]/20">
              <Wand2 size={14} className="text-black" />
            </div>
            <div>
              <div className="text-white text-sm font-semibold leading-none">Wilcart AI</div>
              <div className="text-gray-600 text-[10px] mt-0.5">Website builder</div>
            </div>
            {generating && (
              <div className="ml-auto flex items-center gap-1.5 text-[10px] text-[#22c55e]">
                <span className="w-1.5 h-1.5 bg-[#22c55e] rounded-full animate-pulse" />
                thinking
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto py-4 px-3 space-y-3 scroll-smooth">
            {messages.length === 0 && !streamText && (
              <div className="py-6 px-2">
                <div className="text-center mb-6">
                  <div className="w-14 h-14 bg-gradient-to-br from-[#22c55e]/20 to-[#22c55e]/5 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-[#22c55e]/20">
                    <Sparkles size={24} className="text-[#22c55e]" />
                  </div>
                  <p className="text-white text-sm font-medium mb-1">What should we build?</p>
                  <p className="text-gray-600 text-xs">Describe your dream website and AI will build it in seconds</p>
                </div>
                <div className="space-y-1.5">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => { setPrompt(s.replace(/^[^ ]+ /, '')); textareaRef.current?.focus() }}
                      className="w-full text-left text-xs text-gray-500 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/10 rounded-xl px-3.5 py-2.5 transition-all"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, msgIndex) => {
              const displayContent = getDisplayContent(msg.content)
              const isUser = msg.role === 'user'
              // Match this AI message to a snapshot by index (snapshots are newest-first)
              const aiMsgsBefore = !isUser ? messages.slice(0, msgIndex).filter(m => m.role === 'assistant').length : -1
              const snap = !isUser ? snapshots[snapshots.length - 1 - aiMsgsBefore] ?? null : null
              return (
                <div key={msg.id} className={cn('flex gap-2.5', isUser ? 'flex-row-reverse' : '')}>
                  {!isUser && (
                    <div className="w-6 h-6 bg-gradient-to-br from-[#22c55e] to-[#16a34a] rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm shadow-[#22c55e]/20">
                      <Wand2 size={11} className="text-black" />
                    </div>
                  )}
                  <div className="flex flex-col gap-1 max-w-[82%]">
                    <div
                      className={cn(
                        'rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                        isUser
                          ? 'bg-[#22c55e]/10 text-white border border-[#22c55e]/20 rounded-tr-sm'
                          : 'bg-white/[0.04] text-gray-300 border border-white/[0.06] rounded-tl-sm'
                      )}
                    >
                      {displayContent || (
                        <span className="flex items-center gap-1.5 text-[#22c55e] text-xs">
                          <span className="w-1.5 h-1.5 bg-[#22c55e] rounded-full" />
                          Website updated
                        </span>
                      )}
                    </div>
                    {snap && (
                      <button
                        onClick={() => revertTo(snap)}
                        className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-[#22c55e] transition-colors self-start ml-1"
                        title="Revert to before this change"
                      >
                        <Undo2 size={10} /> revert
                      </button>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Streaming message — animated build progress */}
            {generating && (() => {
              const visibleText = getDisplayContent(streamText)
              const hasCode = streamText.length > 0 && !visibleText
              const stage = !streamText ? 0 : visibleText ? 1 : streamText.length < 3000 ? 2 : streamText.length < 10000 ? 3 : 4
              const stages = [
                { icon: '🧠', label: 'Thinking', sub: 'Analyzing your request...' },
                { icon: '✍️', label: 'Planning', sub: visibleText },
                { icon: '🏗️', label: 'Building', sub: 'Writing HTML structure...' },
                { icon: '🎨', label: 'Styling', sub: 'Adding styles & animations...' },
                { icon: '✨', label: 'Finalizing', sub: 'Wrapping up the code...' },
              ]
              const current = stages[stage]
              return (
                <div className="flex gap-2.5">
                  <div className="w-6 h-6 bg-gradient-to-br from-[#22c55e] to-[#16a34a] rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm shadow-[#22c55e]/30">
                    <Wand2 size={11} className="text-black" />
                  </div>
                  <div className="max-w-[88%] bg-white/[0.04] border border-[#22c55e]/20 rounded-2xl rounded-tl-sm px-4 py-3 space-y-2.5">
                    {/* Stage indicator */}
                    <div className="flex items-center gap-2">
                      <span className="text-base leading-none">{current.icon}</span>
                      <span className="text-xs font-semibold text-[#22c55e]">{current.label}</span>
                      <span className="flex gap-0.5 ml-auto">
                        {[0,1,2].map(i => (
                          <span key={i} className={cn(
                            'w-1 h-1 rounded-full transition-all duration-300',
                            i < dotCount ? 'bg-[#22c55e]' : 'bg-white/10'
                          )} />
                        ))}
                      </span>
                    </div>
                    {/* Progress steps */}
                    <div className="space-y-1.5">
                      {stages.slice(0, stage + 1).map((s, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className={cn(
                            'w-1.5 h-1.5 rounded-full flex-shrink-0',
                            i < stage ? 'bg-[#22c55e]' : 'bg-[#22c55e] animate-pulse'
                          )} />
                          <span className={cn(
                            'text-[11px] truncate',
                            i < stage ? 'text-gray-500 line-through' : 'text-gray-300'
                          )}>
                            {i === stage && visibleText ? visibleText : s.sub}
                          </span>
                        </div>
                      ))}
                    </div>
                    {/* Token progress bar */}
                    {streamText.length > 100 && (
                      <div className="w-full h-0.5 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#22c55e]/50 to-[#22c55e] rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(95, (streamText.length / 16000) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}

            <div ref={chatBottomRef} />
          </div>

          {/* Chat Input */}
          <div className="p-3 border-t border-white/[0.06]">
            {uploadedImage && (
              <div className="mb-2 flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2">
                <img
                  src={`data:${uploadedImage.mediaType};base64,${uploadedImage.base64}`}
                  className="h-9 w-9 object-cover rounded-lg"
                  alt="Attached"
                />
                <span className="text-xs text-gray-400 flex-1">Image attached</span>
                <button onClick={() => setUploadedImage(null)} className="text-gray-600 hover:text-white transition-colors">
                  <X size={14} />
                </button>
              </div>
            )}

            <div className="relative bg-white/[0.04] border border-white/[0.08] rounded-2xl focus-within:border-[#22c55e]/40 transition-all">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt() } }}
                placeholder="Describe what to build or change..."
                rows={3}
                className="w-full bg-transparent px-4 pt-3 pb-2 text-sm text-white placeholder-gray-600 focus:outline-none resize-none"
                disabled={generating}
              />
              <div className="flex items-center justify-between px-3 pb-2.5">
                <div className="flex items-center gap-1">
                  <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    title="Attach image"
                    className="p-1.5 text-gray-600 hover:text-[#22c55e] rounded-lg transition-colors"
                  >
                    <ImagePlus size={15} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-700">⏎ send</span>
                  <button
                    onClick={sendPrompt}
                    disabled={generating || (!prompt.trim() && !uploadedImage)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all',
                      generating || (!prompt.trim() && !uploadedImage)
                        ? 'bg-white/5 text-gray-600 cursor-not-allowed'
                        : 'bg-[#22c55e] hover:bg-[#16a34a] text-black shadow-md shadow-[#22c55e]/20'
                    )}
                  >
                    {generating
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Send size={13} />
                    }
                    {generating ? 'Generating' : 'Send'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── RIGHT: Preview / Code Panel ─── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0a0f]">
          {/* Preview toolbar */}
          <div className="min-h-10 flex items-center gap-2 px-3 border-b border-white/[0.06] bg-[#0d0d14] flex-shrink-0 flex-wrap py-1">
            {viewMode === 'preview' ? (
              <>
                {/* Traffic lights */}
                <div className="flex items-center gap-1 mr-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                </div>

                {/* Page tabs — shown when multiple HTML pages exist */}
                {htmlPages.length > 1 ? (
                  <div className="flex items-center gap-1 overflow-x-auto max-w-[320px]">
                    {htmlPages.map(page => (
                      <button
                        key={page.id}
                        onClick={() => {
                          setPreviewPage(page.path)
                          if (iframeRef.current) iframeRef.current.srcdoc = buildSrcdoc(files, page.path)
                        }}
                        className={cn(
                          'flex-shrink-0 text-[11px] px-2.5 py-1 rounded-lg border transition-all whitespace-nowrap',
                          previewPage === page.path
                            ? 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/20'
                            : 'text-gray-500 border-white/[0.06] hover:text-white hover:border-white/20'
                        )}
                      >
                        {page.path.replace('.html', '').replace('index', 'Home')}
                      </button>
                    ))}
                  </div>
                ) : (
                  /* URL bar when single page */
                  <div className="flex-1 max-w-xs bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-1 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#22c55e] flex-shrink-0" />
                    <span className="text-xs text-gray-600 truncate">
                      {deployUrl ? `${deployUrl.replace('https://', '')}/${previewPage === 'index.html' ? '' : previewPage}` : `preview/${previewPage === 'index.html' ? '' : previewPage}`}
                    </span>
                  </div>
                )}

                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (iframeRef.current) {
                        const s = iframeRef.current.srcdoc
                        iframeRef.current.srcdoc = ''
                        requestAnimationFrame(() => { if (iframeRef.current) iframeRef.current.srcdoc = s })
                      }
                    }}
                    className="p-1.5 text-gray-600 hover:text-white rounded-lg transition-colors"
                    title="Refresh"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowFiles(!showFiles)}
                    className={cn(
                      'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg transition-colors',
                      showFiles ? 'text-[#22c55e] bg-[#22c55e]/10' : 'text-gray-500 hover:text-white'
                    )}
                  >
                    <FileText size={13} /> Files
                  </button>
                  {showFiles && files.map(file => (
                    <button
                      key={file.id}
                      onClick={() => setActiveFile(file)}
                      className={cn(
                        'text-xs px-2.5 py-1 rounded-lg border transition-all',
                        activeFile?.id === file.id
                          ? 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/20'
                          : 'text-gray-500 border-transparent hover:border-white/10 hover:text-white'
                      )}
                    >
                      {file.name}
                    </button>
                  ))}
                  <button onClick={createNewFile} className="p-1 text-gray-600 hover:text-[#22c55e] rounded-lg transition-colors" title="New file">
                    <Plus size={13} />
                  </button>
                </div>
                <div className="ml-auto text-xs text-gray-600">{activeFile?.path}</div>
              </>
            )}
          </div>

          {/* Preview iframe or Code Editor */}
          {viewMode === 'preview' ? (
            <div className="flex-1 overflow-auto bg-[#111118] flex items-start justify-center">
              {devicePx ? (
                /* Mobile / Tablet — show as device frame with scroll */
                <div className="flex-shrink-0 mt-4 mb-4 rounded-2xl overflow-hidden shadow-2xl border border-white/10"
                  style={{ width: devicePx, height: 'calc(100% - 2rem)' }}>
                  <iframe
                    ref={iframeRef}
                    srcDoc={srcdoc}
                    sandbox="allow-scripts allow-forms allow-same-origin"
                    className="w-full h-full border-none bg-white"
                    title="preview"
                  />
                </div>
              ) : (
                /* Desktop — full width */
                <iframe
                  ref={iframeRef}
                  srcDoc={srcdoc}
                  sandbox="allow-scripts allow-forms allow-same-origin"
                  className="w-full h-full border-none bg-white"
                  title="preview"
                />
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-hidden">
              {activeFile ? (
                <MonacoEditor
                  height="100%"
                  language={
                    activeFile.mime_type === 'text/css' ? 'css'
                    : activeFile.mime_type === 'text/javascript' ? 'javascript'
                    : 'html'
                  }
                  value={activeFile.content}
                  theme="vs-dark"
                  options={{
                    fontSize: 13,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    automaticLayout: true,
                    lineNumbers: 'on',
                    folding: true,
                    padding: { top: 12 },
                    fontFamily: "'Fira Code', 'JetBrains Mono', monospace",
                    fontLigatures: true,
                  }}
                  onChange={v => { if (v !== undefined) saveFileContent(v) }}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-600 h-full">
                  <p>Select a file to edit</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
