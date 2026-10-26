import Link from 'next/link';
import { requirePageUser } from '@/server/page-auth';
import { roleHome } from '@/lib/workspace';
export default async function AccessDenied() {
  const user=await requirePageUser('/access-denied');
  return <section className="empty-state"><h1>Access is restricted</h1><p>Your current role does not have access to that page.</p><Link className="button-link" href={roleHome(user.role)}>Return to your overview</Link></section>;
}
