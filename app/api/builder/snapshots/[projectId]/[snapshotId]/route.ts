import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'

// POST = atomically apply this snapshot to the project's files.
// Append-only: does NOT delete any snapshots. Creates a new snapshot of the
// PRE-revert state so user can undo the revert if they change their mind.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; snapshotId: string }> }
) {
  const { projectId, snapshotId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()

  // 1) Load the target snapshot
  const { data: snap, error: snapErr } = await admin
    .from('builder_snapshots')
    .select('id, label, file_contents, project_id, org_id')
    .eq('id', snapshotId)
    .single()

  if (snapErr || !snap) {
    return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
  }
  if (snap.project_id !== projectId) {
    return NextResponse.json({ error: 'Snapshot does not belong to this project' }, { status: 403 })
  }

  const stored = snap.file_contents as Array<{ id: string; path: string; content: string }>
  if (!Array.isArray(stored) || stored.length === 0) {
    return NextResponse.json({ error: 'Snapshot has no file contents' }, { status: 400 })
  }

  // 2) Load current files of the project
  const { data: currentFiles } = await admin
    .from('builder_files')
    .select('id, path, content')
    .eq('project_id', projectId)

  if (!currentFiles) {
    return NextResponse.json({ error: 'Could not load project files' }, { status: 500 })
  }

  // 3) Save a snapshot of the CURRENT state before reverting (so user can undo)
  const preRevertContents = currentFiles.map(f => ({
    id: f.id, path: f.path, content: f.content
  }))
  await admin.from('builder_snapshots').insert({
    project_id: projectId,
    org_id: snap.org_id,
    label: `Before revert to: ${snap.label || 'snapshot'}`,
    file_contents: preRevertContents,
  })

  // 4) Apply the snapshot's content to matching files (match by id, fallback to path)
  const updatePromises: Promise<unknown>[] = []
  let applied = 0
  let skipped = 0

  for (const storedFile of stored) {
    const target = currentFiles.find(
      f => f.id === storedFile.id || f.path === storedFile.path
    )
    if (!target) {
      skipped++
      continue
    }
    updatePromises.push(
      admin
        .from('builder_files')
        .update({
          content: storedFile.content,
          size_bytes: storedFile.content.length,
          updated_at: new Date().toISOString(),
        })
        .eq('id', target.id)
    )
    applied++
  }

  await Promise.all(updatePromises)

  return NextResponse.json({ ok: true, applied, skipped })
}

// DELETE = delete a single snapshot from history. Does NOT affect files.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; snapshotId: string }> }
) {
  const { projectId, snapshotId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { error } = await admin
    .from('builder_snapshots')
    .delete()
    .eq('id', snapshotId)
    .eq('project_id', projectId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
