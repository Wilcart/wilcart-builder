import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Netlify load balancer IP for apex domains and CNAME for subdomains
const NETLIFY_IP = '75.2.60.5'
const NETLIFY_CNAME = 'apex-loadbalancer.netlify.com'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { domainName } = await req.json()
  if (!domainName) return NextResponse.json({ error: 'domainName required' }, { status: 400 })

  const cleanDomain = domainName.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')

  // Load project
  const { data: project } = await supabase
    .from('builder_projects')
    .select('netlify_site_id')
    .eq('id', projectId)
    .single()

  if (!project?.netlify_site_id) {
    return NextResponse.json({ error: 'Deploy your site first before connecting a domain' }, { status: 400 })
  }

  try {
    // Set custom domain on Netlify site
    const netlifyRes = await fetch(`https://api.netlify.com/api/v1/sites/${project.netlify_site_id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.NETLIFY_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ custom_domain: cleanDomain }),
    })

    if (!netlifyRes.ok) {
      const text = await netlifyRes.text()
      throw new Error(`Netlify error: ${text}`)
    }

    // Update project record
    await supabase.from('builder_projects').update({
      custom_domain: cleanDomain,
      domain_connected: true,
    }).eq('id', projectId)

    // Build DNS records for the user
    // For apex domain (no subdomain): A record pointing to Netlify IP
    // For www or subdomain: CNAME pointing to Netlify
    const isApex = !cleanDomain.startsWith('www.') && cleanDomain.split('.').length === 2
    const dnsRecords = isApex
      ? [
          { type: 'A', name: '@', value: NETLIFY_IP },
          { type: 'CNAME', name: 'www', value: NETLIFY_CNAME },
        ]
      : [
          { type: 'CNAME', name: cleanDomain.split('.')[0], value: NETLIFY_CNAME },
        ]

    return NextResponse.json({ success: true, dnsRecords, domain: cleanDomain })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to connect domain'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
