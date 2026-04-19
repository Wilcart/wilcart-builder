import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { getMimeType } from '@/lib/builder/preview'
import { checkBuilderAccess } from '@/lib/builder/access'

function adminClient() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const DEFAULT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Website</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-[#0d1117] text-white min-h-screen">
  <div class="flex items-center justify-center min-h-screen">
    <div class="text-center">
      <h1 class="text-4xl font-bold text-[#22c55e] mb-4">Welcome!</h1>
      <p class="text-gray-400 text-lg">Start chatting with AI to build your website.</p>
    </div>
  </div>
</body>
</html>`

export async function GET() {
  const access = await checkBuilderAccess()
  if (!access.allowed) return access.response
  const { orgId } = access
  const admin = adminClient()

  const { data, error } = await admin
    .from('builder_projects')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const access = await checkBuilderAccess()
  if (!access.allowed) return access.response
  const { user, orgId: org_id } = access
  const admin = adminClient()

  const body = await req.json()
  const { name, description } = body

  // Create project
  const { data: project, error: projectError } = await admin
    .from('builder_projects')
    .insert({
      name: name || 'Untitled Project',
      description: description || null,
      org_id,
      created_by: user.id,
    })
    .select()
    .single()

  if (projectError) return NextResponse.json({ error: projectError.message }, { status: 500 })

  // Create default index.html
  const { data: file, error: fileError } = await admin
    .from('builder_files')
    .insert({
      project_id: project.id,
      org_id,
      path: 'index.html',
      name: 'index.html',
      mime_type: getMimeType('index.html'),
      content: DEFAULT_HTML,
      size_bytes: DEFAULT_HTML.length,
      is_entry: true,
    })
    .select()
    .single()

  if (fileError) return NextResponse.json({ error: fileError.message }, { status: 500 })

  // Set active file
  await admin
    .from('builder_projects')
    .update({ active_file_id: file.id })
    .eq('id', project.id)

  return NextResponse.json({ ...project, active_file_id: file.id }, { status: 201 })
}
