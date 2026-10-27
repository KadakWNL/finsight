'use client';
import Link from 'next/link';
export default function WorkspaceError({reset}:{reset:()=>void}) {
  return <main id="main-content" className="standalone-error"><h1>Workspace unavailable</h1><p>Your data could not be loaded. Try again.</p><button className="button-link" onClick={reset}>Try again</button><Link href="/sign-in">Return to sign in</Link></main>;
}
