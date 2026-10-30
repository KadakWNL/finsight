'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/lib/workspace';
import { useDisplayPreferences } from './display-preferences';

interface PreviewData {
  operation_id: string;
  candidate_count: number;
  cutoff_at: string;
  expires_at: string;
  preview_at: string;
}

interface CompletedData {
  operation_id: string;
  status: 'completed';
  candidate_count: number;
  deleted_count: number;
  cutoff_at: string;
  completed_at: string;
  replayed: boolean;
}

export function SessionCleanupPanel() {
  const { timeZone } = useDisplayPreferences();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [completed, setCompleted] = useState<CompletedData | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  async function handlePreview() {
    setLoading(true);
    setError(null);
    setCompleted(null);
    try {
      const response = await fetch('/api/v1/session-cleanups/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error?.message || 'Failed to preview session cleanup.');
      }

      setPreview(body.data);
      setIdempotencyKey(crypto.randomUUID());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to connect to cleanup preview service.';
      setError({ title: 'Preview unavailable', message: msg });
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!preview || !idempotencyKey) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/session-cleanups/${preview.operation_id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          confirm: true,
          idempotency_key: idempotencyKey,
        }),
      });

      const body = await response.json();
      if (!response.ok) {
        if (response.status === 410) {
          throw new Error('This preview has expired (10-minute window passed). Please generate a fresh preview.');
        }
        if (response.status === 409) {
          throw new Error(body.error?.message || 'Idempotency conflict detected. Operation was not modified.');
        }
        throw new Error(body.error?.message || 'Failed to confirm session cleanup.');
      }

      setCompleted(body.data);
      setPreview(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to complete cleanup confirmation.';
      setError({ title: 'Confirmation failed', message: msg });
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    setPreview(null);
    setError(null);
    setIdempotencyKey('');
  }

  function handleReset() {
    setPreview(null);
    setCompleted(null);
    setError(null);
    setIdempotencyKey('');
  }

  return (
    <section className="work-panel" aria-labelledby="session-cleanup-title">
      <div className="panel-heading">
        <div>
          <h2 id="session-cleanup-title">Session cleanup (Admin maintenance)</h2>
          <p>Audited removal of PostgreSQL sessions unusable for more than 7 days.</p>
        </div>
      </div>

      <div className="panel-content">
        <div className="notice" style={{ marginBottom: '1.25rem' }}>
          <h3>7-Day Session Cleanup Policy</h3>
          <p>
            Sessions are eligible for deletion only if unusable for strictly more than seven days.
            Unusability is defined as the earliest of idle expiry, absolute expiry, or revocation.
            Active sessions, recently expired sessions, and exact-cutoff sessions are never deleted.
            Previews are bounded to at most 100 candidates, expire after 10 minutes, and never silently expand on confirmation.
          </p>
        </div>

        {error ? (
          <div className="notice notice-error" role="alert" style={{ marginBottom: '1.25rem' }}>
            <h3>{error.title}</h3>
            <p>{error.message}</p>
            <div className="action-row" style={{ marginTop: '0.75rem' }}>
              <Button className="secondary" onClick={() => setError(null)}>Dismiss</Button>
            </div>
          </div>
        ) : null}

        {completed ? (
          <div className="notice" role="status" style={{ marginBottom: '1.25rem', borderColor: 'var(--primary)' }}>
            <h3>Cleanup operation completed</h3>
            <p>
              {completed.replayed
                ? 'Previously committed cleanup result returned via idempotent replay.'
                : 'Atomic session cleanup and durable audit records were successfully committed.'}
            </p>
            <dl className="facts" style={{ margin: '1rem 0' }}>
              <div className="fact-pair">
                <dt>Deleted count</dt>
                <dd><strong>{completed.deleted_count}</strong> sessions removed</dd>
              </div>
              <div className="fact-pair">
                <dt>Original preview count</dt>
                <dd>{completed.candidate_count} candidates</dd>
              </div>
              <div className="fact-pair">
                <dt>Captured 7-day cutoff</dt>
                <dd>{formatTime(completed.cutoff_at, timeZone)}</dd>
              </div>
              <div className="fact-pair">
                <dt>Completed at</dt>
                <dd>{formatTime(completed.completed_at, timeZone)}</dd>
              </div>
            </dl>
            <Button className="secondary" onClick={handleReset}>Done</Button>
          </div>
        ) : null}

        {!preview && !completed ? (
          <div>
            <p className="muted" style={{ marginBottom: '1rem' }}>
              Inspect expired or revoked session records and generate a time-limited cleanup preview.
            </p>
            <Button disabled={loading} onClick={handlePreview}>
              {loading ? 'Scanning eligible sessions…' : 'Preview eligible sessions'}
            </Button>
          </div>
        ) : null}

        {preview ? (
          <div>
            <h3>Preview results ({preview.candidate_count} eligible)</h3>
            <p className="muted" style={{ marginBottom: '1rem' }}>
              {preview.candidate_count === 0
                ? 'No sessions meet the 7-day cutoff criteria at this time.'
                : 'Review the captured cutoff and candidate summary before confirming deletion.'}
            </p>

            <dl className="facts" style={{ marginBottom: '1.25rem' }}>
              <div className="fact-pair">
                <dt>Candidate count</dt>
                <dd><strong>{preview.candidate_count}</strong> {preview.candidate_count === 100 ? '(capped at 100 maximum)' : 'sessions'}</dd>
              </div>
              <div className="fact-pair">
                <dt>Captured cutoff (7 days ago)</dt>
                <dd>{formatTime(preview.cutoff_at, timeZone)}</dd>
              </div>
              <div className="fact-pair">
                <dt>Preview expires</dt>
                <dd>{formatTime(preview.expires_at, timeZone)} (10-minute validity)</dd>
              </div>
              <div className="fact-pair">
                <dt>Bounded guarantee</dt>
                <dd>Only these previewed candidates can be deleted. Candidates that become newly active or were modified will be preserved.</dd>
              </div>
            </dl>

            <div className="action-row">
              {preview.candidate_count > 0 ? (
                <Button disabled={loading} onClick={handleConfirm}>
                  {loading ? 'Confirming deletion…' : `Confirm deletion of ${preview.candidate_count} session(s)`}
                </Button>
              ) : null}
              <Button className="secondary" disabled={loading} onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
