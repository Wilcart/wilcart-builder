'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { BuilderProject } from '@/types/builder'
import { formatRelativeTime } from '@/lib/utils'
import {
  Plus, Globe, Code2, Rocket, LogOut,
  ExternalLink, Trash2, CheckCircle2
} from 'lucide-react'
import { cn } from '@/lib/utils'

export default function BuilderDashboard() {
  const [projects, setProjects] = useState<BuilderProject[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    init()
  }, [])

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    // Auto-migrate old websites on first load
    await autoMigrateOldSites()
    await fetchProjects()
    setLoading(false)
  }

  async function autoMigrateOldSites() {
    try {
      const res = await fetch('/api/builder/migrate')
      if (!res.ok) return
      const oldSites = await res.json()
      // Migrate all unmigrated sites silently in background
      for (const site of oldSites) {
        await fetch('/api/builder/migrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ websiteId: site.id }),
        })
      }
    } catch {}
  }

  async function fetchProjects() {
    const res = await fetch('/api/builder/projects')
    if (res.ok) setProjects(await res.json())
  }

  async function createProject(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    const res = await fetch('/api/builder/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName || 'Untitled Project', description: newDesc }),
    })
    if (res.ok) {
      const project = await res.json()
      router.push(`/builder/${project.id}/editor`)
    }
    setCreating(false)
  }

  async function deleteProject(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('Delete this project?')) return
    await fetch(`/api/builder/projects/${id}`, { method: 'DELETE' })
    setProjects(p => p.filter(x => x.id !== id))
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const statusColor: Record<string, string> = {
    draft: 'text-gray-400 bg-gray-400/10',
    building: 'text-yellow-400 bg-yellow-400/10',
    deploying: 'text-blue-400 bg-blue-400/10',
    deployed: 'text-green-400 bg-green-400/10',
    error: 'text-red-400 bg-red-400/10',
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <header className="border-b border-[#30363d] px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Wilcart Builder" className="h-8 w-auto" />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-2 bg-[#22c55e] hover:bg-[#16a34a] text-black font-semibold px-4 py-2 rounded-lg transition-colors text-sm"
            >
              <Plus size={16} /> New Project
            </button>
            <button onClick={signOut} className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-[#161b22] transition-colors">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Total Projects', value: projects.length, icon: Code2 },
            { label: 'Live Sites', value: projects.filter(p => p.status === 'deployed').length, icon: Rocket },
            { label: 'Custom Domains', value: projects.filter(p => p.domain_connected).length, icon: Globe },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-[#161b22] border border-[#30363d] rounded-xl p-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[#22c55e]/10 rounded-lg">
                  <Icon size={18} className="text-[#22c55e]" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">{value}</div>
                  <div className="text-xs text-gray-400">{label}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <h2 className="text-lg font-semibold text-white mb-4">Your Projects</h2>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3].map(i => <div key={i} className="bg-[#161b22] border border-[#30363d] rounded-xl h-40 animate-pulse" />)}
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-[#30363d] rounded-xl">
            <Code2 size={40} className="mx-auto text-gray-600 mb-4" />
            <h3 className="text-white font-semibold mb-2">No projects yet</h3>
            <p className="text-gray-400 text-sm mb-4">Create your first AI-powered website</p>
            <button
              onClick={() => setShowNew(true)}
              className="bg-[#22c55e] hover:bg-[#16a34a] text-black font-semibold px-5 py-2 rounded-lg transition-colors text-sm"
            >
              <Plus size={14} className="inline mr-1" /> Create Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(project => (
              <div
                key={project.id}
                onClick={() => router.push(`/builder/${project.id}/editor`)}
                className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 cursor-pointer hover:border-[#22c55e]/50 transition-all group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-white truncate group-hover:text-[#22c55e] transition-colors">
                      {project.name}
                    </h3>
                    {project.description && (
                      <p className="text-gray-400 text-xs mt-0.5 truncate">{project.description}</p>
                    )}
                  </div>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium ml-2 flex-shrink-0', statusColor[project.status] ?? 'text-gray-400 bg-gray-400/10')}>
                    {project.status}
                  </span>
                </div>

                {project.custom_domain && (
                  <div className="flex items-center gap-1 text-xs text-[#22c55e] mb-2">
                    <CheckCircle2 size={11} /> {project.custom_domain}
                  </div>
                )}
                {project.netlify_deploy_url && !project.custom_domain && (
                  <div className="flex items-center gap-1 text-xs text-blue-400 mb-2">
                    <ExternalLink size={11} />
                    <span className="truncate">{project.netlify_deploy_url.replace('https://', '')}</span>
                  </div>
                )}

                <div className="flex items-center justify-between pt-3 border-t border-[#30363d]">
                  <span className="text-xs text-gray-500">{formatRelativeTime(project.updated_at)}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={e => { e.stopPropagation(); router.push(`/builder/${project.id}/domains`) }}
                      className="p-1.5 text-gray-500 hover:text-[#22c55e] rounded transition-colors"
                      title="Manage domain"
                    >
                      <Globe size={14} />
                    </button>
                    <button
                      onClick={e => deleteProject(project.id, e)}
                      className="p-1.5 text-gray-600 hover:text-red-400 rounded transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* New Project Modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6 w-full max-w-md">
            <h2 className="text-white font-bold text-lg mb-4">New Project</h2>
            <form onSubmit={createProject} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Project Name</label>
                <input
                  autoFocus type="text" value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="My Awesome Website"
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-white focus:border-[#22c55e] focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Description (optional)</label>
                <input
                  type="text" value={newDesc} onChange={e => setNewDesc(e.target.value)}
                  placeholder="A website for my plumbing business"
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-white focus:border-[#22c55e] focus:outline-none"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowNew(false); setNewName(''); setNewDesc('') }}
                  className="flex-1 border border-[#30363d] text-gray-400 hover:text-white py-2 rounded-lg transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={creating}
                  className="flex-1 bg-[#22c55e] hover:bg-[#16a34a] text-black font-semibold py-2 rounded-lg transition-colors disabled:opacity-50">
                  {creating ? 'Creating...' : 'Create & Open'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
