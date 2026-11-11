export async function api(path,options={}){
 const controller=new AbortController(),signal=options.signal
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort()
 let timedOut=false
 const timeout=setTimeout(()=>{timedOut=true;controller.abort()},90000)
 try{
  const method=(options.method||'GET').toUpperCase()
  const headers={...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})}
  if(!['GET','HEAD','OPTIONS'].includes(method))headers['X-Aether-Request']='1'
  const response=await fetch('/api'+path,{credentials:'include',...options,method,signal:controller.signal,headers})
  const data=await response.json().catch(()=>({}))
  if(!response.ok){const error=new Error(data.error?.message||(typeof data.error==='string'?data.error:'')||data.message||(response.status===401?'Entre na sua conta para continuar.':response.status===429?'Muitas solicitações. Aguarde um pouco e tente novamente.':'Não foi possível concluir a solicitação.'));error.status=response.status;throw error}
  return data
 }catch(error){
  if(error.name==='AbortError'&&timedOut)throw new Error('A solicitação demorou mais que o esperado. O servidor pode continuar processando. Atualize a conversa antes de tentar novamente.')
  if(error.name==='TypeError')throw new Error('Não foi possível conectar ao Aether. Confira a conexão e tente novamente.')
  throw error
 }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort)}
}
export const json=(method,body)=>({method,body:JSON.stringify(body)})
export const presets=[
 {name:'OpenAI',format:'openai',baseUrl:'https://api.openai.com/v1',model:'gpt-4o-mini'},
 {name:'Anthropic',format:'anthropic',baseUrl:'https://api.anthropic.com/v1',model:'claude-sonnet-4-20250514'},
 {name:'Groq',format:'openai',baseUrl:'https://api.groq.com/openai/v1',model:'llama-3.3-70b-versatile'},
 {name:'OpenRouter',format:'openai',baseUrl:'https://openrouter.ai/api/v1',model:'openai/gpt-4o-mini'},
 {name:'Together',format:'openai',baseUrl:'https://api.together.xyz/v1',model:'meta-llama/Llama-3.3-70B-Instruct-Turbo'},
 {name:'Ollama (cloud)',format:'openai',baseUrl:'https://ollama.com/v1',model:'gpt-oss:20b'},
 {name:'OpenClaw',format:'openai',baseUrl:'https://openclaw.ai/v1',model:'default'}
]
export function safeQr(value){return typeof value==='string'&&/^[A-Za-z0-9+/=]+$/.test(value)&&value.length<150000?value:''}
