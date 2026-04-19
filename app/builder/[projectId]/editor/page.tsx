'use client'
import { useEffect, useState, useRef } from 'react'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import type { BuilderProject, BuilderFile, BuilderMessage } from '@/types/builder'
import { buildSrcdoc } from '@/lib/builder/preview'
import {
  ChevronLeft, Send, Loader2, Globe, Rocket, Plus, FileText,
  Code2, Eye, PanelLeft, LayoutTemplate, ExternalLink, RefreshCw, X, ImagePlus
} from 'lucide-react'
import { cn } from '@/lib/utils'

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })

type TabView = 'code' | 'preview' | 'split'

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
  const [tab, setTab] = useState<TabView>('split')
  const [showChat, setShowChat] = useState(true)
  const [showFiles, setShowFiles] = useState(true)
  const [deploying, setDeploying] = useState(false)
  const [deployUrl, setDeployUrl] = useState<string | null>(null)
  const [deployStatus, setDeployStatus] = useState<string | null>(null)
  const [showDeploy, setShowDeploy] = useState(false)
  const [previewKey, setPreviewKey] = useState(0)
  const [uploadedImage, setUploadedImage] = useState<{ base64: string; mediaType: string } | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const chatBottomRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    loadProject()
    loadMessages()
  }, [projectId])

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamText])

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
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      setUploadedImage({ base64, mediaType: file.type as 'image/png' | 'image/jpeg' | 'image/webp' })
    }
    reader.readAsDataURL(file)
  }

  async function sendPrompt() {
    if ((!prompt.trim() && !uploadedImage) || generating) return
    const userPrompt = prompt || 'Recreate this website design'
    const imageToSend = uploadedImage
    setPrompt('')
    setUploadedImage(null)
    setGenerating(true)
    setStreamText('')

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

    const history = messages.slice(-10).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    try {
      const res = await fetch('/api/builder/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, prompt: userPrompt, conversationHistory: history, image: imageToSend }),
      })

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
              await loadFiles()
              setPreviewKey(k => k + 1)
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
    try {
      const res = await fetch(`/api/builder/deploy/${projectId}`, { method: 'POST' })
      if (!res.ok) throw new Error('Deploy failed')
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

  const srcdoc = buildSrcdoc(files)

  const deployStatusColor = {
    ready: 'text-[#22c55e]',
    in_progress: 'text-blue-400',
    error: 'text-red-400',
    pending: 'text-gray-400',
    cancelled: 'text-gray-400',
  }[deployStatus ?? 'pending'] ?? 'text-gray-400'

  return (
    <div className="h-screen bg-[#0d1117] flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-[#30363d] flex-shrink-0">
        <button onClick={() => router.push('/builder')} className="p-1.5 text-gray-400 hover:text-white rounded">
          <ChevronLeft size={18} />
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <img src="/logo.png" alt="Wilcart" className="h-6 w-auto flex-shrink-0" />
          <span className="text-white font-semibold text-sm truncate">{project?.name ?? 'Loading...'}</span>
        </div>

        {/* Tab switcher */}
        <div className="flex bg-[#161b22] border border-[#30363d] rounded-lg p-0.5 gap-0.5">
          {(['code', 'split', 'preview'] as TabView[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-1 rounded text-xs font-medium transition-colors',
                tab === t ? 'bg-[#22c55e] text-black' : 'text-gray-400 hover:text-white'
              )}
            >
              {t === 'code' ? <Code2 size={14} /> : t === 'preview' ? <Eye size={14} /> : <LayoutTemplate size={14} />}
            </button>
          ))}
        </div>

        {/* Deploy */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push(`/builder/${projectId}/domains`)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-400 hover:text-white border border-[#30363d] hover:border-[#22c55e]/50 rounded-lg transition-colors"
          >
            <Globe size={14} /> Domains
          </button>

          {deployUrl && (
            <a href={deployUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-xs text-[#22c55e] hover:underline">
              <ExternalLink size={12} /> Live
            </a>
          )}
          <button
            onClick={() => setShowDeploy(!showDeploy)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors',
              deploying
                ? 'bg-blue-500/20 text-blue-400 cursor-wait'
                : 'bg-[#22c55e] hover:bg-[#16a34a] text-black'
            )}
          >
            {deploying ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
            {deploying ? 'Deploying...' : 'Deploy'}
          </button>
        </div>

        <button
          onClick={() => setShowChat(!showChat)}
          className={cn('p-1.5 rounded transition-colors', showChat ? 'text-[#22c55e]' : 'text-gray-400 hover:text-white')}
        >
          <PanelLeft size={18} />
        </button>
      </header>

      {/* Deploy dropdown */}
      {showDeploy && (
        <div className="absolute top-14 right-4 z-50 bg-[#161b22] border border-[#30363d] rounded-xl p-4 w-72 shadow-xl">
          <h3 className="text-white font-semibold mb-3">Deploy to Netlify</h3>

          {deployUrl && (
            <div className="mb-3 p-2 bg-[#22c55e]/10 border border-[#22c55e]/20 rounded-lg">
              <div className="flex items-center gap-1 mb-1">
                <span className={cn('text-xs font-medium', deployStatusColor)}>
                  {deployStatus === 'ready' ? 'Live' : deployStatus ?? 'Not deployed'}
                </span>
              </div>
              <a href={deployUrl} target="_blank" rel="noreferrer"
                className="text-xs text-blue-400 hover:underline break-all">{deployUrl}</a>
            </div>
          )}

          <button
            onClick={() => { deploy(); setShowDeploy(false) }}
            disabled={deploying}
            className="w-full bg-[#22c55e] hover:bg-[#16a34a] text-black font-semibold py-2 rounded-lg transition-colors text-sm disabled:opacity-50"
          >
            {deploying ? 'Deploying...' : deployUrl ? 'Redeploy' : 'Deploy Now'}
          </button>

          {project?.custom_domain && (
            <div className="mt-3 pt-3 border-t border-[#30363d]">
              <div className="flex items-center gap-1 text-xs text-[#22c55e]">
                <Globe size={12} /> {project.custom_domain}
              </div>
            </div>
          )}

          <button onClick={() => setShowDeploy(false)} className="mt-2 text-xs text-gray-500 hover:text-gray-300 w-full text-center">
            Close
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* File tree */}
        {showFiles && (
          <div className="w-48 border-r border-[#30363d] flex flex-col flex-shrink-0 bg-[#0d1117]">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#30363d]">
              <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">Files</span>
              <button onClick={createNewFile} className="p-0.5 text-gray-500 hover:text-[#22c55e] rounded">
                <Plus size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {files.map(file => (
                <button
                  key={file.id}
                  onClick={() => setActiveFile(file)}
                  className={cn(
                    'w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                    activeFile?.id === file.id
                      ? 'bg-[#22c55e]/10 text-[#22c55e]'
                      : 'text-gray-400 hover:text-white hover:bg-[#161b22]'
                  )}
                >
                  <FileText size={12} className="flex-shrink-0" />
                  <span className="truncate">{file.name}</span>
                  {file.is_entry && (
                    <span className="ml-auto text-[10px] text-gray-600">entry</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Editor + Preview */}
        <div className="flex flex-1 overflow-hidden">
          {(tab === 'code' || tab === 'split') && (
            <div className={cn('flex flex-col overflow-hidden', tab === 'split' ? 'w-1/2 border-r border-[#30363d]' : 'flex-1')}>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-[#30363d] bg-[#0d1117]">
                <span className="text-xs text-gray-400">{activeFile?.path ?? 'No file selected'}</span>
              </div>
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
                    padding: { top: 8 },
                  }}
                  onChange={v => { if (v !== undefined) saveFileContent(v) }}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-600">
                  <p>Select a file</p>
                </div>
              )}
            </div>
          )}

          {(tab === 'preview' || tab === 'split') && (
            <div className={cn('flex flex-col overflow-hidden', tab === 'split' ? 'w-1/2' : 'flex-1')}>
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#30363d] bg-[#0d1117]">
                <span className="text-xs text-gray-400">Preview</span>
                <button onClick={() => setPreviewKey(k => k + 1)} className="p-1 text-gray-500 hover:text-white rounded">
                  <RefreshCw size={12} />
                </button>
              </div>
              <iframe
                key={previewKey}
                srcDoc={srcdoc}
                sandbox="allow-scripts allow-forms"
                className="flex-1 w-full border-none bg-white"
                title="preview"
              />
            </div>
          )}
        </div>

        {/* AI Chat */}
        {showChat && (
          <div className="w-80 border-l border-[#30363d] flex flex-col bg-[#0d1117] flex-shrink-0">
            <div className="px-4 py-3 border-b border-[#30363d]">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-[#22c55e] rounded-full flex items-center justify-center">
                  <span className="text-black text-[10px] font-bold">AI</span>
                </div>
                <span className="text-sm font-semibold text-white">Wilcart AI</span>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {messages.length === 0 && !streamText && (
                <div className="text-center py-8">
                  <div className="w-12 h-12 bg-[#22c55e]/10 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Code2 size={20} className="text-[#22c55e]" />
                  </div>
                  <p className="text-gray-400 text-sm">Describe the website you want to build</p>
                  <div className="mt-4 space-y-2">
                    {[
                      'Create a plumber service website',
                      'Make a modern restaurant landing page',
                      'Build a cleaning company homepage',
                    ].map(s => (
                      <button
                        key={s}
                        onClick={() => setPrompt(s)}
                        className="block w-full text-left text-xs text-gray-500 hover:text-[#22c55e] bg-[#161b22] hover:bg-[#22c55e]/5 border border-[#30363d] rounded-lg px-3 py-2 transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map(msg => (
                <div key={msg.id} className={cn('flex gap-2', msg.role === 'user' ? 'flex-row-reverse' : '')}>
                  <div className={cn(
                    'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold',
                    msg.role === 'user' ? 'bg-blue-500/20 text-blue-400' : 'bg-[#22c55e]/20 text-[#22c55e]'
                  )}>
                    {msg.role === 'user' ? 'U' : 'AI'}
                  </div>
                  <div className={cn(
                    'max-w-[85%] rounded-xl px-3 py-2 text-sm',
                    msg.role === 'user'
                      ? 'bg-blue-500/10 text-blue-100'
                      : 'bg-[#161b22] text-gray-300'
                  )}>
                    {/* Strip file blocks from display */}
                    {msg.content.replace(/<file path="[^"]+">[\s\S]*?<\/file>/g, '').trim() || 'Generated code ↑'}
                  </div>
                </div>
              ))}

              {streamText && (
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold bg-[#22c55e]/20 text-[#22c55e]">
                    AI
                  </div>
                  <div className="max-w-[85%] bg-[#161b22] rounded-xl px-3 py-2 text-sm text-gray-300">
                    {streamText.replace(/<file path="[^"]+">[\s\S]*?<\/file>/g, '').trim() || (
                      <span className="flex items-center gap-1">
                        <Loader2 size={12} className="animate-spin" /> Generating...
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-[#30363d]">
              {uploadedImage && (
                <div className="mb-2 flex items-center gap-2 bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2">
                  <img src={`data:${uploadedImage.mediaType};base64,${uploadedImage.base64}`} className="h-10 w-10 object-cover rounded" />
                  <span className="text-xs text-gray-400 flex-1">Screenshot attached</span>
                  <button onClick={() => setUploadedImage(null)} className="text-gray-500 hover:text-white"><X size={14} /></button>
                </div>
              )}
              <div className="flex gap-2">
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt() } }}
                  placeholder="Describe what you want to build or change..."
                  rows={3}
                  className="flex-1 bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-[#22c55e] focus:outline-none resize-none"
                  disabled={generating}
                />
                <div className="flex flex-col gap-1 self-end">
                  <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    title="Upload screenshot"
                    className="p-2 text-gray-400 hover:text-[#22c55e] bg-[#161b22] border border-[#30363d] rounded-lg transition-colors"
                  >
                    <ImagePlus size={16} />
                  </button>
                  <button
                    onClick={sendPrompt}
                    disabled={generating || (!prompt.trim() && !uploadedImage)}
                    className="p-2 bg-[#22c55e] hover:bg-[#16a34a] text-black rounded-lg transition-colors disabled:opacity-50"
                  >
                    {generating ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-gray-600 mt-1.5 text-center">Enter to send · Shift+Enter for new line</p>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
