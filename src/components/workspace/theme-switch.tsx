'use client';
import { useEffect, useState } from 'react';

export function ThemeSwitch() {
  const [theme,setTheme]=useState<'light'|'dark'>('light');
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    const media=matchMedia('(prefers-color-scheme: dark)');
    const read=()=>setTheme(document.documentElement.dataset.theme==='dark'?'dark':'light');
    const followSystem=()=>{
      try {if(localStorage.getItem('finsight-theme')) return;} catch { /* System preference still works without storage. */ }
      document.documentElement.dataset.theme=media.matches?'dark':'light';read();
    };
    read();setReady(true);media.addEventListener('change',followSystem);
    const sync=(event:StorageEvent)=>{if(event.key==='finsight-theme'){document.documentElement.dataset.theme=event.newValue==='dark'?'dark':event.newValue==='light'?'light':media.matches?'dark':'light';read();}};
    window.addEventListener('storage',sync);
    return ()=>{media.removeEventListener('change',followSystem);window.removeEventListener('storage',sync);};
  },[]);
  function toggle() {
    const next=theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;setTheme(next);
    try {localStorage.setItem('finsight-theme',next);} catch { /* The in-memory selection remains usable. */ }
  }
  return <button type="button" className="theme-switch" disabled={!ready} onClick={toggle} aria-label={theme==='dark'?'Switch to light mode':'Switch to dark mode'} title={theme==='dark'?'Switch to light mode':'Switch to dark mode'}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{theme==='dark'?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>:<path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"/>}</svg>
  </button>;
}
