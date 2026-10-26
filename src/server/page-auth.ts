import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticateRequest } from './authentication';
import { safeWorkspacePath } from '@/lib/workspace';
import type { HumanRole } from '@/lib/workspace';

export async function currentPageUser() {
  const inbound = await headers();
  const validation = await authenticateRequest(new Request('http://page.internal',{headers:inbound}));
  return validation.valid ? validation.user : null;
}
export async function requirePageUser(returnTo:string,role?:HumanRole) {
  const user = await currentPageUser();
  if (!user) redirect('/sign-in?next='+encodeURIComponent(safeWorkspacePath(returnTo)));
  if (role && user.role !== role) redirect('/access-denied');
  return user;
}
