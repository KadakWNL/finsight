'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { roleHome } from '@/lib/workspace';
import type { HumanRole } from '@/lib/workspace';
import { ThemeSwitch } from './theme-switch';
import { SettingsIcon } from '@/components/ui/settings-icon';
import { DisplayPreferencesProvider, useDisplayPreferences } from './display-preferences';

type Profile={displayName:string;role:HumanRole};
function NavigationIcon({kind}:{kind:'overview'|'transactions'|'cases'|'settings'}) {
  if(kind==='settings') return <SettingsIcon/>;
  if(kind==='overview') return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 10v10"/></svg>;
  if(kind==='cases') return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>;
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4"/></svg>;
}
export function AppShell(props:{initialUser:Profile;children:React.ReactNode}) {
  return <DisplayPreferencesProvider><WorkspaceShell {...props}/></DisplayPreferencesProvider>;
}
function WorkspaceShell({initialUser,children}:{initialUser:Profile;children:React.ReactNode}) {
  const { timeZone } = useDisplayPreferences();
  const pathname=usePathname();
  const [profile,setProfile]=useState<Profile|null>(initialUser);
  const [signingOut,setSigningOut]=useState(false);
  const [error,setError]=useState('');
  const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
  const menu=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    const read=()=>{
      try {setSidebarCollapsed(localStorage.getItem('finsight-sidebar-collapsed')==='true');}
      catch { /* Keep the sidebar usable when browser storage is unavailable. */ }
    };
    const sync=(event:StorageEvent)=>{if(event.key==='finsight-sidebar-collapsed'||event.key===null) read();};
    read();window.addEventListener('storage',sync);
    return ()=>window.removeEventListener('storage',sync);
  },[]);
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
  function toggleSidebar() {
    const next=!sidebarCollapsed;
    setSidebarCollapsed(next);
    try {localStorage.setItem('finsight-sidebar-collapsed',String(next));}
    catch { /* The current choice still works without persistence. */ }
  }
  const toggleLabel=sidebarCollapsed?'Expand sidebar':'Collapse sidebar';
  const links=<><Link href={home} onClick={closeMenu} aria-label="Overview" aria-current={pathname===home?'page':undefined}><NavigationIcon kind="overview"/><span className="sidebar-link-label">Overview</span><span className="sidebar-tooltip" aria-hidden="true">Overview</span></Link>
    <Link href="/cases" onClick={closeMenu} aria-label="Cases" aria-current={pathname.startsWith('/cases')?'page':undefined}><NavigationIcon kind="cases"/><span className="sidebar-link-label">Cases</span><span className="sidebar-tooltip" aria-hidden="true">Cases</span></Link>
    <Link href="/transactions" onClick={closeMenu} aria-label="Transactions" aria-current={pathname.startsWith('/transactions')?'page':undefined}><NavigationIcon kind="transactions"/><span className="sidebar-link-label">Transactions</span><span className="sidebar-tooltip" aria-hidden="true">Transactions</span></Link></>;
  const settingsLink=<Link href="/settings" onClick={closeMenu} aria-current={pathname==='/settings'?'page':undefined}><NavigationIcon kind="settings"/> Settings</Link>;
  return <div className="workspace" data-sidebar-collapsed={sidebarCollapsed}><aside className="sidebar" id="workspace-sidebar"><div className="sidebar-top"><Link className="workspace-brand" href={home}>FinSight<span>Transaction intelligence</span></Link><button type="button" className="sidebar-toggle" onClick={toggleSidebar} aria-label={toggleLabel} aria-expanded={!sidebarCollapsed} aria-controls="workspace-sidebar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>{sidebarCollapsed?<path d="m13 8 4 4-4 4"/>:<path d="m17 8-4 4 4 4"/>}</svg><span className="sidebar-tooltip" aria-hidden="true">{toggleLabel}</span></button></div><nav aria-label="Primary navigation">{links}</nav><div className="sidebar-context"><div className="sidebar-account"><strong>{profile?.role==='admin'?'Administrator':profile?.role==='analyst'?'Analyst':'Session ended'}</strong><span>Synthetic demo data</span></div><Link className="sidebar-settings" href="/settings" aria-label="Settings" aria-current={pathname==='/settings'?'page':undefined}><NavigationIcon kind="settings"/><span className="sidebar-tooltip" aria-hidden="true">Settings</span></Link></div></aside>
    <div className="workspace-body"><header className="workspace-header"><div className="workspace-identity"><details ref={menu} className="mobile-menu"><summary>Menu</summary><nav aria-label="Mobile navigation">{links}{settingsLink}</nav></details><span className="workspace-context">Investigation workspace</span><span className="environment-label">Synthetic demo data</span></div>
      <div className="operator"><ThemeSwitch/>{profile?<><div className="operator-name"><strong>{profile.displayName}</strong><span>{profile.role==='admin'?'Administrator':'Analyst'}</span></div><Button className="secondary" disabled={signingOut} onClick={signOut}>{signingOut?'Signing out…':'Sign out'}</Button></>:<Link className="button-link" href={'/sign-in?next='+encodeURIComponent(pathname)}>Sign in again</Link>}</div>
      </header>
      {error?<p role="alert" className="shell-error">{error}</p>:null}
      <main id="main-content" className="workspace-main" tabIndex={-1}>{children}</main>
      <footer className="workspace-footer"><span>Financial facts and recorded evidence</span><span>Times shown in {timeZone}</span></footer>
    </div></div>;
}
