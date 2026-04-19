import type { BuilderFile } from '@/types/builder'

export function buildSrcdoc(files: BuilderFile[]): string {
  if (files.length === 0) return '<html><body><p style="color:#888;font-family:sans-serif;padding:2rem">No files yet</p></body></html>'

  const entry = files.find(f => f.is_entry) ?? files.find(f => f.path === 'index.html') ?? files[0]
  let html = entry.content

  // Inline CSS
  files.filter(f => f.mime_type === 'text/css').forEach(f => {
    html = html.replace(
      new RegExp(`<link[^>]*href=["']${f.path}["'][^>]*/?>`, 'g'),
      `<style>${f.content}</style>`
    )
    html = html.replace(
      new RegExp(`<link[^>]*href=["']./${f.path}["'][^>]*/?>`, 'g'),
      `<style>${f.content}</style>`
    )
  })

  // Inline JS
  files.filter(f => f.mime_type === 'text/javascript' || f.mime_type === 'application/javascript').forEach(f => {
    html = html.replace(
      new RegExp(`<script[^>]*src=["']${f.path}["'][^>]*></script>`, 'g'),
      `<script>${f.content}</script>`
    )
    html = html.replace(
      new RegExp(`<script[^>]*src=["']./${f.path}["'][^>]*></script>`, 'g'),
      `<script>${f.content}</script>`
    )
  })

  return html
}

export function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'html': return 'text/html'
    case 'css': return 'text/css'
    case 'js': return 'text/javascript'
    case 'json': return 'application/json'
    case 'svg': return 'image/svg+xml'
    default: return 'text/plain'
  }
}
