'use client';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { compactRecordId, type RecordKind } from '@/lib/workspace';

export function RecordIdentifier({kind,id}:{kind:RecordKind;id:string}) {
  const inputId=useId();const disclosure=useRef<HTMLDetailsElement>(null);
  const [feedback,setFeedback]=useState('');
  async function copy() {
    try {await navigator.clipboard.writeText(id);setFeedback('Full '+kind+' ID copied.');}
    catch {setFeedback('Select the full ID below to copy it manually.');}
  }
  return <details className="record-identifier" ref={disclosure}><summary aria-label={'Show full '+kind+' ID'}><span className="identifier">{compactRecordId(kind,id)}</span><svg className="identifier-disclosure" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
    <div className="identifier-expanded"><label htmlFor={inputId}>Full {kind} ID</label><input id={inputId} readOnly value={id} onFocus={event=>event.currentTarget.select()} spellCheck={false}/><Button className="secondary" onClick={copy}>Copy {kind} ID</Button><p className="muted">The short label is abbreviated. Use the full UUID for exact lookup.</p><p role="status">{feedback}</p></div></details>;
}
