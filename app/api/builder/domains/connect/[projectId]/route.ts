import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { configureCustomDomain } from '@/lib/builder/netlify'
import { setNameservers } from '@/lib/builder/namecom'

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { purchasedDomainId } = await req.json()

  // Load project
  const { data: project } = await supabase
    .from('builder_projects')
    .select('netlify_site_id')
    .eq('id', projectId)
    .single()

  if (!project?.netlify_site_id) {
    return NextResponse.json({ error: 'Deploy your site first before connecting a domain' }, { status: 400 })
  }

  // Load domain
  const { data: domain } = await supabase
    .from('purchased_domains')
    .select('*')
    .eq('id', purchasedDomainId)
    .single()

  if (!domain) return NextResponse.json({ error: 'Domain not found' }, { status: 404 })

  try {
    const domainName: string = domain.domain

    // Configure Netlify
    const { nameservers } = await configureCustomDomain(project.netlify_site_id, domainName)

    // Update name.com nameservers
    await setNameservers(domainName, nameservers)

    // Update records
    await supabase.from('purchased_domains').update({
      builder_project_id: projectId,
      connected: true,
    }).eq('id', purchasedDomainId)

    await supabase.from('builder_projects').update({
      custom_domain: domainName,
      domain_connected: true,
    }).eq('id', projectId)

    return NextResponse.json({
      success: true,
      domain: domainName,
      nameservers,
      message: 'Domain connected. DNS propagation may take 5–60 minutes.',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to connect domain'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
