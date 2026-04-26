import { createClient } from '@supabase/supabase-js'
import {
  streamGenerate,
  parseFileBlocks,
  detectForbiddenPatterns,
  isReasonableHtml,
  type FileBlock,
} from '@/lib/builder/claude'
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
  const { orgId, supabase } = access

  const { projectId, prompt, conversationHistory = [], image } = await req.json()
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

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))

      try {
        // ── Stream Claude's response ─────────────────────────────────────────
        let fullText = ''
        for await (const chunk of streamGenerate(
          prompt,
          files ?? [],
          conversationHistory,
          image
        )) {
          fullText += chunk
          send({ type: 'delta', text: chunk })
        }

        // ── Parse file blocks ────────────────────────────────────────────────
        const fileBlocks = parseFileBlocks(fullText)

        // ── Validate output ──────────────────────────────────────────────────
        const validationErrors: string[] = []

        if (fileBlocks.length === 0) {
          validationErrors.push("AI didn't return any complete code blocks")
        }

        for (const block of fileBlocks) {
          if (block.path.endsWith('.html')) {
            const sanityCheck = isReasonableHtml(block.content)
            if (!sanityCheck.ok) {
              validationErrors.push(`${block.path}: ${sanityCheck.reason}`)
            }
            const forbidden = detectForbiddenPatterns(block.content)
            if (forbidden.length > 0) {
              validationErrors.push(
                `${block.path}: contains forbidden navigation pattern(s): ${forbidden.join(', ')}. These break the preview.`
              )
            }
          }
        }

        if (validationErrors.length > 0) {
          // Tell user clearly what went wrong; do not save broken output
          const warning = `\n\n⚠️ The AI's response had issues and was not saved:\n${validationErrors.map(e => `• ${e}`).join('\n')}\n\nPlease try again — perhaps with a slightly different phrasing.`
          fullText += warning
          send({ type: 'delta', text: warning })

          await supabase.from('builder_messages').insert({
            project_id: projectId,
            org_id: orgId,
            role: 'assistant',
            content: fullText,
            affected_file_ids: [],
          })

          send({ type: 'done', updatedFileIds: [], failed: true, errors: validationErrors })
          controller.close()
          return
        }

        // ── Save all file blocks (full file replace, no patching) ────────────
        const updatedFileIds: string[] = []
        for (const block of fileBlocks) {
          const existing = (files ?? []).find(f => f.path === block.path)
          if (existing) {
            await admin
              .from('builder_files')
              .update({
                content: block.content,
                size_bytes: block.content.length,
                updated_at: new Date().toISOString(),
              })
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
                mime_type: block.path.endsWith('.css')
                  ? 'text/css'
                  : block.path.endsWith('.js')
                    ? 'text/javascript'
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

        // ── Save assistant message ───────────────────────────────────────────
        await supabase.from('builder_messages').insert({
          project_id: projectId,
          org_id: orgId,
          role: 'assistant',
          content: fullText,
          affected_file_ids: updatedFileIds,
        })

        // ── Done event tells client to refetch files from DB ─────────────────
        // Client never trusts the streamed payload — always refetches as source of truth
        send({ type: 'done', updatedFileIds, failed: false })
        controller.close()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error('[generate] error:', err)
        send({ type: 'error', message: msg })
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
