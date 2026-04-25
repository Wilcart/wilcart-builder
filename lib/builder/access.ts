import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

function adminClient() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function checkBuilderAccess() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return {
      allowed: false as const,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) {
    return {
      allowed: false as const,
      response: NextResponse.json({ error: 'Profile not found' }, { status: 404 }),
    }
  }

  const admin = adminClient()
  const { data: org } = await admin
    .from('organizations')
    .select('builder_enabled')
    .eq('id', profile.org_id)
    .single()

  if (!org?.builder_enabled) {
    return {
      allowed: false as const,
      response: NextResponse.json({ error: 'Builder access not enabled for your plan' }, { status: 403 }),
    }
  }

  return { allowed: true as const, user, orgId: profile.org_id, supabase }
}
