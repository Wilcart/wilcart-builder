const NETLIFY_API = 'https://api.netlify.com/api/v1'
const TOKEN = () => process.env.NETLIFY_API_TOKEN!

async function netlifyFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${NETLIFY_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN()}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Netlify API error ${res.status}: ${text}`)
  }
  return res.json()
}

export async function createSite(name: string): Promise<{ id: string; name: string; url: string }> {
  const data = await netlifyFetch('/sites', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  return { id: data.id, name: data.name, url: data.url }
}

export async function deployZip(
  siteId: string,
  zipBuffer: Buffer
): Promise<{ id: string; deploy_url: string; state: string }> {
  const res = await fetch(`${NETLIFY_API}/sites/${siteId}/deploys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN()}`,
      'Content-Type': 'application/zip',
    },
    body: new Uint8Array(zipBuffer),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Netlify deploy error ${res.status}: ${text}`)
  }
  const data = await res.json()
  return { id: data.id, deploy_url: data.deploy_url ?? data.ssl_url, state: data.state }
}

export async function getDeployStatus(deployId: string): Promise<{
  state: string
  deploy_url: string | null
  error_message: string | null
}> {
  const data = await netlifyFetch(`/deploys/${deployId}`)
  return {
    state: data.state,
    deploy_url: data.deploy_url ?? data.ssl_url ?? null,
    error_message: data.error_message ?? null,
  }
}

export async function configureCustomDomain(
  siteId: string,
  domain: string
): Promise<{ nameservers: string[] }> {
  // Add domain alias to site
  await netlifyFetch(`/sites/${siteId}`, {
    method: 'PATCH',
    body: JSON.stringify({ custom_domain: domain }),
  })
  // Provision SSL
  try {
    await netlifyFetch(`/sites/${siteId}/ssl`, { method: 'POST' })
  } catch {}
  // Get DNS zone info
  try {
    const zones = await netlifyFetch('/dns_zones')
    const zone = zones.find((z: { name: string }) => z.name === domain || domain.endsWith(`.${z.name}`))
    if (zone) return { nameservers: zone.dns_servers ?? [] }
  } catch {}
  // Fallback Netlify nameservers
  return {
    nameservers: [
      'dns1.p01.nsone.net',
      'dns2.p01.nsone.net',
      'dns3.p01.nsone.net',
      'dns4.p01.nsone.net',
    ],
  }
}

export function mapNetlifyState(state: string): 'pending' | 'in_progress' | 'ready' | 'error' | 'cancelled' {
  switch (state) {
    case 'ready':
    case 'current': return 'ready'
    case 'error':
    case 'failed': return 'error'
    case 'cancelled': return 'cancelled'
    case 'building':
    case 'uploading':
    case 'uploaded':
    case 'processing': return 'in_progress'
    default: return 'pending'
  }
}
