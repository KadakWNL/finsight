'use client';
import { useEffect, useState } from 'react';

export interface ReadError {status:number;message:string;fields?:Record<string,string>}
export function useApi<T>(url:string) {
  const [state,setState]=useState<{data:T|null;loading:boolean;error:ReadError|null;loadedUrl:string|null}>({data:null,loading:true,error:null,loadedUrl:null});
  const [version,setVersion]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setState(previous=>({...previous,loading:true,error:null}));
    void (async()=>{
      try {
        const response=await fetch(url,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
        const body=await response.json().catch(()=>null);
        if(controller.signal.aborted) return;
        if(!response.ok) {
          setState(previous=>({...previous,data:response.status===401||response.status===403?null:previous.data,loading:false,
            error:{status:response.status,message:body?.error?.message ?? 'The request could not be completed.',fields:body?.error?.fields}}));
          return;
        }
        if(!body || typeof body!=='object') throw new Error('Unexpected response');
        setState({data:body as T,loading:false,error:null,loadedUrl:url});
      } catch(error) {
        if(controller.signal.aborted) return;
        setState(previous=>({...previous,loading:false,error:{status:0,message:error instanceof Error && error.message==='Unexpected response'?'The service returned an unexpected response.':'Check your connection, then try again.'}}));
      }
    })();
    return ()=>controller.abort();
  },[url,version]);
  return {...state,reload:()=>setVersion(n=>n+1)};
}
