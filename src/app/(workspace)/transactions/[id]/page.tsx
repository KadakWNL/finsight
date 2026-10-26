import { TransactionDetailScreen } from '@/components/workspace/transaction-detail';
import { safeWorkspacePath } from '@/lib/workspace';
import { requirePageUser } from '@/server/page-auth';
export default async function TransactionPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {id}=await params;const search=await searchParams;
  const returnTo=safeWorkspacePath(typeof search.returnTo==='string'?search.returnTo:null);
  const user=await requirePageUser('/transactions/'+id+'?returnTo='+encodeURIComponent(returnTo));
  return <TransactionDetailScreen id={id} returnTo={returnTo} role={user.role}/>;
}
