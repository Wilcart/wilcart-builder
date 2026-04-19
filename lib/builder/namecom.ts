const BASE = () => process.env.NAMECOM_API_BASE ?? 'https://api.name.com/v4'
const auth = () =>
  'Basic ' + Buffer.from(`${process.env.NAMECOM_API_USERNAME}:${process.env.NAMECOM_API_TOKEN}`).toString('base64')

async function nameFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE()}${path}`, {
    ...options,
    headers: {
      Authorization: auth(),
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`name.com API error ${res.status}: ${text}`)
  }
  return res.json()
}

export async function checkAvailability(domains: string[]): Promise<Array<{
  domainName: string
  purchasable: boolean
  premium: boolean
  purchasePrice: number
  renewalPrice: number
  currency: string
}>> {
  const data = await nameFetch('/domains:checkAvailability', {
    method: 'POST',
    body: JSON.stringify({ domainNames: domains }),
  })
  return data.results ?? []
}

export async function searchDomains(keyword: string): Promise<Array<{
  domainName: string
  purchasable: boolean
  purchasePrice: number
  renewalPrice: number
  currency: string
}>> {
  // Generate common TLD variations
  const tlds = ['.com', '.net', '.org', '.io', '.co', '.app', '.site', '.online']
  const base = keyword.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/\s+/g, '')
  const domainsToCheck = tlds.map(tld => `${base}${tld}`)
  return checkAvailability(domainsToCheck)
}

export async function registerDomain(
  domainName: string,
  years: number = 1
): Promise<{ orderId: string; domainName: string }> {
  const data = await nameFetch('/domains', {
    method: 'POST',
    body: JSON.stringify({ domainName, purchaseYears: years }),
  })
  return { orderId: data.order?.orderId ?? data.domainName, domainName: data.domainName }
}

export async function setNameservers(domainName: string, nameservers: string[]): Promise<void> {
  await nameFetch(`/domains/${domainName}:setNameservers`, {
    method: 'POST',
    body: JSON.stringify({ nameservers }),
  })
}
