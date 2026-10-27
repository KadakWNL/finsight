'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { roleHome } from '@/lib/workspace';
import type { HumanRole } from '@/lib/workspace';
import { ThemeSwitch } from './theme-switch';

type Profile={displayName:string;role:HumanRole};
function NavigationIcon({kind}:{kind:'overview'|'transactions'|'cases'|'settings'}) {
  if(kind==='settings') return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 3-.5 2-2 1.2-2-.6-3 5.2L3 12l-1.5 1.2 3 5.2 2-.6 2 1.2.5 2h6l.5-2 2-1.2 2 .6 3-5.2L21 12l1.5-1.2-3-5.2-2 .6-2-1.2-.5-2Z"/><circle cx="12" cy="12" r="3"/></svg>;
  if(kind==='overview') return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 10v10"/></svg>;
  if(kind==='cases') return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>;
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4"/></svg>;
}
export function AppShell({initialUser,children}:{initialUser:Profile;children:React.ReactNode}) {
  const pathname=usePathname();
  const [profile,setProfile]=useState<Profile|null>(initialUser);
  const [signingOut,setSigningOut]=useState(false);
  const [error,setError]=useState('');
  const menu=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    const abort=new AbortController();
    void fetch('/api/auth/session',{cache:'no-store',signal:abort.signal}).then(async response=>{
      if(response.status===401){setProfile(null);return;}
      const body=await response.json();
      if(body.authenticated && ['analyst','admin'].includes(body.user?.role)) setProfile(body.user);
    }).catch(()=>{});
    return ()=>abort.abort();
  },[pathname]);
  async function signOut() {
    setSigningOut(true);setError('');
    try {
      const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});
      if(!response.ok) throw new Error();
      window.location.assign('/sign-in');
    } catch {setError('Sign-out could not be completed. Try again.');setSigningOut(false);}
  }
  const home=roleHome(profile?.role ?? initialUser.role);
  const closeMenu=()=>{if(menu.current) menu.current.open=false;};
  const links=<><Link href={home} onClick={closeMenu} aria-current={pathname===home?'page':undefined}><NavigationIcon kind="overview"/> Overview</Link>
    <Link href="/cases" onClick={closeMenu} aria-current={pathname.startsWith('/cases')?'page':undefined}><NavigationIcon kind="cases"/> Cases</Link>
    <Link href="/transactions" onClick={closeMenu} aria-current={pathname.startsWith('/transactions')?'page':undefined}><NavigationIcon kind="transactions"/> Transactions</Link></>;
  const settingsLink=<Link href="/settings" onClick={closeMenu} aria-current={pathname==='/settings'?'page':undefined}><NavigationIcon kind="settings"/> Settings</Link>;
  return <div className="workspace"><aside className="sidebar"><Link className="workspace-brand" href={home}>FinSight<span>Transaction intelligence</span></Link><nav aria-label="Primary navigation">{links}</nav><div className="sidebar-context"><div className="sidebar-account"><strong>{profile?.role==='admin'?'Administrator':profile?.role==='analyst'?'Analyst':'Session ended'}</strong><span>Synthetic demo data</span></div><Link className="sidebar-settings" href="/settings" aria-label="Settings" title="Settings" aria-current={pathname==='/settings'?'page':undefined}><NavigationIcon kind="settings"/></Link></div></aside>
    <div className="workspace-body"><header className="workspace-header"><div className="workspace-identity"><details ref={menu} className="mobile-menu"><summary>Menu</summary><nav aria-label="Mobile navigation">{links}{settingsLink}</nav></details><span className="workspace-context">Investigation workspace</span><span className="environment-label">Synthetic demo data</span></div>
      <div className="operator"><ThemeSwitch/>{profile?<><div className="operator-name"><strong>{profile.displayName}</strong><span>{profile.role==='admin'?'Administrator':'Analyst'}</span></div><Button className="secondary" disabled={signingOut} onClick={signOut}>{signingOut?'Signing out…':'Sign out'}</Button></>:<Link className="button-link" href={'/sign-in?next='+encodeURIComponent(pathname)}>Sign in again</Link>}</div>
      </header>
      {error?<p role="alert" className="shell-error">{error}</p>:null}
      <main id="main-content" className="workspace-main" tabIndex={-1}>{children}</main>
      <footer className="workspace-footer"><span>Financial facts and recorded evidence</span><span>Times shown in UTC</span></footer>
    </div></div>;
}
