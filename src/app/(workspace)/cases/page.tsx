import { requirePageUser } from '@/server/page-auth';
import { CaseQueueScreen } from '@/components/workspace/case-queue';

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const values = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') params.set(key, value);
  }
  const user = await requirePageUser('/cases' + (params.size ? '?' + params.toString() : ''));
  return <CaseQueueScreen role={user.role} userId={user.userId} displayName={user.displayName} />;
}
