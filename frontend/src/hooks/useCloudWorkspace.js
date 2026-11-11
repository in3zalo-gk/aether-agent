import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {api,json} from '../api.js'
import {nativeOk,nativeRequest} from '../lib/native.js'

export const defaultChatOptions={searchEnabled:false,browserVisible:false,deviceEnabled:false}
const visibleMessages=messages=>(messages||[]).filter(message=>message?.role==='user'||message?.role==='assistant')
// The worker only exposes toolCalls for chat.pending. Never revive an old
// proposal from local UI state after a reload or a completed tool turn.
export const pendingToolCalls=chat=>(chat?.messages||[]).flatMap(message=>message?.toolCalls||[]).filter(call=>call?.id)
export const stringifyToolResult=result=>{
  if(typeof result==='string')return result
  try{
    const serialized=JSON.stringify(result)
    if(typeof serialized==='string')return serialized
  }catch{}
  return String(result??'Resultado nativo indisponível.')
}
const aborted=error=>error?.name==='AbortError'
const messageFor=error=>error?.message||'Não foi possível concluir a solicitação.'
const withStatus=(error,status)=>{
  if(error&&typeof error==='object'&&typeof error.status!=='number'&&typeof status==='number')error.status=status
  return error
}

export function useCloudWorkspace(){
  const [me,setMeState]=useState(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [chatId,setChatIdState]=useState(null)
  const [providerId,setProviderIdState]=useState('')
  const [busyChats,setBusyChats]=useState({})
  const [toolStates,setToolStates]=useState({})
  const mounted=useRef(false)
  const meRef=useRef(me)
  const chatIdRef=useRef(chatId)
  const providerIdRef=useRef(providerId)
  const loadVersion=useRef(0)
  const controllers=useRef(new Set())
  const locks=useRef(new Set())
  const hadSession=useRef(false)

  const setMe=useCallback(update=>{
    const next=typeof update==='function'?update(meRef.current):update
    meRef.current=next
    if(next)hadSession.current=true
    setMeState(next)
    return next
  },[])
  const setChatId=useCallback(update=>{
    const next=typeof update==='function'?update(chatIdRef.current):update
    chatIdRef.current=next
    setChatIdState(next)
    return next
  },[])
  const setProviderId=useCallback(update=>{
    const next=typeof update==='function'?update(providerIdRef.current):update
    providerIdRef.current=next
    setProviderIdState(next)
    return next
  },[])
  const track=useCallback(controller=>{controllers.current.add(controller);return controller},[])
  const untrack=useCallback(controller=>controllers.current.delete(controller),[])
  const clearError=useCallback(()=>setError(''),[])

  const reconcileToolStates=useCallback(chat=>{
    const calls=pendingToolCalls(chat)
    setToolStates(current=>{
      const next={}
      // Calls missing from the fresh server chat are resolved. Keeping a
      // non-terminal local entry here would render Approve again after reload.
      for(const call of calls)next[call.id]=current[call.id]||{state:call.state||'pending'}
      return next
    })
  },[])

  const mergeChat=useCallback((id,data)=>{
    const serverChat=data?.chat
    if(serverChat){
      reconcileToolStates(serverChat)
      setMe(current=>current?{...current,chats:(current.chats||[]).map(chat=>chat.id===id?serverChat:chat)}:current)
      return
    }
    if(!data?.message)return
    setMe(current=>current?{...current,chats:(current.chats||[]).map(chat=>chat.id===id?{
      ...chat,
      messages:[...visibleMessages(chat.messages),{role:'assistant',content:data.message.content||data.message,sources:data.sources||[],toolCalls:data.toolCalls||[]}]
    }:chat)}:current)
  },[reconcileToolStates,setMe])

  const load=useCallback(async()=>{
    const version=++loadVersion.current
    const controller=track(new AbortController())
    if(mounted.current)setLoading(true)
    try{
      const data=await api('/me',{signal:controller.signal})
      if(!mounted.current||version!==loadVersion.current)return data
      setMe(data)
      setChatId(current=>data.chats?.some(chat=>chat.id===current)?current:data.chats?.[0]?.id||null)
      setProviderId(current=>data.providers?.some(provider=>provider.id===current)?current:data.providers?.[0]?.id||'')
      return data
    }catch(rawError){
      const loadError=withStatus(rawError,rawError?.status)
      if(!mounted.current||version!==loadVersion.current||aborted(loadError))return null
      if(loadError?.status===401){
        setMe(null)
        setChatId(null)
      }else{
        // A transient failure must not turn an already authenticated user into
        // a logged-out user.
        setError(messageFor(loadError))
      }
      return null
    }finally{
      untrack(controller)
      if(mounted.current&&version===loadVersion.current)setLoading(false)
    }
  },[setChatId,setMe,setProviderId,track,untrack])

  useEffect(()=>{
    mounted.current=true
    load()
    return()=>{
      mounted.current=false
      loadVersion.current++
      for(const controller of controllers.current)controller.abort()
      controllers.current.clear()
    }
  },[load])

  const resyncChat=useCallback(async id=>{
    const controller=track(new AbortController())
    try{
      const data=await api(`/chats/${id}`,{signal:controller.signal})
      if(!mounted.current)return
      mergeChat(id,data.chat?data:{chat:data})
    }catch(syncError){
      if(!aborted(syncError)&&mounted.current)setError(messageFor(syncError))
    }finally{untrack(controller)}
  },[mergeChat,track,untrack])

  const withLock=useCallback(async(id,work)=>{
    if(!id||locks.current.has(id))return false
    locks.current.add(id)
    if(mounted.current)setBusyChats(current=>({...current,[id]:true}))
    try{return await work()}finally{
      locks.current.delete(id)
      if(mounted.current)setBusyChats(current=>{const next={...current};delete next[id];return next})
    }
  },[])

  const send=useCallback(async text=>{
    const id=chatIdRef.current
    const current=meRef.current
    const chat=current?.chats?.find(item=>item.id===id)
    const content=typeof text==='string'?text.trim():''
    if(!content){setError('Digite uma mensagem antes de enviar.');return false}
    if(!chat){setError('Selecione uma conversa antes de enviar.');return false}
    if(!providerIdRef.current){setError('Selecione uma IA antes de enviar.');return false}
    if(locks.current.has(id)){setError('Esta conversa já está sendo processada.');return false}
    setError('')
    return withLock(id,async()=>{
      setMe(currentMe=>currentMe?{...currentMe,chats:(currentMe.chats||[]).map(item=>item.id===id?{
        ...item,messages:[...visibleMessages(item.messages),{id:`optimistic-${Date.now()}`,role:'user',content}]
      }:item)}:currentMe)
      const controller=track(new AbortController())
      try{
        const data=await api('/chat',{...json('POST',{chatId:id,providerId:providerIdRef.current,message:content,nativeAvailable:nativeOk(),browserVisible:Boolean(chat.options?.browserVisible),browserEnabled:Boolean(chat.options?.browserVisible),deviceEnabled:Boolean(chat.options?.deviceEnabled)}),signal:controller.signal})
        if(mounted.current)mergeChat(id,data)
        return true
      }catch(sendError){
        if(!aborted(sendError)&&mounted.current)setError(messageFor(sendError))
        // Do not retry a failed POST automatically: it may have reached the server.
        if(!aborted(sendError))await resyncChat(id)
        return false
      }finally{untrack(controller)}
    })
  },[mergeChat,resyncChat,setMe,track,untrack,withLock])

  const createChat=useCallback(async()=>{
    const controller=track(new AbortController())
    setError('')
    try{
      const data=await api('/chats',{...json('POST',{title:'Nova conversa',options:defaultChatOptions}),signal:controller.signal})
      const created=data.chat||data
      if(!created?.id)throw new Error('Não foi possível criar a conversa.')
      // Update refs before resolving so callers can immediately await this
      // method and call send() without waiting for React to render.
      if(mounted.current){
        setMe(current=>current?{...current,chats:[...(current.chats||[]),created]}:current)
        setChatId(created.id)
      }
      return created
    }catch(createError){if(!aborted(createError)&&mounted.current)setError(messageFor(createError));return null
    }finally{untrack(controller)}
  },[setChatId,setMe,track,untrack])

  const updateOptions=useCallback(async options=>{
    const id=chatIdRef.current
    if(!id){setError('Selecione uma conversa antes de alterar as opções.');return false}
    const existing=meRef.current?.chats?.find(chat=>chat.id===id)
    const nextOptions={...(existing?.options||defaultChatOptions),...(options||{})}
    const controller=track(new AbortController())
    try{
      const data=await api(`/chats/${id}`,{...json('PUT',{options:nextOptions}),signal:controller.signal})
      if(mounted.current)mergeChat(id,data)
      return true
    }catch(optionsError){if(!aborted(optionsError)&&mounted.current)setError(messageFor(optionsError));return false
    }finally{untrack(controller)}
  },[mergeChat,track,untrack])

  const deleteChat=useCallback(async id=>{
    if(!id){setError('Conversa inválida.');return false}
    const controller=track(new AbortController())
    try{
      await api(`/chats/${id}`,{method:'DELETE',signal:controller.signal})
      if(mounted.current)setMe(current=>{
        if(!current)return current
        const chats=(current.chats||[]).filter(chat=>chat.id!==id)
        if(chatIdRef.current===id)setChatId(chats[0]?.id||null)
        return {...current,chats}
      })
      return true
    }catch(deleteError){if(!aborted(deleteError)&&mounted.current)setError(messageFor(deleteError));return false
    }finally{untrack(controller)}
  },[setChatId,setMe,track,untrack])

  const submitTool=useCallback(async(call,approved)=>{
    const id=chatIdRef.current
    if(!id||!call?.id){setError('Chamada de ferramenta inválida.');return false}
    const currentChat=meRef.current?.chats?.find(chat=>chat.id===id)
    const pendingCall=pendingToolCalls(currentChat).find(candidate=>candidate.id===call.id)
    if(!pendingCall){setError('Este comando já foi concluído. Sincronize a conversa.');return false}
    if(locks.current.has(id)){setError('Esta conversa já está sendo processada.');return false}
    return withLock(id,async()=>{
      let result
      let nativeFailed=false
      if(approved){
        setToolStates(current=>({...current,[call.id]:{state:'running'}}))
        try{result=stringifyToolResult(await nativeRequest(pendingCall.action,pendingCall.args||{}))
        }catch(nativeError){
          nativeFailed=true
          result=`Falha ao executar no dispositivo: ${messageFor(nativeError)}`
          setToolStates(current=>({...current,[call.id]:{state:'error',error:messageFor(nativeError)}}))
        }
      }else{
        result='Recusado pelo usuário.'
        setToolStates(current=>({...current,[call.id]:{state:'denied'}}))
      }
      const controller=track(new AbortController())
      try{
        const data=await api('/chat/tool-result',{...json('POST',{chatId:id,toolCallId:call.id,result}),signal:controller.signal})
        if(mounted.current){
          // A successful acknowledgement only means the server received the
          // result. It must not turn a failed native action into success.
          setToolStates(current=>({...current,[call.id]:nativeFailed?{...current[call.id],state:'error'}:{state:approved?'success':'denied'}}))
          mergeChat(id,data)
        }
        return true
      }catch(toolError){
        if(!aborted(toolError)&&mounted.current){
          setToolStates(current=>({...current,[call.id]:{state:'error',error:messageFor(toolError)}}))
          setError(messageFor(toolError))
          await resyncChat(id)
        }
        return false
      }finally{untrack(controller)}
    })
  },[mergeChat,resyncChat,track,untrack,withLock])

  const stop=useCallback(()=>{
    const count=controllers.current.size
    for(const controller of controllers.current)controller.abort()
    controllers.current.clear()
    if(count)setError('Solicitação interrompida no app. O servidor pode continuar processando; sincronize a conversa depois.')
  },[])

  const chat=useMemo(()=>{
    const selected=me?.chats?.find(item=>item.id===chatId)
    if(!selected)return null
    return {...selected,messages:(selected.messages||[]).map(message=>message?.toolCalls?{
      ...message,toolCalls:message.toolCalls.map(call=>toolStates[call.id]?{...call,...toolStates[call.id]}:call)
    }:message)}
  },[chatId,me,toolStates])
  const busy=Boolean(chatId&&busyChats[chatId])

  return {me,loading,error,load,chatId,setChatId,providerId,setProviderId,chat,busy,createChat,send,submitTool,updateOptions,deleteChat,clearError,stop}
}

export default useCloudWorkspace
