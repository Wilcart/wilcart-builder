import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMimeType } from '@/lib/builder/preview'

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('builder_files')
    .select('*')
    .eq('project_id', projectId)
    .order('path')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('org_id').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { path, content = '' } = await req.json()
  const name = path.split('/').pop() ?? path
  const mime_type = getMimeType(path)

  const { data, error } = await supabase
    .from('builder_files')
    .insert({
      project_id: projectId,
      org_id: profile.org_id,
      path, name, mime_type,
      content,
      size_bytes: content.length,
      is_entry: path === 'index.html',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
