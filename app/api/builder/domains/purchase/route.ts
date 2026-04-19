import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new Stripe(key, { apiVersion: '2026-03-25.dahlia' })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { domainName, purchasePrice, projectId } = await req.json()
  if (!domainName || !purchasePrice) {
    return NextResponse.json({ error: 'domainName and purchasePrice required' }, { status: 400 })
  }

  const stripe = getStripe()
  const origin = req.headers.get('origin') ?? 'https://app.wilcart.com'

  // Create Stripe Checkout session
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `Domain: ${domainName}`,
          description: `1-year registration for ${domainName}`,
        },
        unit_amount: Math.round(purchasePrice * 100),
      },
      quantity: 1,
    }],
    metadata: {
      domain_name: domainName,
      org_id: profile.org_id,
      user_id: user.id,
      project_id: projectId ?? '',
      type: 'domain_purchase',
    },
    success_url: `${origin}/builder${projectId ? `/${projectId}/domains` : ''}?domain_success=1&domain=${domainName}`,
    cancel_url: `${origin}/builder${projectId ? `/${projectId}/domains` : ''}?domain_cancel=1`,
  })

  // Create pending domain order in DB
  await supabase.from('purchased_domains').insert({
    org_id: profile.org_id,
    user_id: user.id,
    domain: domainName,
    purchase_price: purchasePrice,
    renewal_price: purchasePrice,
    purchase_type: 'namecom',
    namecom_status: 'pending_payment',
    stripe_session_id: session.id,
    connected: false,
    builder_project_id: projectId ?? null,
  })

  return NextResponse.json({ checkoutUrl: session.url })
}
