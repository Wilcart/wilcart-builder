'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { BuilderProject } from '@/types/builder'
import { Globe, ArrowLeft, Search, CheckCircle2, XCircle, Loader2, ExternalLink } from 'lucide-react'

export default function DeployPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.projectId as string

  const [project, setProject] = useState<BuilderProject | null>(null)
  const [domainQuery, setDomainQuery] = useState('')
  const [domainResults, setDomainResults] = useState<Array<{
    domainName: string; purchasable: boolean; purchasePrice: number; currency: string
  }>>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    fetch(`/api/builder/projects/${projectId}`).then(r => r.json()).then(setProject)
  }, [projectId])

  async function searchDomains() {
    if (!domainQuery.trim()) return
    setSearching(true)
    try {
      const res = await fetch(`/api/builder/domains/search?q=${encodeURIComponent(domainQuery)}`)
      if (res.ok) setDomainResults(await res.json())
    } catch {}
    setSearching(false)
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <header className="border-b border-[#30363d] px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button onClick={() => router.push(`/builder/${projectId}/editor`)}
            className="p-1.5 text-gray-400 hover:text-white rounded">
            <ArrowLeft size={18} />
          </button>
          <span className="text-white font-semibold">Deploy Settings — {project?.name}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Deploy status */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Globe size={16} className="text-[#22c55e]" /> Netlify Deployment
          </h2>
          {project?.netlify_deploy_url ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-[#22c55e]" />
                <span className="text-sm text-gray-300">Site deployed</span>
              </div>
              <a href={project.netlify_deploy_url} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-sm text-blue-400 hover:underline">
                <ExternalLink size={14} /> {project.netlify_deploy_url}
              </a>
              {project.custom_domain && (
                <div className="flex items-center gap-2 text-sm text-[#22c55e]">
                  <CheckCircle2 size={14} /> Custom domain: {project.custom_domain}
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-400 text-sm">Deploy your site from the editor to see deployment info here.</p>
          )}
        </div>

        {/* Domain search */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5">
          <h2 className="text-white font-semibold mb-2 flex items-center gap-2">
            <Globe size={16} className="text-[#22c55e]" /> Get a Domain
          </h2>
          <p className="text-gray-400 text-sm mb-4">Search for available domains via name.com</p>

          <div className="flex gap-2">
            <input
              type="text"
              value={domainQuery}
              onChange={e => setDomainQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchDomains()}
              placeholder="mybusiness"
              className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-white focus:border-[#22c55e] focus:outline-none text-sm"
            />
            <button
              onClick={searchDomains}
              disabled={searching}
              className="flex items-center gap-2 bg-[#22c55e] hover:bg-[#16a34a] text-black font-semibold px-4 py-2 rounded-lg transition-colors text-sm"
            >
              {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              Search
            </button>
          </div>

          {domainResults.length > 0 && (
            <div className="mt-4 space-y-2">
              {domainResults.map(r => (
                <div key={r.domainName} className="flex items-center justify-between p-3 bg-[#0d1117] rounded-lg border border-[#30363d]">
                  <div className="flex items-center gap-2">
                    {r.purchasable
                      ? <CheckCircle2 size={14} className="text-[#22c55e]" />
                      : <XCircle size={14} className="text-red-400" />
                    }
                    <span className="text-sm text-white">{r.domainName}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {r.purchasable && (
                      <span className="text-sm text-[#22c55e] font-medium">
                        ${r.purchasePrice?.toFixed(2)}/yr
                      </span>
                    )}
                    <span className={`text-xs ${r.purchasable ? 'text-green-400' : 'text-red-400'}`}>
                      {r.purchasable ? 'Available' : 'Taken'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
