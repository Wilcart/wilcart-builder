import Anthropic from '@anthropic-ai/sdk'
import type { BuilderFile } from '@/types/builder'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPTS
//
// Architectural decision (2026-04-26): we ALWAYS produce the complete file.
// No patch blocks. No surgical edits. No mode-switching heuristics. This is
// what bolt.new / v0 / lovable do — it's slower per edit but eliminates the
// entire class of "patch failed silently and Claude lied about it" bugs that
// plagued earlier versions.
// ─────────────────────────────────────────────────────────────────────────────

const COMMON_RULES = `
## OUTPUT FORMAT (mandatory — non-negotiable)
Wrap your HTML in a <file> tag with the path attribute:
<file path="index.html">
<!DOCTYPE html>
<html>...complete file from <!DOCTYPE> to </html>...</html>
</file>

NEVER output partial code, snippets, diffs, or <patch> blocks. ALWAYS the full file.
For separate pages (privacy, terms, about) output additional <file path="X.html"> blocks.

## NAVIGATION (preview will break otherwise)
- Use ONLY plain anchor links: <a href="#sectionId"> for in-page scroll, <a href="page.html"> for separate pages
- NEVER use window.location, location.href, location.assign
- NEVER use onclick="window.location.href='...'" or similar JS navigation
- NEVER write JS functions like showPage(), switchPage(), navigateTo() that toggle display:none on page divs — these BREAK reliably
- Hamburger menu JS may only toggle visibility of the menu container itself
- For multi-section single-page sites: use <section id="x"> + <a href="#x"> + CSS scroll-behavior:smooth
- For separate pages: create real .html files, link with <a href="filename.html">

## DESIGN STANDARD
- Tailwind CSS via CDN: https://cdn.tailwindcss.com
- Font Awesome 6: https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css
- Google Fonts (Inter): preconnect + import
- Glass-morphism cards: background:rgba(255,255,255,0.05);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.1);border-radius:16px
- Mobile responsive on EVERY layout: sm: md: lg: prefixes, never fixed sizes without breakpoints
- Smooth animations: Intersection Observer for fade-in, hover transitions
- scroll-behavior:smooth on html element

## COLOR PALETTES (pick by industry, default to green)
- Plumbing/HVAC: #1e3a8a → #3b82f6 (blue)
- Cleaning: #065f46 → #10b981 (green)
- Moving: #0f172a + #22c55e (dark + green) — DEFAULT
- Landscaping: #14532d → #22c55e (deep green)
- Electrical: #713f12 → #eab308 (amber)
- Restaurant: #7f1d1d → #ef4444 (red)

## COMPACT HTML (saves tokens)
- No HTML comments
- No blank lines between tags
- Inline short styles
- Concise variable names in JS

## RESPONSE FORMAT
Start with ONE short sentence describing what you built or changed.
Then output the <file> block(s).
NOTHING after the last </file>.`

const SYSTEM_PROMPT_CREATE = `You are Wilcart Builder — an elite AI web designer creating stunning websites for service businesses.

Build a complete single-page website with all 9 sections in this exact order:

1. **Nav** — sticky/fixed, logo + links + "Get Quote" CTA, hamburger on mobile
2. **Hero** — min-height:100vh, gradient/radial background, headline (text-4xl md:text-6xl), subheadline, 2 CTA buttons, trust badges row
3. **Services** — 3-6 glass-morphism cards in a responsive grid, each with icon + title + description + check-list
4. **Stats** — 4 counter cards: years experience / customers served / rating / completed projects
5. **How It Works** — 3 numbered steps in cards
6. **Testimonials** — 3 cards: 5 stars + quote + customer name + role
7. **FAQ** — 4 accordion items with click-to-expand (small JS)
8. **Contact** — contact info card (phone/email/address) + form (name, email, phone, service select, message, submit)
9. **Footer** — logo+tagline+social icons / Quick Links / Services links / Contact info / © year + Privacy/Terms links

⚠️ The site is INCOMPLETE without all 9 sections including the Footer. Budget tokens — keep sections concise so the footer always fits.

${COMMON_RULES}`

const SYSTEM_PROMPT_EDIT = `You are Wilcart Builder — modifying an existing website to match the user's request.

You will receive the complete current HTML and a user request. Your job:

1. Read the current code carefully
2. Apply the user's requested change
3. Output the COMPLETE updated file from <!DOCTYPE html> to </html>

Keep everything else identical to the current code — same business name, contact info, sections, colors, structure. Change ONLY what the user asked for.

If the user asks to "fix", "rewrite", "rebuild" or the current code looks broken (duplicates, malformed tags, showPage poison): produce a clean fresh version using the same business info but a corrected structure.

${COMMON_RULES}`

const SYSTEM_PROMPT_SCREENSHOT = `You are Wilcart Builder — recreating a website design from a screenshot.

Study the screenshot carefully:
- Layout & section structure
- Color scheme (extract exact colors)
- Typography hierarchy
- Navigation
- Section content
- Card styles, spacing, shadows
- Buttons, icons
- Footer structure

Recreate it as a complete functional website with realistic placeholder content matching the business type shown.

${COMMON_RULES}`

// ─────────────────────────────────────────────────────────────────────────────
// PARSING & VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

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

  // Fallback 1: unclosed <file> tag (response cut off — shouldn't happen with 32k tokens but be safe)
  if (blocks.length === 0) {
    const openMatch = text.match(/<file path="([^"]+)">([\s\S]+)/)
    if (openMatch) {
      blocks.push({ path: openMatch[1].trim(), content: openMatch[2].trim() })
    }
  }

  // Fallback 2: raw HTML without <file> wrapper
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

// Reject any output that contains forbidden SPA-style navigation patterns.
// These break the iframe preview reliably and accumulate junk over edits.
export function detectForbiddenPatterns(content: string): string[] {
  const violations: string[] = []
  if (/showPage\s*\(/i.test(content)) violations.push('showPage()')
  if (/switchPage\s*\(/i.test(content)) violations.push('switchPage()')
  if (/navigateTo\s*\(/i.test(content)) violations.push('navigateTo()')
  if (/onclick=["'][^"']*window\.location/i.test(content)) violations.push('onclick="window.location"')
  if (/onclick=["'][^"']*location\.href/i.test(content)) violations.push('onclick="location.href"')
  return violations
}

// Detect a complete HTML doc — must have <html>, <body>, and reasonable size
export function isReasonableHtml(content: string): { ok: boolean; reason?: string } {
  if (content.length < 1500) return { ok: false, reason: 'too short (likely truncated)' }
  if (content.length > 80000) return { ok: false, reason: 'too large (>80KB, likely accumulated junk)' }
  if (!/<html/i.test(content)) return { ok: false, reason: 'missing <html> tag' }
  if (!/<body/i.test(content)) return { ok: false, reason: 'missing <body> tag' }
  if (!/<\/html>/i.test(content)) return { ok: false, reason: 'missing </html> closing tag' }
  if (!/<\/body>/i.test(content)) return { ok: false, reason: 'missing </body> closing tag' }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE SELECTION
// ─────────────────────────────────────────────────────────────────────────────

function hasRealContent(files: BuilderFile[]): boolean {
  const entry = files.find(f => f.path === 'index.html' || f.is_entry)
  if (!entry) return false
  return entry.content.length > 2000 && !entry.content.includes('Start chatting with AI')
}

// ─────────────────────────────────────────────────────────────────────────────
// STREAM GENERATION
// ─────────────────────────────────────────────────────────────────────────────

export async function* streamGenerate(
  prompt: string,
  projectFiles: BuilderFile[],
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  image?: { base64: string; mediaType: string } | null
) {
  const existingContent = hasRealContent(projectFiles)
  const entryFile = projectFiles.find(f => f.path === 'index.html' || f.is_entry)

  let systemPrompt: string
  let userMessage: Anthropic.MessageParam['content']

  if (image && !existingContent) {
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
        text: `CURRENT WEBSITE CODE:\n<file path="index.html">\n${entryFile?.content ?? ''}\n</file>\n\nUSER REQUEST: ${prompt || 'Update the design to match this screenshot reference'}\n\nOutput the COMPLETE updated file.`,
      },
    ]
  } else if (existingContent) {
    systemPrompt = SYSTEM_PROMPT_EDIT
    userMessage = `CURRENT WEBSITE CODE:
<file path="index.html">
${entryFile?.content ?? ''}
</file>

USER REQUEST: ${prompt}

Output the COMPLETE updated file with the user's change applied. Keep all other content identical.`
  } else {
    systemPrompt = SYSTEM_PROMPT_CREATE
    userMessage = prompt
  }

  // Strip code blocks from history so we don't waste tokens (and confuse Claude)
  // by sending the same long HTML twice. We send the current code in the user message.
  const history = conversationHistory.slice(-3).map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.role === 'assistant'
      ? (m.content
          .replace(/<file path="[^"]+">[\s\S]*?<\/file>/g, '[previous version]')
          .trim() || '[generated]')
      : m.content,
  }))

  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: 'user', content: userMessage },
  ]

  // Prompt caching: cache the system prompt (saves 90% on repeated requests within 5 min)
  // The system field accepts an array of cached blocks since Claude API 2024-08-01
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-5',
    max_tokens: 32000,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
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
