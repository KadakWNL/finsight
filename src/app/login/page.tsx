import { redirect } from 'next/navigation';
import { safeWorkspacePath } from '@/lib/workspace';
export default async function LoginAlias({searchParams}:{searchParams:Promise<{next?:string;callbackUrl?:string}>}) {
  const params=await searchParams;
  const next=typeof params.next==='string'?params.next:typeof params.callbackUrl==='string'?params.callbackUrl:null;
  redirect('/sign-in'+(next?'?next='+encodeURIComponent(safeWorkspacePath(next)) : ''));
}
