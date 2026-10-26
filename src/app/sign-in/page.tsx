import { redirect } from 'next/navigation';
import { SignInForm } from '@/components/workspace/sign-in-form';
import { currentPageUser } from '@/server/page-auth';
import { landingPath } from '@/lib/workspace';
import { ThemeSwitch } from '@/components/workspace/theme-switch';

export default async function SignInPage({searchParams}:{searchParams:Promise<{next?:string;callbackUrl?:string}>}) {
  const params=await searchParams;
  const next=typeof params.next==='string'?params.next:typeof params.callbackUrl==='string'?params.callbackUrl:null;
  let user=null;
  try {user=await currentPageUser();} catch { /* Keep sign-in usable when session storage is unavailable. */ }
  if(user) redirect(landingPath(user.role,next));
  return <main id="main-content" className="sign-in-page"><aside className="sign-in-intro"><div className="brand">FinSight<span>Transaction intelligence</span></div>
    <div><h1>Follow the transaction.<br/>Understand the evidence.</h1><p>A workspace for discovering unusual activity and keeping investigation decisions traceable.</p></div>
    <span className="demo-label">Synthetic demo data</span></aside>
    <section className="sign-in-panel"><div className="sign-in-theme"><ThemeSwitch/></div><div className="sign-in-content"><h2>Sign in to FinSight</h2><p className="muted">Continue to your investigation workspace.</p><SignInForm next={next}/></div></section></main>;
}

