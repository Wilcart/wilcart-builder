'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { BuilderProject } from '@/types/builder'
import {
  Globe, ArrowLeft, CheckCircle2, Loader2, ExternalLink,
  Link2, RefreshCw, Search, ShoppingCart, AlertCircle, Copy, Check
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface OwnedDomain {
  id: string
  domain: string
  connected: boolean
  namecom_status: string
  expire_date: string
  builder_project_id: string | null
}

interface SearchResult {
  domainName: string
  purchasable: boolean
  purchasePrice: number
  renewalPrice: number
  currency: string
}

type Tab = 'buy' | 'owned' | 'external'

export default function DomainsPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.projectId as string

  const [project, setProject] = useState<BuilderProject | null>(null)
  const [ownedDomains, setOwnedDomains] = useState<OwnedDomain[]>([])
  const [tab, setTab] = useState<Tab>('buy')

  // Search & Buy
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [buying, setBuying] = useState<string | null>(null)

  // Connect owned
  const [connecting, setConnecting] = useState<string | null>(null)

  // External domain
  const [externalDomain, setExternalDomain] = useState('')
  const [connectingExternal, setConnectingExternal] = useState(false)
  const [dnsRecords, setDnsRecords] = useState<{ type: string; name: string; value: string }[] | null>(null)
  const [externalError, setExternalError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    loadProject()
    loadOwnedDomains()
  }, [projectId])

  async function loadProject() {
    const res = await fetch(`/api/builder/projects/${projectId}`)
    if (res.ok) setProject(await res.json())
  }

  async function loadOwnedDomains() {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { data } = await supabase
      .from('purchased_domains')
      .select('*')
      .order('created_at', { ascending: false })
    setOwnedDomains(data ?? [])
  }

  async function searchDomains(e: React.FormEvent) {
    e.preventDefault()
    if (!searchQuery.trim()) return
    setSearching(true)
    setResults([])
    try {
      const res = await fetch(`/api/builder/domains/search?q=${encodeURIComponent(searchQuery.trim())}`)
      const data = await res.json()
      if (Array.isArray(data)) setResults(data)
    } finally {
      setSearching(false)
    }
  }

  async function buyDomain(result: SearchResult) {
    setBuying(result.domainName)
    try {
      const res = await fetch('/api/builder/domains/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domainName: result.domainName,
          purchasePrice: result.purchasePrice,
          projectId,
        }),
      })
      const data = await res.json()
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
      } else {
        alert(data.error ?? 'Failed to start checkout')
      }
    } finally {
      setBuying(null)
    }
  }

  async function connectOwned(domainId: string) {
    if (!project?.netlify_site_id) {
      alert('Deploy your site first before connecting a domain')
      return
    }
    setConnecting(domainId)
    try {
      const res = await fetch(`/api/builder/domains/connect/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchasedDomainId: domainId }),
      })
      const data = await res.json()
      if (data.success) {
        await loadProject()
        await loadOwnedDomains()
      } else {
        alert(`Error: ${data.error}`)
      }
    } finally {
      setConnecting(null)
    }
  }

  async function connectExternal(e: React.FormEvent) {
    e.preventDefault()
    const domain = externalDomain.trim().toLowerCase().replace(/^https?:\/\//, '')
    if (!domain) return
    if (!project?.netlify_site_id) {
      alert('Deploy your site first before connecting a domain')
      return
    }
    setConnectingExternal(true)
    setDnsRecords(null)
    setExternalError('')
    try {
      const res = await fetch(`/api/builder/domains/external/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domainName: domain }),
      })
      const data = await res.json()
      if (data.success) {
        setDnsRecords(data.dnsRecords)
        await loadProject()
      } else {
        setExternalError(data.error ?? 'Failed to connect domain')
      }
    } finally {
      setConnectingExternal(false)
    }
  }

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const availableDomains = ownedDomains.filter(
    d => d.namecom_status === 'active' && (!d.builder_project_id || d.builder_project_id === projectId)
  )

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <header className="border-b border-[#30363d] px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button
            onClick={() => router.push(`/builder/${projectId}/editor`)}
            className="p-1.5 text-gray-400 hover:text-white rounded transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <Globe size={18} className="text-[#22c55e]" />
          <span className="text-white font-semibold">Domains — {project?.name}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* Current domain status */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5">
          <h2 className="text-white font-semibold mb-3">Current Domain</h2>
          {project?.custom_domain ? (
            <div className="flex items-center gap-3">
              <CheckCircle2 size={16} className="text-[#22c55e]" />
              <span className="text-[#22c55e] font-medium">{project.custom_domain}</span>
              <a
                href={`https://${project.custom_domain}`}
                target="_blank"
                rel="noreferrer"
                className="ml-auto flex items-center gap-1 text-xs text-blue-400 hover:underline"
              >
                <ExternalLink size={12} /> Visit site
              </a>
            </div>
          ) : project?.netlify_deploy_url ? (
            <div className="space-y-2">
              <p className="text-gray-400 text-sm">No custom domain yet. Your site is live at:</p>
              <a
                href={project.netlify_deploy_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-sm text-blue-400 hover:underline"
              >
                <ExternalLink size={14} /> {project.netlify_deploy_url}
              </a>
            </div>
          ) : (
            <p className="text-gray-400 text-sm">Deploy your site first to connect a domain.</p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-[#161b22] border border-[#30363d] rounded-xl p-1">
          {([
            { key: 'buy', label: 'Buy Domain' },
            { key: 'owned', label: `My Domains${availableDomains.length ? ` (${availableDomains.length})` : ''}` },
            { key: 'external', label: 'Connect External' },
          ] as { key: Tab; label: string }[]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex-1 py-2 text-sm font-medium rounded-lg transition-colors',
                tab === t.key
                  ? 'bg-[#22c55e] text-black'
                  : 'text-gray-400 hover:text-white'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Buy Domain Tab */}
        {tab === 'buy' && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 space-y-4">
            <div>
              <h2 className="text-white font-semibold mb-1">Search & Buy a Domain</h2>
              <p className="text-gray-400 text-sm">Find an available domain and purchase it. It will be automatically connected to your site.</p>
            </div>

            <form onSubmit={searchDomains} className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="mybusiness, plumber-nyc, etc."
                className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-white text-sm focus:border-[#22c55e] focus:outline-none placeholder-gray-600"
              />
              <button
                type="submit"
                disabled={searching || !searchQuery.trim()}
                className="flex items-center gap-2 bg-[#22c55e] hover:bg-[#16a34a] text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Search
              </button>
            </form>

            {results.length > 0 && (
              <div className="space-y-2">
                {results.map(r => (
                  <div key={r.domainName} className="flex items-center justify-between p-3 bg-[#0d1117] rounded-lg border border-[#30363d]">
                    <div>
                      <p className="text-white text-sm font-medium">{r.domainName}</p>
                      {r.purchasable ? (
                        <p className="text-gray-500 text-xs">${r.purchasePrice}/yr · renews ${r.renewalPrice}/yr</p>
                      ) : (
                        <p className="text-red-400 text-xs">Not available</p>
                      )}
                    </div>
                    {r.purchasable && (
                      <button
                        onClick={() => buyDomain(r)}
                        disabled={!!buying}
                        className="flex items-center gap-2 bg-[#22c55e]/10 hover:bg-[#22c55e]/20 text-[#22c55e] border border-[#22c55e]/30 px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
                      >
                        {buying === r.domainName ? <Loader2 size={14} className="animate-spin" /> : <ShoppingCart size={14} />}
                        Buy ${r.purchasePrice}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {searching && (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <Loader2 size={14} className="animate-spin" /> Checking availability...
              </div>
            )}
          </div>
        )}

        {/* My Domains Tab */}
        {tab === 'owned' && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-white font-semibold">My Purchased Domains</h2>
                <p className="text-gray-400 text-sm mt-0.5">Domains you've bought through Wilcart</p>
              </div>
              <button onClick={loadOwnedDomains} className="p-1.5 text-gray-500 hover:text-white rounded transition-colors">
                <RefreshCw size={14} />
              </button>
            </div>

            {availableDomains.length === 0 ? (
              <div className="text-center py-8">
                <Globe size={28} className="mx-auto text-gray-600 mb-2" />
                <p className="text-gray-400 text-sm">No purchased domains yet.</p>
                <button
                  onClick={() => setTab('buy')}
                  className="mt-3 text-[#22c55e] text-sm hover:underline"
                >
                  Buy a domain →
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {availableDomains.map(d => (
                  <div key={d.id} className="flex items-center justify-between p-3 bg-[#0d1117] rounded-lg border border-[#30363d]">
                    <div>
                      <p className="text-white text-sm font-medium">{d.domain}</p>
                      <p className="text-gray-500 text-xs">Expires {d.expire_date}</p>
                    </div>
                    {d.connected && d.builder_project_id === projectId ? (
                      <span className="flex items-center gap-1 text-xs text-[#22c55e]">
                        <CheckCircle2 size={12} /> Connected
                      </span>
                    ) : (
                      <button
                        onClick={() => connectOwned(d.id)}
                        disabled={!!connecting}
                        className="flex items-center gap-2 bg-[#22c55e]/10 hover:bg-[#22c55e]/20 text-[#22c55e] border border-[#22c55e]/30 px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
                      >
                        {connecting === d.id ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                        Connect
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* External Domain Tab */}
        {tab === 'external' && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 space-y-4">
            <div>
              <h2 className="text-white font-semibold mb-1">Connect Your Own Domain</h2>
              <p className="text-gray-400 text-sm">
                Have a domain registered on GoDaddy, Namecheap, or elsewhere? Enter it below and we'll give you DNS records to point to your site.
              </p>
            </div>

            <form onSubmit={connectExternal} className="flex gap-2">
              <input
                type="text"
                value={externalDomain}
                onChange={e => setExternalDomain(e.target.value)}
                placeholder="yoursite.com"
                className="flex-1 bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-white text-sm focus:border-[#22c55e] focus:outline-none placeholder-gray-600"
              />
              <button
                type="submit"
                disabled={connectingExternal || !externalDomain.trim() || !project?.netlify_site_id}
                className="flex items-center gap-2 bg-[#22c55e] hover:bg-[#16a34a] text-black font-semibold px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {connectingExternal ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                Connect
              </button>
            </form>

            {!project?.netlify_site_id && (
              <div className="flex items-start gap-2 text-amber-400 text-sm bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                Deploy your site first, then come back to connect a domain.
              </div>
            )}

            {externalError && (
              <div className="flex items-start gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                {externalError}
              </div>
            )}

            {dnsRecords && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[#22c55e] text-sm">
                  <CheckCircle2 size={14} /> Domain linked! Add these DNS records at your registrar:
                </div>
                <div className="space-y-2">
                  {dnsRecords.map((rec, i) => (
                    <div key={i} className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-mono text-gray-500 uppercase tracking-wider">{rec.type} Record</span>
                        <button
                          onClick={() => copyToClipboard(rec.value, `${i}-val`)}
                          className="flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors"
                        >
                          {copied === `${i}-val` ? <Check size={12} className="text-[#22c55e]" /> : <Copy size={12} />}
                          {copied === `${i}-val` ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <p className="text-gray-500 mb-1">Name / Host</p>
                          <p className="text-white font-mono">{rec.name}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 mb-1">Type</p>
                          <p className="text-white font-mono">{rec.type}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 mb-1">Value / Points to</p>
                          <p className="text-white font-mono break-all">{rec.value}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-gray-500 text-xs">
                  DNS changes can take 5 minutes to 48 hours to propagate. Your site will be live at your domain once propagation is complete.
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
