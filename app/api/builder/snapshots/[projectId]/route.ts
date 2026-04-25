import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data } = await admin
    .from('builder_snapshots')
    .select('id, label, file_contents, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(10)

  return NextResponse.json(data ?? [])
}

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: profile } = await admin.from('profiles').select('org_id').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { label, fileContents } = await req.json()

  const { data, error } = await admin
    .from('builder_snapshots')
    .insert({ project_id: projectId, org_id: profile.org_id, label: label ?? '', file_contents: fileContents })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Keep only last 10 snapshots per project
  const { data: old } = await admin
    .from('builder_snapshots')
    .select('id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .range(10, 100)

  if (old && old.length > 0) {
    await admin.from('builder_snapshots').delete().in('id', old.map(r => r.id))
  }

  return NextResponse.json({ id: data?.id })
}
