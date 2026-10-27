import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { safeWorkspacePath } from '@/lib/workspace';
import type { RiskBand } from '@/lib/transaction-types';

export function RiskBadge({band}:{band:RiskBand}) {
  return <span className={`risk-badge risk-${band}`}><span aria-hidden="true">●</span> {band[0].toUpperCase()+band.slice(1)}</span>;
}
export function PageHeading({title,description,children}:{title:string;description:string;children?:React.ReactNode}) {
  return <header className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{children}</header>;
}
export function EmptyState({title,children}:{title:string;children:React.ReactNode}) {
  return <div className="empty-state"><h3>{title}</h3><div>{children}</div></div>;
}
export function LoadingState({label}:{label:string}) {
  return <div className="loading-state" role="status"><span className="loading-mark" aria-hidden="true"/>{label}</div>;
}
export function ErrorState({status,message,returnTo,retry,newTab=false}:{status:number;message?:string;returnTo:string;retry?:()=>void;newTab?:boolean}) {
  const expired=status===401;
  const title=expired?'Your session ended':status===403?'Access is restricted':status===404?'Transaction not found':status===400?'Check the request':'This information is unavailable';
  return <div className="notice notice-error" role="alert"><h2>{title}</h2>
    <p>{expired?'Sign in again to continue. Your current filters are preserved.':message ?? 'Try again. If the problem continues, contact your project administrator.'}</p>
    <div className="action-row">{expired?<Link className="button-link" href={'/sign-in?next='+encodeURIComponent(safeWorkspacePath(returnTo))} target={newTab?'_blank':undefined} rel={newTab?'noopener':undefined}>Sign in again{newTab?' in a new tab':''}</Link>:retry?<Button className="secondary" onClick={retry}>Try again</Button>:null}
    {status===403?<Link href="/transactions">Go to transactions</Link>:null}</div></div>;
}
