import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { streamGenerate, parseFileBlocks } from '@/lib/builder/claude'
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

        // Parse file blocks and save to DB
        const fileBlocks = parseFileBlocks(fullText)
        const updatedFileIds: string[] = []

        for (const block of fileBlocks) {
          // Find existing file by path
          const existing = (files ?? []).find(f => f.path === block.path)
          if (existing) {
            await admin
              .from('builder_files')
              .update({ content: block.content, size_bytes: block.content.length, updated_at: new Date().toISOString() })
              .eq('id', existing.id)
            updatedFileIds.push(existing.id)
          } else {
            // Create new file
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
