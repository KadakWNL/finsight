import { notFound } from 'next/navigation';
import { requirePageUser } from '@/server/page-auth';
import { safeWorkspacePath } from '@/lib/workspace';
import { CaseDetailScreen } from '@/components/workspace/case-detail';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!uuidPattern.test(id)) {
    notFound();
  }
  const search = await searchParams;
  const returnTo = safeWorkspacePath(typeof search.returnTo === 'string' ? search.returnTo : null) || '/cases';
  const user = await requirePageUser('/cases/' + id + '?returnTo=' + encodeURIComponent(returnTo));
  return <CaseDetailScreen id={id} returnTo={returnTo} role={user.role} userId={user.userId} />;
}
