/* Cacheia somente a interface pública. Nunca cachear API, mensagens ou chaves. */
const CACHE='aether-ui-20261111-02'
const SHELL=['/','/manifest.json','/favicon.svg','/icons/icon-192.png','/icons/icon-512.png']
const assetPath=path=>/^\/assets\/[^/]+\.(?:js|css)$/.test(path)
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE)
 await cache.addAll(SHELL)
 const shell=await cache.match('/')
 const html=await shell.text()
 const assets=[...new Set([...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(match=>match[1]).filter(assetPath))]
 await cache.addAll(assets)
 await self.skipWaiting()
})()))
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('aether-ui-')&&key!==CACHE)await caches.delete(key);await self.clients.claim()})()))
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url)
 if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api'))return
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request).then(async response=>{if(response.ok){const cache=await caches.open(CACHE);await cache.put('/',response.clone())}return response}).catch(async()=>await (await caches.open(CACHE)).match('/')||Response.error()))
 }else if(assetPath(url.pathname)||SHELL.slice(1).includes(url.pathname)){
  event.respondWith((async()=>{const cache=await caches.open(CACHE);const cached=await cache.match(event.request);if(cached)return cached;const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response})())
 }
})
