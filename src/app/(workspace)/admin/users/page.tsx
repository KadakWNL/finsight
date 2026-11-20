import { AnalystAdministration } from '@/components/workspace/analyst-administration';
import { PageHeading } from '@/components/workspace/ui';
import { requirePageUser } from '@/server/page-auth';

export default async function AdminUsersPage() {
  await requirePageUser('/admin/users', 'admin');
  return (
    <>
      <PageHeading
        title="Analyst accounts"
        description="Create credentials, deactivate access and reset passwords for analysts."
      />
      <AnalystAdministration />
    </>
  );
}
