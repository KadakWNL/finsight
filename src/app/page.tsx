import Link from 'next/link';
import { ThemeSwitch } from '@/components/workspace/theme-switch';
export default function Home() {
  return (
    <main id="main-content" className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-5 px-6 py-16">
      <h1 className="text-5xl font-semibold tracking-tight">FinSight</h1>
      <ThemeSwitch/><p className="muted max-w-xl text-lg leading-8">Explore suspicious transaction patterns and support analyst investigations using synthetic financial data.</p>
      <p className="demo-label">Synthetic demo data</p><Link className="button-link" href="/sign-in">Sign in to your workspace</Link>
    </main>
  );
}
