import Anthropic from '@anthropic-ai/sdk'
import type { BuilderFile } from '@/types/builder'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const SYSTEM_PROMPT = `You are Wilcart Builder's AI code generator. You generate production-ready HTML, CSS, and JavaScript for service business websites.

RULES:
1. Always respond with complete, valid file contents — never partial diffs or snippets.
2. When modifying a file, output the ENTIRE updated file content.
3. Use this exact format to indicate file output:
<file path="index.html">
... full file content ...
</file>
4. You may output multiple <file> blocks if modifying multiple files.
5. Use Tailwind CSS via CDN for styling: <script src="https://cdn.tailwindcss.com"></script>
6. Make every site fully mobile-responsive.
7. Use semantic HTML5. Always include: <meta charset="UTF-8">, <meta name="viewport" content="width=device-width, initial-scale=1.0">, and a <title>.
8. For JavaScript: vanilla JS only — no bundlers, no npm packages. CDN scripts only.
9. Default color scheme (unless user specifies): dark navy #0d1117 background, green #22c55e accent, white text.
10. For images: use https://picsum.photos/ for placeholder images or SVG icons inline.
11. Before the code blocks, write 1-3 sentences describing what you built or changed.
12. Make sites look professional and modern — suitable for real service businesses.
13. Include smooth animations where appropriate (CSS transitions, not heavy libraries).

CONTEXT: You are helping a service business owner build their website. Be proactive — if they say "make a plumber website", create a complete, impressive homepage with hero, services, testimonials, CTA, and footer.`

export interface FileBlock {
  path: string
  content: string
}

export function parseFileBlocks(text: string): FileBlock[] {
  const blocks: FileBlock[] = []
  const regex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g
  let match
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ path: match[1].trim(), content: match[2].trim() })
  }

  // Fallback 1: unclosed <file> tag (response was cut off before </file>)
  if (blocks.length === 0) {
    const openMatch = text.match(/<file path="([^"]+)">([\s\S]+)/)
    if (openMatch) {
      blocks.push({ path: openMatch[1].trim(), content: openMatch[2].trim() })
    }
  }

  // Fallback 2: raw HTML without file tags
  if (blocks.length === 0) {
    const htmlMatch = text.match(/<!DOCTYPE html[\s\S]*/i) ||
                      text.match(/<html[\s\S]*/i) ||
                      text.match(/```html\n?([\s\S]*?)\n?```/)
    if (htmlMatch) {
      const content = htmlMatch[1] ?? htmlMatch[0]
      blocks.push({ path: 'index.html', content: content.trim() })
    }
  }

  return blocks
}

export async function* streamGenerate(
  prompt: string,
  projectFiles: BuilderFile[],
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  image?: { base64: string; mediaType: string } | null
) {
  const fileContext = projectFiles.length > 0
    ? '\n\nCURRENT PROJECT FILES:\n' + projectFiles.map(f =>
        `<file path="${f.path}">\n${f.content}\n</file>`
      ).join('\n')
    : '\n\nCURRENT PROJECT: No files yet — create them from scratch.'

  // Build user content — add image if provided
  let userContent: Anthropic.MessageParam['content']
  if (image) {
    userContent = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
          data: image.base64,
        },
      },
      { type: 'text', text: prompt + fileContext },
    ]
  } else {
    userContent = prompt + fileContext
  }

  const messages: Anthropic.MessageParam[] = [
    ...conversationHistory.slice(-10),
    { role: 'user', content: userContent }
  ]

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages,
  })

  for await (const chunk of stream) {
    if (
      chunk.type === 'content_block_delta' &&
      chunk.delta.type === 'text_delta'
    ) {
      yield chunk.delta.text
    }
  }
}
