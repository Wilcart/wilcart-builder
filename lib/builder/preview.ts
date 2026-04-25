import type { BuilderFile } from '@/types/builder'

// Build srcdoc for a specific page (activePath) or the entry file
export function buildSrcdoc(files: BuilderFile[], activePath?: string): string {
  if (files.length === 0) return '<html><body><p style="color:#888;font-family:sans-serif;padding:2rem">No files yet — describe your website in the chat</p></body></html>'

  const entry = activePath
    ? (files.find(f => f.path === activePath) ?? files.find(f => f.is_entry) ?? files.find(f => f.path === 'index.html') ?? files[0])
    : (files.find(f => f.is_entry) ?? files.find(f => f.path === 'index.html') ?? files[0])

  if (!entry?.content) return '<html><body><p style="color:#888;font-family:sans-serif;padding:2rem">No content yet</p></body></html>'

  let html = entry.content

  // Inline CSS files
  files.filter(f => f.mime_type === 'text/css').forEach(f => {
    html = html.replace(new RegExp(`<link[^>]*href=["']${f.path}["'][^>]*/?>`, 'g'), `<style>${f.content}</style>`)
    html = html.replace(new RegExp(`<link[^>]*href=["']./${f.path}["'][^>]*/?>`, 'g'), `<style>${f.content}</style>`)
  })

  // Inline JS files
  files.filter(f => f.mime_type === 'text/javascript' || f.mime_type === 'application/javascript').forEach(f => {
    html = html.replace(new RegExp(`<script[^>]*src=["']${f.path}["'][^>]*></script>`, 'g'), `<script>${f.content}</script>`)
    html = html.replace(new RegExp(`<script[^>]*src=["']./${f.path}["'][^>]*></script>`, 'g'), `<script>${f.content}</script>`)
  })

  // Inject navigation interceptor — prevents white page when clicking internal links
  // Sends postMessage to parent so the editor can switch pages
  const htmlPages = files.filter(f => f.path.endsWith('.html')).map(f => f.path)
  const navScript = `<script>
(function(){
  var pages=${JSON.stringify(htmlPages)};
  function resolveHref(href){
    if(!href)return null;
    // Root "/" always means index.html
    if(href==='/'||href==='./'){return'index.html';}
    var clean=href.replace(/^\\/+/,'').replace(/\\.html$/,'');
    // Exact match or with .html suffix
    for(var i=0;i<pages.length;i++){
      var p=pages[i];
      if(p===href||p===href+'.html'||p===clean||p===clean+'.html'){return p;}
    }
    return null;
  }
  document.addEventListener('click',function(e){
    var a=e.target.closest('a[href]');
    if(!a)return;
    var href=a.getAttribute('href')||'';
    // Allow in-page hash links
    if(href.startsWith('#'))return;
    // Open truly external links in new tab safely
    if(href.startsWith('http://')||href.startsWith('https://')){
      e.preventDefault();
      window.open(href,'_blank','noopener,noreferrer');
      return;
    }
    // Ignore mailto/tel/javascript
    if(/^(mailto:|tel:|javascript:)/i.test(href))return;
    // Block ALL other navigations — prevent white page
    e.preventDefault();
    var page=resolveHref(href);
    if(page){window.parent.postMessage({type:'navigate',page:page},'*');}
  },true);
  // Also block form submissions that would navigate away
  document.addEventListener('submit',function(e){
    var form=e.target;
    if(form&&!form.getAttribute('action')){e.preventDefault();}
  },true);
})();
</script>`

  if (html.includes('</head>')) {
    html = html.replace('</head>', navScript + '\n</head>')
  } else {
    html = navScript + html
  }

  return html
}

export function getHtmlPages(files: BuilderFile[]): BuilderFile[] {
  return files.filter(f => f.path.endsWith('.html'))
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
