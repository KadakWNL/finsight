'use client';
import { useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { CaseDetail, CaseCommandType, ResolutionCode } from '@/lib/case-types';

interface DialogProps {
  caseData: CaseDetail;
  onSuccess: () => void;
  onRefresh: () => void;
}

async function sendCommand(
  caseId: string,
  payload: {
    action: CaseCommandType;
    expected_version: number;
    idempotency_key: string;
    reason?: string;
    resolution_code?: ResolutionCode;
    resolution_notes?: string;
  }
) {
  const response = await fetch(`/api/v1/cases/${encodeURIComponent(caseId)}/commands`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': payload.idempotency_key,
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

export function StartReviewDialog({ caseData, onSuccess, onRefresh }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const key = useRef('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  function open() {
    if (!key.current) key.current = crypto.randomUUID();
    setError(null);
    dialog.current?.showModal();
  }

  function close() {
    if (!pending) {
      dialog.current?.close();
      trigger.current?.focus();
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!key.current) key.current = crypto.randomUUID();
    setPending(true);
    setError(null);

    const result = await sendCommand(caseData.case_id, {
      action: 'start_review',
      expected_version: caseData.version,
      idempotency_key: key.current,
    });

    setPending(false);
    if (result.ok) {
      close();
      onSuccess();
    } else {
      if (result.status === 409) {
        onRefresh();
        setError({
          status: 409,
          message:
            'A version or state conflict occurred. Case state has been refreshed. Review the current state and retry.',
        });
      } else if (result.status === 401) {
        setError({
          status: 401,
          message: 'Your session ended. Please sign in again in a new tab.',
        });
      } else {
        setError({
          status: result.status,
          message: result.data?.error?.message ?? 'Could not start review. Please try again.',
        });
      }
    }
  }

  return (
    <>
      <Button ref={trigger} onClick={open}>
        Start review
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="start-review-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <div className="dialog-heading">
          <h2 id="start-review-title">Start review</h2>
          <button className="dialog-close" aria-label="Close dialog" disabled={pending} onClick={close}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </button>
        </div>
        <form className="dialog-form" onSubmit={submit} aria-busy={pending}>
          <p>
            Starting review transitions case <strong>{caseData.case_ref}</strong> from <code>open</code> to{' '}
            <code>in_review</code>.
          </p>
          {error ? (
            <div className="notice notice-error" role="alert">
              <p>{error.message}</p>
              {error.status === 401 ? (
                <Link target="_blank" rel="noopener" href={'/sign-in?next=' + encodeURIComponent('/cases/' + caseData.case_id)}>
                  Sign in again in a new tab
                </Link>
              ) : null}
            </div>
          ) : null}
          <div className="action-row">
            <Button type="button" className="secondary" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Starting review…' : 'Confirm start review'}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function EscalateCaseDialog({ caseData, onSuccess, onRefresh }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const key = useRef('');
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  function open() {
    if (!key.current) key.current = crypto.randomUUID();
    setError(null);
    dialog.current?.showModal();
    requestAnimationFrame(() => textarea.current?.focus());
  }

  function close() {
    if (!pending) {
      dialog.current?.close();
      trigger.current?.focus();
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed || trimmed.length > 2000) {
      setError({ status: 400, message: 'Escalation reason must be between 1 and 2,000 characters.' });
      return;
    }
    if (pending) return;
    if (!key.current) key.current = crypto.randomUUID();
    setPending(true);
    setError(null);

    const result = await sendCommand(caseData.case_id, {
      action: 'escalate',
      expected_version: caseData.version,
      idempotency_key: key.current,
      reason: trimmed,
    });

    setPending(false);
    if (result.ok) {
      close();
      onSuccess();
    } else {
      if (result.status === 409) {
        onRefresh();
        key.current = crypto.randomUUID();
        setError({
          status: 409,
          message:
            'A version or state conflict occurred. Case state has been refreshed. Your entered reason draft is preserved below. Review and retry.',
        });
      } else if (result.status === 401) {
        setError({
          status: 401,
          message: 'Your session ended. Please sign in again in a new tab. Your draft is preserved.',
        });
      } else {
        setError({
          status: result.status,
          message: result.data?.error?.message ?? 'Could not escalate case. Please check your rationale.',
        });
      }
    }
  }

  return (
    <>
      <Button ref={trigger} className="secondary" onClick={open}>
        Escalate
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="escalate-case-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <div className="dialog-heading">
          <h2 id="escalate-case-title">Escalate case</h2>
          <button className="dialog-close" aria-label="Close dialog" disabled={pending} onClick={close}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </button>
        </div>
        <form className="dialog-form" onSubmit={submit} aria-busy={pending}>
          <p>
            Escalates case <strong>{caseData.case_ref}</strong> for administrative review. Assignment context is
            retained.
          </p>
          <label htmlFor={reasonId}>Operational escalation reason (required)</label>
          <textarea
            ref={textarea}
            id={reasonId}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            required
            maxLength={2000}
            rows={5}
            disabled={pending}
            aria-describedby="escalate-reason-help"
          />
          <p id="escalate-reason-help" className="muted">
            Provide the investigation rationale for escalation (1 to 2,000 characters). Do not include customer PII or
            passwords.
          </p>
          {error ? (
            <div className="notice notice-error" role="alert">
              <p>{error.message}</p>
              {error.status === 401 ? (
                <Link target="_blank" rel="noopener" href={'/sign-in?next=' + encodeURIComponent('/cases/' + caseData.case_id)}>
                  Sign in again in a new tab
                </Link>
              ) : null}
            </div>
          ) : null}
          <div className="action-row">
            <Button type="button" className="secondary" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Escalating…' : 'Confirm escalation'}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function ReturnToReviewDialog({ caseData, onSuccess, onRefresh }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const key = useRef('');
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  function open() {
    if (!key.current) key.current = crypto.randomUUID();
    setError(null);
    dialog.current?.showModal();
    requestAnimationFrame(() => textarea.current?.focus());
  }

  function close() {
    if (!pending) {
      dialog.current?.close();
      trigger.current?.focus();
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed || trimmed.length > 2000) {
      setError({ status: 400, message: 'Return reason must be between 1 and 2,000 characters.' });
      return;
    }
    if (pending) return;
    if (!key.current) key.current = crypto.randomUUID();
    setPending(true);
    setError(null);

    const result = await sendCommand(caseData.case_id, {
      action: 'return_to_review',
      expected_version: caseData.version,
      idempotency_key: key.current,
      reason: trimmed,
    });

    setPending(false);
    if (result.ok) {
      close();
      onSuccess();
    } else {
      if (result.status === 409) {
        onRefresh();
        key.current = crypto.randomUUID();
        setError({
          status: 409,
          message:
            'A version or state conflict occurred. Case state has been refreshed. Your draft is preserved below.',
        });
      } else if (result.status === 401) {
        setError({
          status: 401,
          message: 'Your session ended. Please sign in again in a new tab. Your draft is preserved.',
        });
      } else {
        setError({
          status: result.status,
          message: result.data?.error?.message ?? 'Could not return case to review.',
        });
      }
    }
  }

  return (
    <>
      <Button ref={trigger} className="secondary" onClick={open}>
        Return to review
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="return-review-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <div className="dialog-heading">
          <h2 id="return-review-title">Return case to review</h2>
          <button className="dialog-close" aria-label="Close dialog" disabled={pending} onClick={close}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </button>
        </div>
        <form className="dialog-form" onSubmit={submit} aria-busy={pending}>
          <p>
            Returns escalated case <strong>{caseData.case_ref}</strong> back to <code>in_review</code> status for the
            assigned analyst.
          </p>
          <label htmlFor={reasonId}>Return rationale (required)</label>
          <textarea
            ref={textarea}
            id={reasonId}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            required
            maxLength={2000}
            rows={5}
            disabled={pending}
            aria-describedby="return-reason-help"
          />
          <p id="return-reason-help" className="muted">
            Explain what additional verification or steps are requested (1 to 2,000 characters).
          </p>
          {error ? (
            <div className="notice notice-error" role="alert">
              <p>{error.message}</p>
              {error.status === 401 ? (
                <Link target="_blank" rel="noopener" href={'/sign-in?next=' + encodeURIComponent('/cases/' + caseData.case_id)}>
                  Sign in again in a new tab
                </Link>
              ) : null}
            </div>
          ) : null}
          <div className="action-row">
            <Button type="button" className="secondary" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Returning…' : 'Confirm return to review'}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function ResolveCaseDialog({ caseData, onSuccess, onRefresh }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const key = useRef('');
  const notesId = useId();
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  function open() {
    if (!key.current) key.current = crypto.randomUUID();
    setError(null);
    dialog.current?.showModal();
    requestAnimationFrame(() => textarea.current?.focus());
  }

  function close() {
    if (!pending) {
      dialog.current?.close();
      trigger.current?.focus();
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = notes.trim();
    if (!trimmed || trimmed.length > 5000) {
      setError({ status: 400, message: 'Resolution notes must be between 1 and 5,000 characters.' });
      return;
    }
    if (pending) return;
    if (!key.current) key.current = crypto.randomUUID();
    setPending(true);
    setError(null);

    const result = await sendCommand(caseData.case_id, {
      action: 'resolve',
      expected_version: caseData.version,
      idempotency_key: key.current,
      resolution_code: 'confirmed_suspicious',
      resolution_notes: trimmed,
    });

    setPending(false);
    if (result.ok) {
      close();
      onSuccess();
    } else {
      if (result.status === 409) {
        onRefresh();
        key.current = crypto.randomUUID();
        setError({
          status: 409,
          message:
            'A version or state conflict occurred. Case state has been refreshed. Your entered resolution notes are preserved below.',
        });
      } else if (result.status === 401) {
        setError({
          status: 401,
          message: 'Your session ended. Please sign in again in a new tab. Your draft is preserved.',
        });
      } else {
        setError({
          status: result.status,
          message: result.data?.error?.message ?? 'Could not resolve case. Please check input requirements.',
        });
      }
    }
  }

  return (
    <>
      <Button ref={trigger} onClick={open}>
        Resolve case
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="resolve-case-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <div className="dialog-heading">
          <h2 id="resolve-case-title">Resolve case (Confirmed Suspicious)</h2>
          <button className="dialog-close" aria-label="Close dialog" disabled={pending} onClick={close}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </button>
        </div>
        <form className="dialog-form" onSubmit={submit} aria-busy={pending}>
          <p>
            Resolving marks case <strong>{caseData.case_ref}</strong> as <strong>closed</strong> with resolution code{' '}
            <code>confirmed_suspicious</code>.
          </p>
          <label htmlFor={notesId}>Resolution notes (required)</label>
          <textarea
            ref={textarea}
            id={notesId}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setError(null);
            }}
            required
            maxLength={5000}
            rows={6}
            disabled={pending}
            aria-describedby="resolve-notes-help"
          />
          <p id="resolve-notes-help" className="muted">
            Document findings and recorded signals supporting this determination (1 to 5,000 characters). This rationale
            becomes permanent audit history.
          </p>
          {error ? (
            <div className="notice notice-error" role="alert">
              <p>{error.message}</p>
              {error.status === 401 ? (
                <Link target="_blank" rel="noopener" href={'/sign-in?next=' + encodeURIComponent('/cases/' + caseData.case_id)}>
                  Sign in again in a new tab
                </Link>
              ) : null}
            </div>
          ) : null}
          <div className="action-row">
            <Button type="button" className="secondary" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Resolving…' : 'Confirm resolution (Closed)'}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function DismissCaseDialog({ caseData, onSuccess, onRefresh }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const key = useRef('');
  const notesId = useId();
  const [code, setCode] = useState<'false_positive' | 'insufficient_evidence'>('false_positive');
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  function open() {
    if (!key.current) key.current = crypto.randomUUID();
    setError(null);
    dialog.current?.showModal();
    requestAnimationFrame(() => textarea.current?.focus());
  }

  function close() {
    if (!pending) {
      dialog.current?.close();
      trigger.current?.focus();
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = notes.trim();
    if (!trimmed || trimmed.length > 5000) {
      setError({ status: 400, message: 'Dismissal notes must be between 1 and 5,000 characters.' });
      return;
    }
    if (pending) return;
    if (!key.current) key.current = crypto.randomUUID();
    setPending(true);
    setError(null);

    const result = await sendCommand(caseData.case_id, {
      action: 'dismiss',
      expected_version: caseData.version,
      idempotency_key: key.current,
      resolution_code: code,
      resolution_notes: trimmed,
    });

    setPending(false);
    if (result.ok) {
      close();
      onSuccess();
    } else {
      if (result.status === 409) {
        onRefresh();
        key.current = crypto.randomUUID();
        setError({
          status: 409,
          message:
            'A version or state conflict occurred. Case state has been refreshed. Your entered dismissal notes are preserved below.',
        });
      } else if (result.status === 401) {
        setError({
          status: 401,
          message: 'Your session ended. Please sign in again in a new tab. Your draft is preserved.',
        });
      } else {
        setError({
          status: result.status,
          message: result.data?.error?.message ?? 'Could not dismiss case. Please check input requirements.',
        });
      }
    }
  }

  return (
    <>
      <Button ref={trigger} className="secondary" onClick={open}>
        Dismiss case
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="dismiss-case-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <div className="dialog-heading">
          <h2 id="dismiss-case-title">Dismiss case</h2>
          <button className="dialog-close" aria-label="Close dialog" disabled={pending} onClick={close}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </button>
        </div>
        <form className="dialog-form" onSubmit={submit} aria-busy={pending}>
          <p>
            Dismissing marks case <strong>{caseData.case_ref}</strong> as <strong>dismissed</strong>. Select the
            disposition:
          </p>
          <fieldset style={{ marginBottom: '16px' }}>
            <legend style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Outcome resolution code</legend>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 400, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="dismiss_code"
                  value="false_positive"
                  checked={code === 'false_positive'}
                  onChange={() => setCode('false_positive')}
                  style={{ width: 'auto', minHeight: 'auto' }}
                  disabled={pending}
                />
                <span>
                  <strong>False positive</strong> — Signals explained as non-actionable or legitimate.
                </span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 400, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="dismiss_code"
                  value="insufficient_evidence"
                  checked={code === 'insufficient_evidence'}
                  onChange={() => setCode('insufficient_evidence')}
                  style={{ width: 'auto', minHeight: 'auto' }}
                  disabled={pending}
                />
                <span>
                  <strong>Insufficient evidence</strong> — Inconclusive; does not mark transaction safe.
                </span>
              </label>
            </div>
          </fieldset>
          <label htmlFor={notesId}>Dismissal rationale notes (required)</label>
          <textarea
            ref={textarea}
            id={notesId}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setError(null);
            }}
            required
            maxLength={5000}
            rows={5}
            disabled={pending}
            aria-describedby="dismiss-notes-help"
          />
          <p id="dismiss-notes-help" className="muted">
            Provide the explanation for closing this investigation without action (1 to 5,000 characters).
          </p>
          {error ? (
            <div className="notice notice-error" role="alert">
              <p>{error.message}</p>
              {error.status === 401 ? (
                <Link target="_blank" rel="noopener" href={'/sign-in?next=' + encodeURIComponent('/cases/' + caseData.case_id)}>
                  Sign in again in a new tab
                </Link>
              ) : null}
            </div>
          ) : null}
          <div className="action-row">
            <Button type="button" className="secondary" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Dismissing…' : 'Confirm dismissal'}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function ReopenCaseDialog({ caseData, onSuccess, onRefresh }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const key = useRef('');
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  function open() {
    if (!key.current) key.current = crypto.randomUUID();
    setError(null);
    dialog.current?.showModal();
    requestAnimationFrame(() => textarea.current?.focus());
  }

  function close() {
    if (!pending) {
      dialog.current?.close();
      trigger.current?.focus();
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed || trimmed.length > 2000) {
      setError({ status: 400, message: 'Reopening reason must be between 1 and 2,000 characters.' });
      return;
    }
    if (pending) return;
    if (!key.current) key.current = crypto.randomUUID();
    setPending(true);
    setError(null);

    const result = await sendCommand(caseData.case_id, {
      action: 'reopen',
      expected_version: caseData.version,
      idempotency_key: key.current,
      reason: trimmed,
    });

    setPending(false);
    if (result.ok) {
      close();
      onSuccess();
    } else {
      if (result.status === 409) {
        onRefresh();
        key.current = crypto.randomUUID();
        setError({
          status: 409,
          message:
            result.data?.error?.code === 'active_case_exists'
              ? 'Cannot reopen: Another active case already exists for this subject transaction.'
              : 'A version or state conflict occurred. Case state has been refreshed. Your entered reason draft is preserved below.',
        });
      } else if (result.status === 401) {
        setError({
          status: 401,
          message: 'Your session ended. Please sign in again in a new tab. Your draft is preserved.',
        });
      } else {
        setError({
          status: result.status,
          message: result.data?.error?.message ?? 'Could not reopen case.',
        });
      }
    }
  }

  return (
    <>
      <Button ref={trigger} onClick={open}>
        Reopen case
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="reopen-case-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <div className="dialog-heading">
          <h2 id="reopen-case-title">Reopen case (Administrator)</h2>
          <button className="dialog-close" aria-label="Close dialog" disabled={pending} onClick={close}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </button>
        </div>
        <form className="dialog-form" onSubmit={submit} aria-busy={pending}>
          <div className="dialog-preview">
            <strong>Reopen reset preview:</strong>
            <ul>
              <li>
                Status will reset to <code>open</code>.
              </li>
              <li>Current resolution code, notes, and closed timestamp will be cleared.</li>
              <li>Due time will be cleared.</li>
              <li>
                Original case reference (<code>{caseData.case_ref}</code>), opened time, and priority are retained.
              </li>
              <li>
                Prior terminal history remains permanently visible in the audit log.
              </li>
              <li>
                {caseData.assigned_to_user_id
                  ? 'Retains active analyst owner, or resets to Unassigned if the user is inactive.'
                  : 'Case remains unassigned.'}
              </li>
            </ul>
          </div>
          <label htmlFor={reasonId}>Reopening operational rationale (required)</label>
          <textarea
            ref={textarea}
            id={reasonId}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            required
            maxLength={2000}
            rows={5}
            disabled={pending}
            aria-describedby="reopen-reason-help"
          />
          <p id="reopen-reason-help" className="muted">
            State the justification for reopening this closed investigation (1 to 2,000 characters).
          </p>
          {error ? (
            <div className="notice notice-error" role="alert">
              <p>{error.message}</p>
              {error.status === 401 ? (
                <Link target="_blank" rel="noopener" href={'/sign-in?next=' + encodeURIComponent('/cases/' + caseData.case_id)}>
                  Sign in again in a new tab
                </Link>
              ) : null}
            </div>
          ) : null}
          <div className="action-row">
            <Button type="button" className="secondary" disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Reopening…' : 'Confirm reopen (Open)'}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
