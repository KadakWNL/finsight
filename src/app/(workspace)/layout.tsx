import { AppShell } from '@/components/workspace/app-shell';
import { currentPageUser } from '@/server/page-auth';

export default async function WorkspaceLayout({children}:{children:React.ReactNode}) {
  const user=await currentPageUser();
  // Each page guards its own URL so anonymous deep links survive sign-in.
  if(!user) return children;
  return <AppShell initialUser={{displayName:user.displayName,role:user.role}}>{children}</AppShell>;
}
