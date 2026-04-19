import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMimeType } from '@/lib/builder/preview'

// Migrate old websites table entries → builder_projects + builder_files
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

  const body = await req.json()
  const { websiteId } = body

  // Load the old website
  const { data: website, error: websiteError } = await supabase
    .from('websites')
    .select('*')
    .eq('id', websiteId)
    .single()

  if (websiteError || !website) {
    return NextResponse.json({ error: 'Website not found' }, { status: 404 })
  }

  // Check already migrated — search in settings jsonb
  const { data: allProjects } = await supabase
    .from('builder_projects')
    .select('id, settings')
    .is('deleted_at', null)

  const existing = (allProjects ?? []).find(
    (p: any) => p.settings?.migrated_from_website_id === websiteId
  )
  if (existing) {
    return NextResponse.json({ projectId: existing.id, alreadyMigrated: true })
  }

  // Create builder_project
  const { data: project, error: projectError } = await supabase
    .from('builder_projects')
    .insert({
      org_id: profile.org_id,
      created_by: user.id,
      name: website.name || 'Migrated Site',
      description: `Migrated from ${website.business_type || 'website builder'}`,
      framework: 'html',
      status: 'draft',
      meta_title: website.meta_title,
      meta_description: website.meta_description,
      custom_domain: website.custom_domain,
      settings: {
        migrated_from_website_id: websiteId,
        migrated_at: new Date().toISOString(),
        original_source: 'base44',
      },
    })
    .select()
    .single()

  if (projectError || !project) {
    return NextResponse.json({ error: projectError?.message }, { status: 500 })
  }

  // Create index.html from html_content
  const htmlContent = website.html_content || `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${website.name || 'My Website'}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-[#0d1117] text-white">
  <div class="flex items-center justify-center min-h-screen">
    <h1 class="text-4xl font-bold text-[#22c55e]">${website.name || 'My Website'}</h1>
  </div>
</body>
</html>`

  const { data: file } = await supabase
    .from('builder_files')
    .insert({
      project_id: project.id,
      org_id: profile.org_id,
      path: 'index.html',
      name: 'index.html',
      mime_type: 'text/html',
      content: htmlContent,
      size_bytes: htmlContent.length,
      is_entry: true,
    })
    .select()
    .single()

  // Set active file
  if (file) {
    await supabase
      .from('builder_projects')
      .update({ active_file_id: file.id })
      .eq('id', project.id)
  }

  return NextResponse.json({ projectId: project.id, migrated: true })
}

// GET — list all old websites that can be migrated
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('websites')
    .select('id, name, business_type, status, custom_domain, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  return NextResponse.json(data ?? [])
}
