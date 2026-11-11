// AndroidX injects this object only into the allowlisted main frame.
export const nativeOk=()=>typeof window!=='undefined'&&Boolean(window.AetherNative&&(window.AetherNative.request||window.AetherNative.postMessage))

const requestId=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`

/**
 * Sends one confirmed action to the Android bridge. Results are intentionally
 * kept in memory only; callers decide whether a result may be sent to Aether.
 */
export function nativeRequest(action,args={}){
  return new Promise((resolve,reject)=>{
    if(!nativeOk()){
      reject(new Error('Disponível somente no app Android.'))
      return
    }

    const id=requestId()
    const bridge=window.AetherNative
    if(bridge.request){
      const done=event=>{
        if(event.detail?.id!==id)return
        clearTimeout(timer)
        window.removeEventListener('aether-native-result',done)
        event.detail.ok?resolve(event.detail.result):reject(new Error(String(event.detail.error||'Ação não concluída.')))
      }
      const timer=setTimeout(()=>{
        window.removeEventListener('aether-native-result',done)
        reject(new Error('O app não respondeu.'))
      },30000)
      window.addEventListener('aether-native-result',done)
      try{bridge.request(JSON.stringify({id,action,args}))}catch(error){
        clearTimeout(timer)
        window.removeEventListener('aether-native-result',done)
        reject(error)
      }
      return
    }

    const done=event=>{
      let data
      try{data=typeof event.data==='string'?JSON.parse(event.data):event.data}catch{return}
      if(data?.id!==id)return
      clearTimeout(timer)
      bridge.removeEventListener('message',done)
      data.ok?resolve(data.result):reject(new Error(String(data.error||'Ação não concluída.')))
    }
    const timer=setTimeout(()=>{
      bridge.removeEventListener('message',done)
      reject(new Error('O app não respondeu.'))
    },30000)
    bridge.addEventListener('message',done)
    try{bridge.postMessage(JSON.stringify({id,action,args}))}catch(error){
      clearTimeout(timer)
      bridge.removeEventListener('message',done)
      reject(error)
    }
  })
}
