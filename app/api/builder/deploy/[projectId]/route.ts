import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { bundleFilesToZip } from '@/lib/builder/bundler'
import { createSite, deployZip, mapNetlifyState } from '@/lib/builder/netlify'
import { slugify } from '@/lib/utils'

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const supabase = await createClient()
  const admin = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await admin.from('profiles').select('org_id').eq('id', user.id).single()
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  // Load project
  const { data: project } = await admin
    .from('builder_projects')
    .select('*')
    .eq('id', projectId)
    .single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Load files
  const { data: files } = await admin
    .from('builder_files')
    .select('*')
    .eq('project_id', projectId)
  if (!files?.length) return NextResponse.json({ error: 'No files to deploy' }, { status: 400 })

  // Verify Netlify token is configured
  if (!process.env.NETLIFY_API_TOKEN) {
    return NextResponse.json({ error: 'Netlify API token not configured — add NETLIFY_API_TOKEN to Vercel env vars' }, { status: 500 })
  }

  // Mark project as deploying
  await admin.from('builder_projects').update({ status: 'deploying', netlify_deploy_status: 'in_progress' }).eq('id', projectId)

  // Create deployment record
  const { data: deployment } = await admin
    .from('builder_deployments')
    .insert({ project_id: projectId, org_id: profile.org_id, triggered_by: user.id, status: 'in_progress' })
    .select()
    .single()

  try {
    // Ensure Netlify site exists
    let siteId = project.netlify_site_id
    let siteName = project.netlify_site_name

    if (!siteId) {
      const orgSlug = slugify(profile.org_id.slice(0, 8))
      const projectSlug = slugify(project.name)
      const uniqueName = `wilcart-${orgSlug}-${projectSlug}-${Date.now().toString(36)}`
      const teamSlug = process.env.NETLIFY_TEAM_SLUG
      const site = await createSite(uniqueName, teamSlug)
      siteId = site.id
      siteName = site.name
    }

    // Bundle and deploy
    const zipBuffer = await bundleFilesToZip(files)
    const deploy = await deployZip(siteId, zipBuffer)

    // Update project and deployment
    await admin.from('builder_projects').update({
      netlify_site_id: siteId,
      netlify_site_name: siteName,
      netlify_deploy_id: deploy.id,
      netlify_deploy_url: deploy.deploy_url,
      netlify_deploy_status: mapNetlifyState(deploy.state),
      status: deploy.state === 'ready' ? 'deployed' : 'deploying',
      last_deployed_at: deploy.state === 'ready' ? new Date().toISOString() : null,
    }).eq('id', projectId)

    await admin.from('builder_deployments').update({
      netlify_deploy_id: deploy.id,
      netlify_deploy_url: deploy.deploy_url,
      status: mapNetlifyState(deploy.state),
      completed_at: deploy.state === 'ready' ? new Date().toISOString() : null,
    }).eq('id', deployment?.id)

    return NextResponse.json({
      deploymentId: deployment?.id,
      netlifyDeployId: deploy.id,
      deployUrl: deploy.deploy_url,
      state: deploy.state,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Deploy failed'
    console.error('[Deploy error]', msg)
    await admin.from('builder_projects').update({ status: 'error', netlify_deploy_status: 'error' }).eq('id', projectId)
    await admin.from('builder_deployments').update({
      status: 'error', error_message: msg, completed_at: new Date().toISOString()
    }).eq('id', deployment?.id)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
