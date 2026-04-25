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
    if(!href||href==='#')return null;
    if(href==='/'||href==='./'||href==='./index.html')return'index.html';
    var clean=href.replace(/^\\.\\//,'').replace(/^\\/+/,'').replace(/\\.html$/,'');
    for(var i=0;i<pages.length;i++){
      var p=pages[i];
      if(p===href||p===href+'.html'||p===clean||p===clean+'.html')return p;
    }
    return null;
  }

  function handleNav(href){
    if(!href)return;
    if(href.startsWith('#')){
      var el=document.getElementById(href.slice(1));
      if(el)el.scrollIntoView({behavior:'smooth'});
      return;
    }
    if(href.startsWith('http://')||href.startsWith('https://')){
      window.open(href,'_blank','noopener,noreferrer');
      return;
    }
    if(/^(mailto:|tel:|javascript:)/i.test(href))return;
    var page=resolveHref(href);
    if(page)window.parent.postMessage({type:'navigate',page:page},'*');
  }

  // 1. Intercept <a> clicks FIRST — before any potentially-throwing code below
  document.addEventListener('click',function(e){
    var a=e.target.closest('a');
    if(!a)return;
    var href=a.getAttribute('href')||'';
    // href="" or href="#" — just prevent default (don't stop onclick, needed for SPA menus)
    if(href===''||href==='#'){e.preventDefault();return;}
    // href="#sectionId" — let browser scroll naturally
    if(href.startsWith('#'))return;
    e.preventDefault();
    e.stopImmediatePropagation();
    handleNav(href);
  },true);

  // 2. Override window.location — wrap entirely in try/catch so errors don't stop execution
  // NOTE: do NOT read window.location.href here — it throws SecurityError in sandboxed iframes
  try{
    var _loc={pathname:'/',search:'',hash:'',
      assign:function(u){handleNav(String(u));},
      replace:function(u){handleNav(String(u));},
      reload:function(){}};
    // Define href as a setter so window.location.href = 'url' calls handleNav
    Object.defineProperty(_loc,'href',{
      get:function(){return'about:srcdoc';},
      set:function(u){handleNav(String(u));},
      enumerable:true,configurable:true
    });
    Object.defineProperty(window,'location',{get:function(){return _loc;},configurable:true});
  }catch(e){}

  // 3. Neutralise history navigation
  try{
    window.history.pushState=function(s,t,url){if(url)handleNav(String(url));};
    window.history.replaceState=function(s,t,url){if(url)handleNav(String(url));};
  }catch(e){}

  // 4. Override window.open — catch _self/_top/_parent targets
  try{
    var _origOpen=window.open.bind(window);
    window.open=function(url,target,features){
      if(!url)return _origOpen(url,target,features);
      var t=target||'_blank';
      if(t==='_self'||t==='_parent'||t==='_top'){handleNav(String(url));return null;}
      if(!String(url).startsWith('http')&&!String(url).startsWith('//'))
        {handleNav(String(url));return null;}
      return _origOpen(url,'_blank','noopener,noreferrer');
    };
  }catch(e){}

  // 5. Block form submissions that would navigate away
  document.addEventListener('submit',function(e){
    var form=e.target;
    var action=form&&form.getAttribute('action');
    if(!action||action.startsWith('#')){e.preventDefault();}
  },true);

  // 6. Last-resort: if iframe somehow starts navigating, tell parent to reload srcdoc
  window.addEventListener('beforeunload',function(e){
    window.parent.postMessage({type:'reload'},'*');
    e.preventDefault();
    return false;
  });
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
