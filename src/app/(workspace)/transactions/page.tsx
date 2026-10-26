import { requirePageUser } from '@/server/page-auth';
import { ExplorerScreen } from '@/components/workspace/explorer';
export default async function TransactionsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const values=await searchParams;const params=new URLSearchParams();
  for(const [key,value] of Object.entries(values)) if(typeof value==='string') params.set(key,value);
  await requirePageUser('/transactions'+(params.size?'?'+params:''));
  return <ExplorerScreen/>;
}
