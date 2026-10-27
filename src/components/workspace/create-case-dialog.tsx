'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { createSubjectCaseAction } from '@/app/actions/create-subject-case';
import type { CreateCaseResult } from '@/server/subject-case';
import type { ActiveCase } from '@/lib/transaction-types';

export function CreateCaseDialog({transactionId,onCreated}:{transactionId:string;onCreated:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const alert=useRef<HTMLDivElement>(null);
  const key=useRef('');
  const [pending,setPending]=useState(false);
  const [result,setResult]=useState<CreateCaseResult|null>(null);
  const [existing,setExisting]=useState<ActiveCase|null>(null);
  async function recheck() {
    setPending(true);
    try {
      const response=await fetch('/api/v1/transactions/'+transactionId,{cache:'no-store'});
      if(!response.ok) {setResult({ok:false,status:response.status,message:response.status===401?'Your session ended. Sign in again, then retry. Your draft is still here.':'The transaction could not be checked. Try again.'});return;}
      const body=await response.json();setExisting(body.data.active_case);
    } catch {setResult({ok:false,status:503,message:'Check your connection, then try again. Your draft is still here.'});}
    finally {setPending(false);}
  }
  function close(){if(!pending){dialog.current?.close();trigger.current?.focus();}}
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(pending) return;
    if(!key.current) key.current=crypto.randomUUID();
    const form=new FormData(event.currentTarget);
    form.set('transactionId',transactionId);form.set('idempotencyKey',key.current);
    setPending(true);setResult(null);
    let response:CreateCaseResult;
    try {response=await createSubjectCaseAction(form);}
    catch {response={ok:false,status:503,message:'The case could not be saved. Retry with your draft unchanged.'};}
    setPending(false);setResult(response);
    if(response.ok) {dialog.current?.close();trigger.current?.focus();onCreated();}
    else requestAnimationFrame(()=>alert.current?.focus());
  }
  return <><Button ref={trigger} onClick={()=>{if(!key.current)key.current=crypto.randomUUID();dialog.current?.showModal();}}>Create case</Button>
    {result?.ok?<div className="case-result" role="status">Case <strong>{result.caseRef}</strong> {result.replayed?'already saved':'created and assigned to you'}.</div>:null}
    <dialog ref={dialog} aria-labelledby="create-case-title" onCancel={event=>{event.preventDefault();close();}}>
      <div className="dialog-heading"><h2 id="create-case-title">Create case</h2><button className="dialog-close" aria-label="Close case form" disabled={pending} onClick={close}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div>
      <form className="dialog-form" onSubmit={submit} onChange={()=>{key.current='';setResult(null);}} aria-busy={pending}>
        <p>A new case will be assigned to you for this transaction.</p><label htmlFor="case-subject">Subject transaction</label><input id="case-subject" value={transactionId} readOnly/>
        <label htmlFor="case-priority">Priority</label><select id="case-priority" name="priority" defaultValue="medium" disabled={pending}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
        <label htmlFor="case-reason">Reason</label><textarea id="case-reason" name="reason" required maxLength={2000} rows={5} disabled={pending} aria-describedby="reason-help"/>
        <p id="reason-help" className="muted">Describe why this transaction needs investigation. Maximum 2,000 characters. Do not include customer identifiers, credentials or raw note bodies. The reason becomes permanent case history.</p>
        {result&&!result.ok?<div ref={alert} tabIndex={-1} className="notice notice-error" role="alert"><p>{result.message}</p>{result.status===401?<Link target="_blank" rel="noopener" href={'/sign-in?next='+encodeURIComponent('/transactions/'+transactionId)}>Sign in again in a new tab</Link>:null}</div>:null}
        {result&&!result.ok&&result.status===409?<><Button className="secondary" disabled={pending} onClick={recheck}>Check existing case</Button>{existing?<p role="status">{!existing.exists?'No active case is currently recorded.':existing.access==='permitted'?`Active case: ${existing.case_ref} (${existing.status}).`:'An active case exists. Its details are restricted.'}</p>:null}</>:null}
        <div className="action-row"><Button type="button" className="secondary" disabled={pending} onClick={close}>Cancel</Button><Button type="submit" disabled={pending}>{pending?'Saving case…':'Save case'}</Button></div>
      </form>
    </dialog></>;
}
