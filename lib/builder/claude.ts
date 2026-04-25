import Anthropic from '@anthropic-ai/sdk'
import type { BuilderFile } from '@/types/builder'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── CREATE MODE: Building a new site from scratch ───────────────────────────
const SYSTEM_PROMPT_CREATE = `You are Wilcart Builder — an elite AI web designer creating stunning websites for service businesses.

## OUTPUT FORMAT
<file path="index.html">
<!DOCTYPE html>
...complete file...
</file>

NEVER truncate. NEVER stop early. Output the FULL file every time.

## COMPACT HTML (critical — saves tokens so you can fit everything)
- No HTML comments (<!-- -->)
- No blank lines between tags
- Inline short styles where possible
- Keep JS concise — no verbose variable names

## REQUIRED SECTIONS (all 9, in this exact order — ALL are mandatory)
1. Nav — sticky, logo text + links + "Get Quote" CTA button, hamburger on mobile
2. Hero — min-height:100vh, gradient bg, h1 (4rem) + subheadline + 2 CTA buttons + trust badges
3. Services — 3 glass-morphism cards (backdrop-filter:blur(12px)) in grid, icon + title + desc
4. Stats — 4 counters: Years / Clients / Rating / Projects
5. How It Works — 3 numbered steps
6. Testimonials — 3 cards with stars, quote, name
7. FAQ — 4 accordion items (JS toggle)
8. Contact — form (name, email, phone, message) + contact info
9. Footer — logo, links, social icons, copyright ← ALWAYS LAST, ALWAYS INCLUDED

## ⚠️ FOOTER RULE
The site is INCOMPLETE without the Footer. Budget tokens early — write concise sections 1–8 so section 9 always fits. Never end the file at Contact or FAQ.

## DESIGN
- Hero: rich CSS gradient + overlay pattern
- Glass cards: background:rgba(255,255,255,0.07);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.12);border-radius:16px
- Google Font (Inter), Tailwind CSS CDN, Font Awesome 6 CDN
- Intersection Observer fade-in, hover animations, mobile responsive

## COLOR PALETTES
- Plumbing/HVAC: #1e3a8a→#3b82f6 | Cleaning: #065f46→#10b981 | Moving: #92400e→#f59e0b
- Landscaping: #14532d→#22c55e | Electrical: #713f12→#eab308 | Default: #0f172a + #22c55e

## RESPONSE
One sentence describing what you built, then the <file> block. Nothing after </file>.`

// ─── EDIT MODE: Modifying an existing site ────────────────────────────────────
const SYSTEM_PROMPT_EDIT = `You are Wilcart Builder — an AI web designer that makes SURGICAL edits to existing websites.

## YOUR ONLY JOB
Find the exact element the user mentioned, change ONLY that, output the full file unchanged everywhere else.

## OUTPUT FORMAT
<file path="index.html">
<!DOCTYPE html>
...complete modified file...
</file>

## SURGICAL EDIT RULES (read carefully)
- Read the CURRENT CODE first — understand what already exists
- Change ONLY what the user explicitly asked for
- Keep ALL other sections, styles, colors, fonts, and content 100% identical
- NEVER redesign, restructure, or "improve" parts the user didn't mention
- NEVER change section order, remove sections, or add unrequested sections
- Output the COMPLETE file — but only the requested change is different

## COMMON REQUESTS — HOW TO HANDLE
- "add a logo" / "make a logo" → Add an SVG or styled text logo ONLY inside the <nav> logo area. Nothing else changes.
- "change color of X" → Find that element's CSS/class. Change only that color. Nothing else.
- "update text in hero" → Change only that text node. Nothing else.
- "add a section" → Insert one new section in a logical place. All other sections unchanged.
- "change font" → Update only the Google Font import and font-family. Nothing else.

## ❌ NEVER DO THIS
- Do NOT rewrite sections that weren't mentioned
- Do NOT "improve" existing design while doing a small change
- Do NOT change the color palette because you're already touching the file
- Do NOT add new sections when asked to edit an existing one

## RESPONSE
One sentence describing exactly what you changed, then the <file> block. Nothing after </file>.`

// ─── SCREENSHOT COPY MODE ─────────────────────────────────────────────────────
const SYSTEM_PROMPT_SCREENSHOT = `You are Wilcart Builder — an AI web designer that recreates website designs from screenshots.

## YOUR JOB
Study the screenshot carefully and recreate it as a complete, functional HTML website.

## WHAT TO ANALYZE IN THE SCREENSHOT
- Overall layout and section structure
- Color scheme (exact colors, gradients, backgrounds)
- Typography (font sizes, weights, hierarchy)
- Navigation style and links
- Hero section design and content
- All visible sections and their content
- Card styles, spacing, shadows
- Buttons, icons, decorative elements
- Footer structure

## OUTPUT FORMAT
<file path="index.html">
<!DOCTYPE html>
...complete file that matches the screenshot...
</file>

## RULES
- Match the visual design as closely as possible
- Use Tailwind CSS CDN + Font Awesome 6 CDN + Google Fonts for the same look
- Fill in realistic placeholder content matching the business type shown
- Make it fully functional and mobile responsive
- Output the COMPLETE file — never truncate

## RESPONSE
One sentence describing the design you recreated, then the <file> block. Nothing after </file>.`

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

  // Fallback 1: unclosed <file> tag (response cut off)
  if (blocks.length === 0) {
    const openMatch = text.match(/<file path="([^"]+)">([\s\S]+)/)
    if (openMatch) {
      blocks.push({ path: openMatch[1].trim(), content: openMatch[2].trim() })
    }
  }

  // Fallback 2: raw HTML
  if (blocks.length === 0) {
    const htmlMatch = text.match(/<!DOCTYPE html[\s\S]*/i) ||
                      text.match(/<html[\s\S]*/i) ||
                      text.match(/```html\n?([\s\S]*?)\n?```/)
    if (htmlMatch) {
      blocks.push({ path: 'index.html', content: (htmlMatch[1] ?? htmlMatch[0]).trim() })
    }
  }

  return blocks
}

function hasRealContent(files: BuilderFile[]): boolean {
  const entry = files.find(f => f.path === 'index.html' || f.is_entry)
  if (!entry) return false
  // Default placeholder content is short and contains "Start chatting"
  return entry.content.length > 2000 && !entry.content.includes('Start chatting with AI')
}

export async function* streamGenerate(
  prompt: string,
  projectFiles: BuilderFile[],
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  image?: { base64: string; mediaType: string } | null
) {
  const existingContent = hasRealContent(projectFiles)
  const entryFile = projectFiles.find(f => f.path === 'index.html' || f.is_entry)

  // ── Determine mode ──────────────────────────────────────────────────────────
  let systemPrompt: string
  let userMessage: Anthropic.MessageParam['content']

  if (image && !existingContent) {
    // MODE: Copy design from screenshot (no existing site yet)
    systemPrompt = SYSTEM_PROMPT_SCREENSHOT
    userMessage = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
          data: image.base64,
        },
      },
      {
        type: 'text',
        text: `Recreate this website design as a complete HTML file.\n${prompt ? `Additional instructions: ${prompt}` : ''}`,
      },
    ]

  } else if (image && existingContent) {
    // MODE: Modify existing site using screenshot as reference
    systemPrompt = SYSTEM_PROMPT_EDIT
    userMessage = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
          data: image.base64,
        },
      },
      {
        type: 'text',
        text: `CURRENT WEBSITE CODE (modify this based on the screenshot and instructions below):
<file path="index.html">
${entryFile?.content ?? ''}
</file>

USER REQUEST: ${prompt || 'Update the design to match this screenshot reference'}`,
      },
    ]

  } else if (existingContent) {
    // MODE: Edit existing site with text instructions
    systemPrompt = SYSTEM_PROMPT_EDIT
    userMessage = `CURRENT WEBSITE CODE (apply the changes below to this code):
<file path="index.html">
${entryFile?.content ?? ''}
</file>

USER REQUEST: ${prompt}

Remember: ONLY change what the user asked for. Keep everything else exactly the same.`

  } else {
    // MODE: Create new site from scratch
    systemPrompt = SYSTEM_PROMPT_CREATE
    userMessage = prompt
  }

  // ── Build message history ───────────────────────────────────────────────────
  // For edit mode, we include the current code in the user message directly,
  // so we don't need many history messages (they'd just add noise)
  const historyLimit = existingContent ? 2 : 4
  const messages: Anthropic.MessageParam[] = [
    ...conversationHistory.slice(-historyLimit).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.role === 'assistant'
        ? m.content
            .replace(/<file path="[^"]+">[\s\S]*?<\/file>/g, '[previous code — see current code in next message]')
            .trim() || '[generated code]'
        : m.content,
    })),
    { role: 'user', content: userMessage },
  ]

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-5',
    max_tokens: 16000,
    system: systemPrompt,
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
