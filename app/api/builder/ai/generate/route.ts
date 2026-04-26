import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { streamGenerate, parseFileBlocks, parsePatchBlocks, applyPatches } from '@/lib/builder/claude'
import { checkBuilderAccess } from '@/lib/builder/access'

// Service role client bypasses RLS for file operations
function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: Request) {
  const access = await checkBuilderAccess()
  if (!access.allowed) return access.response
  const { user, orgId, supabase } = access

  const { projectId, prompt, conversationHistory = [], image } = await req.json()

  // Use admin client for file reads/writes to bypass RLS
  const admin = createAdminClient()

  // Load project files
  const { data: files } = await admin
    .from('builder_files')
    .select('*')
    .eq('project_id', projectId)
    .order('path')

  // Save user message
  await supabase.from('builder_messages').insert({
    project_id: projectId,
    org_id: orgId,
    role: 'user',
    content: prompt,
  })

  const encoder = new TextEncoder()
  let fullText = ''

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamGenerate(prompt, files ?? [], conversationHistory, image)) {
          fullText += chunk
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'delta', text: chunk })}\n\n`))
        }

        // ── Determine what Claude produced: patches and/or full file blocks ──
        const patchBlocks = parsePatchBlocks(fullText)
        let fileBlocks = parseFileBlocks(fullText)
        const updatedFileIds: string[] = []

        // Helper: save a new or existing file block to DB
        async function saveFileBlock(block: { path: string; content: string }) {
          const existing = (files ?? []).find(f => f.path === block.path)
          if (existing) {
            await admin
              .from('builder_files')
              .update({ content: block.content, size_bytes: block.content.length, updated_at: new Date().toISOString() })
              .eq('id', existing.id)
            updatedFileIds.push(existing.id)
          } else {
            const { data: newFile } = await admin
              .from('builder_files')
              .insert({
                project_id: projectId,
                org_id: orgId,
                path: block.path,
                name: block.path.split('/').pop() ?? block.path,
                mime_type: block.path.endsWith('.css') ? 'text/css'
                  : block.path.endsWith('.js') ? 'text/javascript'
                  : 'text/html',
                content: block.content,
                size_bytes: block.content.length,
                is_entry: block.path === 'index.html',
              })
              .select()
              .single()
            if (newFile) updatedFileIds.push(newFile.id)
          }
        }

        if (patchBlocks.length > 0) {
          // PATCH MODE (possibly mixed with new file blocks)
          // Apply patches to the entry file (index.html)
          const entryFile = (files ?? []).find(f => f.path === 'index.html' || f.is_entry)
          if (entryFile) {
            const { result, applied, failed } = applyPatches(entryFile.content, patchBlocks)
            if (applied > 0) {
              await admin
                .from('builder_files')
                .update({ content: result, size_bytes: result.length, updated_at: new Date().toISOString() })
                .eq('id', entryFile.id)
              updatedFileIds.push(entryFile.id)
              // Add patched index.html to fileBlocks so frontend gets updated content
              const alreadyIncluded = fileBlocks.some(b => b.path === entryFile.path)
              if (!alreadyIncluded) {
                fileBlocks = [{ path: entryFile.path, content: result }, ...fileBlocks]
              }
              if (failed.length > 0) {
                console.warn('[Patch] Failed to apply', failed.length, 'patch(es):', failed)
                const warning = `\n\n⚠️ ${failed.length} change(s) couldn't be applied automatically. Please ask me to **rewrite that section completely** if you don't see the update.`
                fullText += warning
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'delta', text: warning })}\n\n`))
              }
            } else {
              // All patches failed — nothing changed, warn the user
              console.warn('[Patch] All patches failed:', failed)
              const warning = `\n\n⚠️ I couldn't apply the changes — the code structure didn't match. Please tell me to **completely rewrite that section** and I'll redo it from scratch.`
              fullText += warning
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'delta', text: warning })}\n\n`))
            }
          }

          // Save any new page file blocks (e.g. privacy-policy.html) alongside the patch
          for (const block of fileBlocks.filter(b => b.path !== 'index.html' && !(files ?? []).find(f => f.path === b.path))) {
            await saveFileBlock(block)
          }
        }

        if (patchBlocks.length === 0) {
          // FULL FILE MODE — replace entire file content (no patches at all)
          for (const block of fileBlocks) {
            await saveFileBlock(block)
          }
        }

        // Save assistant message
        await supabase.from('builder_messages').insert({
          project_id: projectId,
          org_id: orgId,
          role: 'assistant',
          content: fullText,
          affected_file_ids: updatedFileIds,
        })

        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ type: 'done', fileBlocks, updatedFileIds })}\n\n`
        ))
        controller.close()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
