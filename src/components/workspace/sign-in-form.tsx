'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { landingPath } from '@/lib/workspace';

export function SignInForm({next}:{next:string|null}) {
  const [ready,setReady]=useState(false);
  const [pending,setPending]=useState(false);const [error,setError]=useState('');const [show,setShow]=useState(false);
  const alert=useRef<HTMLParagraphElement>(null);
  useEffect(()=>setReady(true),[]);
  useEffect(()=>{if(error) alert.current?.focus();},[error]);
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setPending(true);setError('');
    const fields=new FormData(event.currentTarget);
    try {
      const response=await fetch('/api/auth/login',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},
        body:JSON.stringify({email:fields.get('email'),password:fields.get('password')})});
      const body=await response.json();
      if(!response.ok || !['analyst','admin'].includes(body.user?.role)) {
        setError(response.status===401?'Invalid email or password.':'Sign-in is temporarily unavailable. Try again.');setPending(false);return;
      }
      window.location.assign(landingPath(body.user.role,next));
    } catch {setError('Check your connection, then try again.');setPending(false);}
  }
  return <form method="post" onSubmit={submit} className="sign-in-form" aria-busy={pending}>
    {error?<p ref={alert} className="field-alert" role="alert" tabIndex={-1}>{error}</p>:null}
    <label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="username" required maxLength={320}/>
    <label htmlFor="password">Password</label><div className="password-input"><input id="password" name="password" type={show?'text':'password'} autoComplete="current-password" required maxLength={1024}/><button type="button" className="password-toggle" aria-pressed={show} onClick={()=>setShow(!show)}>{show?'Hide':'Show'}</button></div>
    <Button type="submit" disabled={!ready||pending}>{pending?'Signing in…':'Sign in'}</Button>
    <p className="muted">Use your provisioned analyst or administrator account.</p>
  </form>;
}
