import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const plex=localFont({src:'./fonts/IBMPlexSans.ttf',variable:'--font-plex',display:'swap',weight:'100 700'});

export const metadata: Metadata = { title: 'FinSight', description: 'Financial transaction intelligence over synthetic data.' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={plex.variable} suppressHydrationWarning><head><script id="theme-init" dangerouslySetInnerHTML={{__html:"try{var t=localStorage.getItem('finsight-theme');document.documentElement.dataset.theme=t==='dark'||t==='light'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}catch(e){document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}"}}/></head><body><a className="skip-link" href="#main-content">Skip to content</a>{children}</body></html>;
}
