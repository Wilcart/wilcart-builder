import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createServiceClient } from '@/lib/supabase/server'
import { registerDomain } from '@/lib/builder/namecom'
import { createSite, deployZip, mapNetlifyState } from '@/lib/builder/netlify'
import { bundleFilesToZip } from '@/lib/builder/bundler'
import { slugify } from '@/lib/utils'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new Stripe(key, { apiVersion: '2026-03-25.dahlia' })
}

export async function POST(req: Request) {
  const stripe = getStripe()
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true })
  }

  const session = event.data.object as Stripe.Checkout.Session
  const meta = session.metadata!

  if (meta.type !== 'domain_purchase') {
    return NextResponse.json({ received: true })
  }

  const supabase = createServiceClient()
  const domainName = meta.domain_name
  const orgId = meta.org_id
  const projectId = meta.project_id || null

  try {
    // 1. Register domain on name.com
    const { orderId } = await registerDomain(domainName, 1)

    // 2. Update purchased_domains record
    await supabase
      .from('purchased_domains')
      .update({
        namecom_order_id: orderId,
        namecom_status: 'active',
        expire_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      })
      .eq('stripe_session_id', session.id)

    // 3. If linked to a project — auto deploy + connect domain
    if (projectId) {
      const { data: project } = await supabase
        .from('builder_projects')
        .select('*')
        .eq('id', projectId)
        .single()

      if (project) {
        const { data: files } = await supabase
          .from('builder_files')
          .select('*')
          .eq('project_id', projectId)

        if (files?.length) {
          // Create Netlify site if not exists
          let siteId = project.netlify_site_id
          if (!siteId) {
            const orgSlug = slugify(orgId.slice(0, 8))
            const projectSlug = slugify(project.name)
            const site = await createSite(`wilcart-${orgSlug}-${projectSlug}-${Date.now().toString(36)}`)
            siteId = site.id

            await supabase.from('builder_projects').update({
              netlify_site_id: siteId,
              netlify_site_name: site.name,
            }).eq('id', projectId)
          }

          // Deploy zip
          const zipBuffer = await bundleFilesToZip(files)
          const deploy = await deployZip(siteId, zipBuffer)

          // Connect custom domain on Netlify
          await fetch(`https://api.netlify.com/api/v1/sites/${siteId}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${process.env.NETLIFY_API_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ custom_domain: domainName }),
          })

          // Update project
          await supabase.from('builder_projects').update({
            netlify_deploy_id: deploy.id,
            netlify_deploy_url: deploy.deploy_url,
            netlify_deploy_status: mapNetlifyState(deploy.state),
            status: 'deployed',
            custom_domain: domainName,
            domain_connected: true,
            last_deployed_at: new Date().toISOString(),
          }).eq('id', projectId)
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Domain webhook error:', err)
    // Still mark as paid even if name.com fails — handle manually
    await supabase
      .from('purchased_domains')
      .update({ namecom_status: 'payment_received_pending_registration' })
      .eq('stripe_session_id', session.id)
    return NextResponse.json({ received: true })
  }
}
