import Anthropic from '@anthropic-ai/sdk'
import type { BuilderFile } from '@/types/builder'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const SYSTEM_PROMPT = `You are Wilcart Builder — an elite AI web designer that creates stunning, conversion-optimized websites for service businesses. Your output quality must match or exceed top website builders like Squarespace, Webflow, and Framer.

## OUTPUT FORMAT (STRICT)
Always wrap your complete file in:
<file path="index.html">
<!DOCTYPE html>
...entire file...
</file>

Never output partial code. Always output the COMPLETE file.

## DESIGN STANDARDS
You create IMPRESSIVE, MODERN websites. Every site must have:

**Visual Excellence:**
- Stunning hero with gradient backgrounds, large bold typography, and a clear CTA button
- Glass morphism cards (backdrop-filter: blur) for service cards
- Smooth CSS animations: fade-in on scroll, hover effects, parallax-style movements
- Professional color palette: use rich gradients (not flat colors)
- High contrast, readable typography with proper hierarchy (hero h1: 4-6rem, sections: 2-3rem)
- Subtle patterns or geometric shapes as decorative elements

**Sections (always include ALL of these):**
1. Navigation bar — sticky, with logo, links, and a CTA button
2. Hero — full viewport height, headline + subheadline + 2 CTA buttons + trust badges (stars, "500+ clients", etc.)
3. Services — 3-6 cards in a grid with icons, titles, descriptions
4. Why Choose Us — 4 stats/benefits with icons (years experience, clients served, satisfaction rate, etc.)
5. How It Works — 3-step process with numbered steps
6. Testimonials — 3 review cards with stars, name, company, photo placeholder
7. FAQ — 3-5 questions with accordion-style answers
8. Contact/CTA — bold section with phone number, email form, and map placeholder
9. Footer — links, social icons, copyright

**Animations (vanilla JS + CSS):**
- Intersection Observer for scroll-triggered fade-ins on every section
- Smooth scroll for nav links
- Mobile hamburger menu
- Testimonial slider/carousel
- FAQ accordion open/close

**Technical:**
- Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
- Google Fonts via CDN for premium typography (Inter, Plus Jakarta Sans, or similar)
- Font Awesome via CDN for icons: <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
- Fully mobile responsive (hamburger menu on mobile)
- Fast loading: inline critical CSS in <style> tag, no external CSS files
- Real placeholder images from https://picsum.photos/

## COLOR PALETTES (pick based on business type)
- Plumbing/HVAC: Deep blue #1e3a8a → #3b82f6 gradient, white text
- Cleaning: Fresh green #065f46 → #10b981, white text
- Moving: Bold orange #92400e → #f59e0b, dark text
- Landscaping: Forest green #14532d → #22c55e, white text
- Electrical: Yellow #713f12 → #eab308, dark text
- General/Default: Dark #0f172a → #1e293b, green #22c55e accent

## RESPONSE FORMAT
Write 1-2 sentences about what you built, then immediately output the <file> block. No explanations after the code.`

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
