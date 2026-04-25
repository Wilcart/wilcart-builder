'use client'
import { useEffect, useState, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import type { BuilderProject, BuilderFile, BuilderMessage } from '@/types/builder'
import type { FileBlock } from '@/lib/builder/claude'
import { buildSrcdoc } from '@/lib/builder/preview'
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
  // Version history — snapshots before each AI generation (last 10)
  const [fileHistory, setFileHistory] = useState<Array<{ files: BuilderFile[]; label: string }>>([])
  const [showHistory, setShowHistory] = useState(false)

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
  }, [projectId])

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
    if (filesRef.current.some(f => f.content && f.content.length > 500)) {
      setFileHistory(prev => [
        ...prev.slice(-9),
        { files: filesRef.current.map(f => ({ ...f })), label: userPrompt.slice(0, 50) },
      ])
    }

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
                // This is what makes the preview update instantly without page reload
                const newSrcdoc = buildSrcdoc(updatedFiles)
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

  function revertTo(index: number) {
    const snapshot = fileHistory[index]
    if (!snapshot) return
    // Restore files
    setFiles(snapshot.files)
    if (iframeRef.current) iframeRef.current.srcdoc = buildSrcdoc(snapshot.files)
    setActiveFile(prev => {
      if (!prev) return prev
      return snapshot.files.find(f => f.id === prev.id) ?? prev
    })
    filesRef.current = snapshot.files
    // Trim history to before this snapshot
    setFileHistory(prev => prev.slice(0, index))
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
      .replace(/<file path="[^"]+">[\s\S]*?<\/file>/g, '')
      .replace(/<patch>[\s\S]*?<\/patch>/g, '')
      .replace(/<change>[\s\S]*?<\/change>/g, '')
      .trim()
  }

  const srcdoc = buildSrcdoc(files)

  const previewWidth = {
    desktop: '100%',
    tablet: '768px',
    mobile: '390px',
  }[deviceSize]

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
          {fileHistory.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowHistory(h => !h)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-400 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition-all"
                title="Version history"
              >
                <History size={12} />
                <span className="text-[10px] bg-white/10 rounded px-1">{fileHistory.length}</span>
              </button>
              {showHistory && (
                <div className="absolute top-full right-0 mt-2 z-50 bg-[#13131a] border border-white/10 rounded-xl p-3 w-72 shadow-2xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white text-xs font-semibold">Version History</span>
                    <button onClick={() => setShowHistory(false)} className="text-gray-600 hover:text-white"><X size={13} /></button>
                  </div>
                  <div className="space-y-1 max-h-56 overflow-y-auto">
                    {[...fileHistory].reverse().map((snap, i) => {
                      const realIndex = fileHistory.length - 1 - i
                      return (
                        <button
                          key={realIndex}
                          onClick={() => revertTo(realIndex)}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-white/[0.06] border border-transparent hover:border-white/10 transition-all group"
                        >
                          <Undo2 size={12} className="text-gray-600 group-hover:text-[#22c55e] flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs text-gray-300 truncate">Before: "{snap.label}"</div>
                            <div className="text-[10px] text-gray-600">v{realIndex + 1}</div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  <div className="mt-2 pt-2 border-t border-white/[0.06]">
                    <button
                      onClick={() => revertTo(fileHistory.length - 1)}
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
              // Find if there's a history snapshot that was saved before this AI message
              // AI messages are at odd indexes (0=user,1=ai,2=user,3=ai...)
              // history[i] = snapshot saved before messages[i*2+1] was generated
              const aiMsgNumber = !isUser
                ? messages.slice(0, msgIndex).filter(m => m.role === 'assistant').length
                : -1
              const hasSnapshot = !isUser && aiMsgNumber < fileHistory.length
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
                    {hasSnapshot && (
                      <button
                        onClick={() => revertTo(aiMsgNumber)}
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

            {/* Streaming message */}
            {generating && (
              <div className="flex gap-2.5">
                <div className="w-6 h-6 bg-gradient-to-br from-[#22c55e] to-[#16a34a] rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Wand2 size={11} className="text-black" />
                </div>
                <div className="max-w-[82%] bg-white/[0.04] border border-white/[0.06] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm text-gray-300 leading-relaxed">
                  {streamText ? (
                    <span>
                      {getDisplayContent(streamText) || (
                        <span className="flex items-center gap-1 text-[#22c55e]">
                          <Loader2 size={12} className="animate-spin" />
                          Building your website{'.'.repeat(dotCount)}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[#22c55e]">
                      <Loader2 size={12} className="animate-spin" />
                      Building your website{'.'.repeat(dotCount)}
                    </span>
                  )}
                </div>
              </div>
            )}

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
          <div className="h-10 flex items-center gap-2 px-4 border-b border-white/[0.06] bg-[#0d0d14] flex-shrink-0">
            {viewMode === 'preview' ? (
              <>
                {/* Browser-like URL bar */}
                <div className="flex items-center gap-1.5 mr-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                </div>
                <div className="flex-1 max-w-sm mx-auto bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-1 flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
                  <span className="text-xs text-gray-600 truncate">
                    {deployUrl ? deployUrl.replace('https://', '') : 'preview — localhost'}
                  </span>
                </div>
                <div className="flex items-center gap-1 ml-auto">
                  <button
                    onClick={() => {
                      if (iframeRef.current) {
                        const current = iframeRef.current.srcdoc
                        iframeRef.current.srcdoc = ''
                        requestAnimationFrame(() => { if (iframeRef.current) iframeRef.current.srcdoc = current })
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
                  <button
                    onClick={createNewFile}
                    className="p-1 text-gray-600 hover:text-[#22c55e] rounded-lg transition-colors"
                    title="New file"
                  >
                    <Plus size={13} />
                  </button>
                </div>
                <div className="ml-auto text-xs text-gray-600">
                  {activeFile?.path}
                </div>
              </>
            )}
          </div>

          {/* Preview iframe or Code Editor */}
          {viewMode === 'preview' ? (
            <div className="flex-1 overflow-auto flex justify-center bg-[#111118] p-0">
              <div
                style={{ width: previewWidth, maxWidth: '100%' }}
                className="h-full transition-all duration-300"
              >
                <iframe
                  ref={iframeRef}
                  srcDoc={srcdoc}
                  sandbox="allow-scripts allow-forms"
                  className="w-full h-full border-none bg-white"
                  title="preview"
                />
              </div>
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
