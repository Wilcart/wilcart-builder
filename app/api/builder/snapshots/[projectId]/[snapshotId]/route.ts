import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'

// Delete a snapshot and all newer ones (when reverting to that point)
export async function DELETE(req: Request, { params }: { params: Promise<{ projectId: string; snapshotId: string }> }) {
  const { projectId, snapshotId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()

  // Get the target snapshot's timestamp
  const { data: target } = await admin
    .from('builder_snapshots')
    .select('created_at')
    .eq('id', snapshotId)
    .single()

  if (!target) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })

  // Delete this snapshot and all newer ones (they are now superseded by the revert)
  await admin
    .from('builder_snapshots')
    .delete()
    .eq('project_id', projectId)
    .gte('created_at', target.created_at)

  return NextResponse.json({ ok: true })
}
