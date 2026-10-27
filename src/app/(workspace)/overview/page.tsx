import { OverviewScreen } from '@/components/workspace/overview-screen';
import { requirePageUser } from '@/server/page-auth';
export default async function OverviewPage() {
  await requirePageUser('/overview','analyst');
  return <OverviewScreen/>;
}
