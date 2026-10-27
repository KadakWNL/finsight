import { OverviewScreen } from '@/components/workspace/overview-screen';
import { requirePageUser } from '@/server/page-auth';
export default async function AdminPage() {
  await requirePageUser('/admin','admin');
  return <OverviewScreen admin/>;
}
