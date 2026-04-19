import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDeployStatus, mapNetlifyState } from '@/lib/builder/netlify'

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: project } = await supabase
    .from('builder_projects')
    .select('netlify_deploy_id, netlify_deploy_url, netlify_deploy_status')
    .eq('id', projectId)
    .single()

  if (!project?.netlify_deploy_id) {
    return NextResponse.json({ status: 'pending', deployUrl: null })
  }

  try {
    const netlifyStatus = await getDeployStatus(project.netlify_deploy_id)
    const status = mapNetlifyState(netlifyStatus.state)

    if (status === 'ready' || status === 'error') {
      await supabase.from('builder_projects').update({
        netlify_deploy_status: status,
        netlify_deploy_url: netlifyStatus.deploy_url ?? project.netlify_deploy_url,
        status: status === 'ready' ? 'deployed' : 'error',
        last_deployed_at: status === 'ready' ? new Date().toISOString() : undefined,
      }).eq('id', projectId)
    }

    return NextResponse.json({
      status,
      deployUrl: netlifyStatus.deploy_url ?? project.netlify_deploy_url,
      error: netlifyStatus.error_message,
    })
  } catch {
    return NextResponse.json({
      status: project.netlify_deploy_status ?? 'pending',
      deployUrl: project.netlify_deploy_url,
    })
  }
}
