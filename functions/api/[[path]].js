const UPSTREAM = 'https://aether-agent-core.taina-tvsm2021.workers.dev';
export async function onRequest({request}) {
  const incoming=new URL(request.url);
  if(!incoming.pathname.startsWith('/api/'))return new Response('Not found',{status:404});
  const target=new URL(incoming.pathname+incoming.search,UPSTREAM);
  const headers=new Headers(request.headers);headers.delete('host');
  try {
    const response=await fetch(new Request(target,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,redirect:'manual'}));
    const h=new Headers(response.headers);h.set('cache-control','no-store');h.set('x-content-type-options','nosniff');h.delete('access-control-allow-origin');
    return new Response(response.body,{status:response.status,headers:h});
  } catch {
    return new Response(JSON.stringify({error:{code:'SERVICE_UNAVAILABLE',message:'Serviço temporariamente indisponível.'}}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});
  }
}
