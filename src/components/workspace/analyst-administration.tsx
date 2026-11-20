'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/lib/workspace';
import type { AnalystAccount } from '@/lib/identity-types';
import { EmptyState, ErrorState, LoadingState } from './ui';
import { useApi } from './use-api';
import { useDisplayPreferences } from './display-preferences';

type DialogMode = 'create' | 'deactivate' | 'reactivate' | 'reset_password';

interface AnalystList {
  data: AnalystAccount[];
  request_id: string;
}

const emptyForm = { email: '', displayName: '', password: '', reason: '' };

export function AnalystAdministration() {
  const { timeZone } = useDisplayPreferences();
  const list = useApi<AnalystList>('/api/v1/users');
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<DialogMode>('create');
  const [target, setTarget] = useState<AnalystAccount | null>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');

  function openDialog(nextMode: DialogMode, account: AnalystAccount | null = null) {
    setMode(nextMode);
    setTarget(account);
    setFormError('');
    dialog.current?.showModal();
  }

  function closeDialog() {
    if (pending) return;
    dialog.current?.close();
    setFormError('');
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const reason = String(form.get('reason') ?? '').trim();

    let url = '/api/v1/users';
    let method = 'POST';
    let body: Record<string, unknown>;
    if (mode === 'create') {
      body = { email: String(form.get('email') ?? ''), display_name: String(form.get('display_name') ?? ''), password };
    } else {
      if (!target) return;
      url += '/' + encodeURIComponent(target.user_id);
      method = 'PATCH';
      body = mode === 'deactivate'
        ? { action: 'deactivate', ...(reason ? { reason } : {}) }
        : { action: mode, password };
    }

    setPending(true);
    setFormError('');
    try {
      const response = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = response.status === 401
          ? 'Your session ended. Sign in again, then retry.'
          : payload?.error?.message ?? 'The account change could not be completed.';
        setFormError(message);
        return;
      }

      if (mode === 'create') {
        setNotice(`Analyst account ${payload?.data?.email ?? 'created'} is ready to sign in.`);
      } else if (mode === 'deactivate') {
        const count = Number(payload?.data?.unassigned_case_count ?? 0);
        setNotice(`Account deactivated. ${count} active case${count === 1 ? '' : 's'} unassigned.`);
      } else if (mode === 'reactivate') {
        setNotice('Account reactivated with the new password. Existing sessions were revoked.');
      } else {
        setNotice('Password reset. The analyst must sign in again.');
      }
      dialog.current?.close();
      list.reload();
    } catch {
      setFormError('Check your connection, then retry. No account change was saved.');
    } finally {
      setPending(false);
    }
  }

  const title = mode === 'create'
    ? 'Add analyst'
    : mode === 'deactivate'
      ? `Deactivate ${target?.display_name ?? 'analyst'}`
      : mode === 'reactivate'
        ? `Reactivate ${target?.display_name ?? 'analyst'}`
        : `Reset password for ${target?.display_name ?? 'analyst'}`;

  return (
    <>
      <section className="work-panel" aria-labelledby="analyst-accounts-heading">
        <div className="panel-heading">
          <div>
            <h2 id="analyst-accounts-heading">Analyst accounts</h2>
            <p>Create credentials, deactivate access and reset passwords. Administrators cannot be managed here.</p>
          </div>
          <Button onClick={() => openDialog('create')}>Add analyst</Button>
        </div>

        <div className="panel-content">
          {notice ? (
            <div className="notice" role="status">
              <p>{notice}</p>
              <div className="action-row"><Button className="secondary" onClick={() => setNotice('')}>Dismiss</Button></div>
            </div>
          ) : null}

          {list.error ? (
            <ErrorState {...list.error} returnTo="/admin/users" retry={list.reload} />
          ) : null}
        </div>

        {list.loading ? <LoadingState label="Loading analyst accounts…" /> : null}

        {list.data && !list.loading ? (
          list.data.data.length === 0 ? (
            <EmptyState title="No analyst accounts">
              <p>Add the first analyst to let them sign in and investigate transactions.</p>
            </EmptyState>
          ) : (
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Analyst accounts">
              <table className="work-table">
                <caption className="sr-only">Analyst accounts with status, active case count and management actions</caption>
                <thead>
                  <tr>
                    <th scope="col">Analyst</th>
                    <th scope="col">Status</th>
                    <th scope="col">Active cases</th>
                    <th scope="col">Created ({timeZone})</th>
                    <th scope="col">Last sign-in ({timeZone})</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.data.map(account => (
                    <tr key={account.user_id}>
                      <td>
                        <strong>{account.display_name}</strong>
                        <span className="cell-secondary identifier">{account.email}</span>
                      </td>
                      <td>
                        <span className={`status-badge ${account.is_active ? 'account-active' : 'account-inactive'}`}>
                          <span className="status-dot" aria-hidden="true" />
                          {account.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>{account.active_case_count}</td>
                      <td>{formatTime(account.created_at, timeZone)}</td>
                      <td>{formatTime(account.last_login_at, timeZone)}</td>
                      <td>
                        <div className="account-actions">
                          {account.is_active ? (
                            <>
                              <Button className="secondary" onClick={() => openDialog('reset_password', account)}>Reset password</Button>
                              <Button className="secondary" onClick={() => openDialog('deactivate', account)}>Deactivate</Button>
                            </>
                          ) : (
                            <Button className="secondary" onClick={() => openDialog('reactivate', account)}>Reactivate</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </section>

      <dialog ref={dialog} aria-labelledby="analyst-dialog-title" onCancel={event => { event.preventDefault(); closeDialog(); }}>
        <div className="dialog-heading">
          <h2 id="analyst-dialog-title">{title}</h2>
          <button className="dialog-close" aria-label="Close account form" disabled={pending} onClick={closeDialog}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </div>

        <form className="dialog-form" onSubmit={submit} aria-busy={pending}>
          {mode === 'create' ? (
            <>
              <p>Create an analyst login. Share the initial password out-of-band; an administrator can reset it later.</p>
              <label htmlFor="analyst-email">Email address</label>
              <input id="analyst-email" name="email" type="email" autoComplete="off" required maxLength={320} defaultValue={emptyForm.email} />
              <label htmlFor="analyst-name">Display name</label>
              <input id="analyst-name" name="display_name" required maxLength={200} defaultValue={emptyForm.displayName} />
              <label htmlFor="analyst-password">Initial password</label>
              <PasswordField id="analyst-password" name="password" help="At least 12 characters. The administrator must share it privately." />
            </>
          ) : null}

          {mode === 'deactivate' ? (
            <>
              <div className="notice notice-error">
                <p><strong>This immediately blocks sign-in</strong> and revokes active sessions.</p>
                <p>
                  {target?.active_case_count
                    ? `${target.active_case_count} active case${target.active_case_count === 1 ? '' : 's'} assigned to this analyst will be unassigned. Each case keeps an audit event.`
                    : 'This analyst has no active cases.'}
                </p>
              </div>
              <label htmlFor="analyst-reason">Reason (optional)</label>
              <textarea id="analyst-reason" name="reason" rows={3} maxLength={500} />
            </>
          ) : null}

          {mode === 'reactivate' ? (
            <>
              <p>Reactivation requires a new password. The previous password will not work.</p>
              <label htmlFor="analyst-password">New password</label>
              <PasswordField id="analyst-password" name="password" help="At least 12 characters." />
            </>
          ) : null}

          {mode === 'reset_password' ? (
            <>
              <p>Set a new password. All of this analyst&apos;s sessions are revoked, so they must sign in again.</p>
              <label htmlFor="analyst-password">New password</label>
              <PasswordField id="analyst-password" name="password" help="At least 12 characters." />
            </>
          ) : null}

          {formError ? <p className="field-alert" role="alert">{formError}</p> : null}

          <div className="action-row">
            <Button type="button" className="secondary" disabled={pending} onClick={closeDialog}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : mode === 'create' ? 'Create account' : mode === 'deactivate' ? 'Deactivate account' : mode === 'reactivate' ? 'Reactivate account' : 'Reset password'}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function PasswordField({ id, name, help }: { id: string; name: string; help: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <div className="password-input">
        <input id={id} name={name} type={visible ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={1024} aria-describedby={id + '-help'} />
        <button type="button" className="password-toggle" aria-pressed={visible} onClick={() => setVisible(value => !value)}>
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      <p className="settings-help" id={id + '-help'}>{help}</p>
    </>
  );
}
