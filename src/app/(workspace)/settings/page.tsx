import { requirePageUser } from '@/server/page-auth';
import { AppearanceSettings } from '@/components/workspace/theme-switch';
import { PageHeading } from '@/components/workspace/ui';

export default async function SettingsPage() {
  const user = await requirePageUser('/settings');
  return <>
    <PageHeading title="Settings" description="Make the workspace comfortable for you and view your account details."/>
    <div className="settings-content">
      <section className="work-panel" aria-labelledby="appearance-heading">
        <div className="panel-heading"><div><h2 id="appearance-heading">Appearance</h2><p>Choose how FinSight looks on this device.</p></div></div>
        <div className="panel-content"><AppearanceSettings/></div>
      </section>
      <section className="work-panel" aria-labelledby="account-heading">
        <div className="panel-heading"><div><h2 id="account-heading">Account</h2><p>Your signed-in identity and workspace access.</p></div></div>
        <div className="panel-content">
          <dl className="facts">
            <div className="fact-pair"><dt>Name</dt><dd>{user.displayName}</dd></div>
            <div className="fact-pair"><dt>Email</dt><dd>{user.email}</dd></div>
            <div className="fact-pair"><dt>Role</dt><dd>{user.role === 'admin' ? 'Administrator' : 'Analyst'}</dd></div>
            <div className="fact-pair"><dt>Time zone</dt><dd>UTC for all transaction and case timestamps</dd></div>
          </dl>
        </div>
      </section>
    </div>
  </>;
}
