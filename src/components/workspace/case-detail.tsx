'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatTime, type HumanRole } from '@/lib/workspace';
import type { CaseDetail, CaseEventItem } from '@/lib/case-types';
import { useApi } from './use-api';
import { EmptyState, ErrorState, LoadingState, PageHeading, PriorityBadge, StatusBadge } from './ui';
import { RecordIdentifier } from './record-identifier';
import {
  DismissCaseDialog,
  EscalateCaseDialog,
  ReopenCaseDialog,
  ResolveCaseDialog,
  ReturnToReviewDialog,
  StartReviewDialog,
} from './case-dialogs';

interface CaseDetailScreenProps {
  id: string;
  returnTo: string;
  role: HumanRole;
  userId: string;
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="facts">
      {rows.map(([label, value]) => (
        <div className="fact-pair" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EventDiff({ event }: { event: CaseEventItem }) {
  if (event.event_type === 'created') {
    const to = event.to_state;
    return (
      <div className="event-diff-grid">
        <div className="diff-item">
          <strong>status:</strong> <ins>{String(to.status ?? 'open')}</ins>
        </div>
        <div className="diff-item">
          <strong>priority:</strong> <ins>{String(to.priority ?? 'medium')}</ins>
        </div>
        <div className="diff-item">
          <strong>assigned:</strong> <ins>unassigned</ins>
        </div>
      </div>
    );
  }

  const from = event.from_state ?? {};
  const to = event.to_state ?? {};
  const allKeys = Array.from(new Set([...Object.keys(from), ...Object.keys(to)]));

  const changes = allKeys.filter((k) => JSON.stringify(from[k]) !== JSON.stringify(to[k]));
  if (changes.length === 0) {
    return <span className="muted">No state attribute changes recorded.</span>;
  }

  return (
    <div className="event-diff-grid">
      {changes.map((key) => {
        const oldVal = from[key] === null ? 'null' : from[key] === undefined ? 'none' : String(from[key]);
        const newVal = to[key] === null ? 'null' : to[key] === undefined ? 'none' : String(to[key]);
        return (
          <div className="diff-item" key={key}>
            <strong>{key}:</strong> <del>{oldVal}</del> &rarr; <ins>{newVal}</ins>
          </div>
        );
      })}
    </div>
  );
}

export function CaseDetailScreen({ id, returnTo, role, userId }: CaseDetailScreenProps) {
  const [historyOffset, setHistoryOffset] = useState(0);
  const historyUrl = '/api/v1/cases/' + encodeURIComponent(id) + '/events?limit=50&offset=' + historyOffset;
  const detailApi = useApi<{ data: CaseDetail; request_id: string }>('/api/v1/cases/' + encodeURIComponent(id));
  const eventsApi = useApi<{ data: CaseEventItem[]; request_id: string }>(historyUrl);

  const caseData = detailApi.loadedUrl === '/api/v1/cases/' + encodeURIComponent(id) ? detailApi.data?.data : undefined;
  const eventsData =
    eventsApi.loadedUrl === historyUrl ? eventsApi.data?.data : undefined;

  function reloadAll() {
    detailApi.reload();
    eventsApi.reload();
  }

  const currentPath = '/cases/' + id + '?returnTo=' + encodeURIComponent(returnTo);
  const isAssigned = caseData ? caseData.assigned_to_user_id === userId : false;
  const isAdmin = role === 'admin';

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href={returnTo}>&larr; Back to {returnTo.startsWith('/cases') ? 'cases' : 'workspace'}</Link>
        <span aria-current="page">Case {caseData?.case_ref ?? id.slice(0, 8)}</span>
      </nav>

      <PageHeading
        title={caseData ? `Case ${caseData.case_ref}` : 'Investigation Case'}
        description={
          caseData
            ? `Subject transaction ${caseData.transaction_id.slice(0, 8)}… · Version ${caseData.version}`
            : 'Inspect the authorized case detail, lifecycle actions, and recorded audit event history.'
        }
      >
        <RecordIdentifier key={id} kind="case" id={id} />
      </PageHeading>

      {detailApi.error ? (
        <ErrorState {...detailApi.error} returnTo={currentPath} retry={reloadAll} />
      ) : null}

      {detailApi.loading ? <LoadingState label="Loading investigation case detail…" /> : null}

      {caseData && !detailApi.error ? (
        <>
          {/* Summary Banner */}
          <section className="detail-summary" aria-label="Case summary">
            <div>
              <span className="summary-label">Status</span>
              <StatusBadge status={caseData.status} />
              <p className="cell-secondary">Version {caseData.version}</p>
            </div>
            <div>
              <span className="summary-label">Priority</span>
              <PriorityBadge priority={caseData.priority} />
            </div>
            <div>
              <span className="summary-label">Assignment</span>
              <strong>
                {role === 'analyst'
                  ? isAssigned
                    ? 'Assigned to you'
                    : 'Unassigned'
                  : isAssigned
                    ? 'Assigned to you (admin)'
                    : caseData.assigned_to_user_id
                      ? `User ${caseData.assigned_to_user_id.slice(0, 8)}…`
                      : 'Unassigned'}
              </strong>
              <p className="cell-secondary">Opened {formatTime(caseData.opened_at)} UTC</p>
            </div>
            {caseData.due_at ? (
              <div>
                <span className="summary-label">Due date</span>
                <strong>{formatTime(caseData.due_at)} UTC</strong>
              </div>
            ) : null}
            {caseData.closed_at ? (
              <div>
                <span className="summary-label">Closed at</span>
                <strong>{formatTime(caseData.closed_at)} UTC</strong>
                <p className="cell-secondary">{caseData.resolution_code ?? 'None'}</p>
              </div>
            ) : null}
          </section>

          <div className="detail-grid">
            <div>
              {/* Main Case Facts */}
              <section className="work-panel" aria-labelledby="case-record-heading">
                <div className="panel-heading">
                  <div>
                    <h2 id="case-record-heading">Case Record</h2>
                    <p>Core metadata and subject financial link.</p>
                  </div>
                </div>
                <div className="panel-content">
                  <Facts
                    rows={[
                      ['Case Reference', <strong>{caseData.case_ref}</strong>],
                      ['Case UUID', <code>{caseData.case_id}</code>],
                      [
                        'Subject Transaction',
                        <div key="subject-tx">
                          <Link
                            className="transaction-link"
                            href={'/transactions/' + caseData.transaction_id + '?returnTo=' + encodeURIComponent(currentPath)}
                          >
                            <code>{caseData.transaction_id}</code>
                          </Link>
                        </div>,
                      ],
                      ['Status', <StatusBadge key="status" status={caseData.status} />],
                      ['Priority', <PriorityBadge key="priority" priority={caseData.priority} />],
                      [
                        'Assignee',
                        caseData.assigned_to_user_id ? (
                          isAssigned ? (
                            'You'
                          ) : (
                            <code>{caseData.assigned_to_user_id}</code>
                          )
                        ) : (
                          'Unassigned'
                        ),
                      ],
                      ['Opened (UTC)', formatTime(caseData.opened_at)],
                      ['Due (UTC)', caseData.due_at ? formatTime(caseData.due_at) : 'No due date set'],
                      ['Updated (UTC)', formatTime(caseData.updated_at)],
                      ['Closed (UTC)', caseData.closed_at ? formatTime(caseData.closed_at) : 'Active / not closed'],
                      [
                        'Resolution Code',
                        caseData.resolution_code ? <code>{caseData.resolution_code}</code> : 'None',
                      ],
                      [
                        'Resolution Notes',
                        caseData.resolution_notes ? (
                          <div className="event-reason-box" key="notes">
                            {caseData.resolution_notes}
                          </div>
                        ) : (
                          'None'
                        ),
                      ],
                    ]}
                  />
                </div>
              </section>

              {/* Event History Section */}
              <section className="work-panel" aria-labelledby="history-heading" style={{ marginTop: '24px' }}>
                <div className="panel-heading">
                  <div>
                    <h2 id="history-heading">Audit Event History</h2>
                    <p>Chronological sequence of immutable operational events.</p>
                  </div>
                  <span className="muted">Read-only audit log</span>
                </div>
                <div className="panel-content">
                  {eventsApi.error ? (
                    <ErrorState {...eventsApi.error} returnTo={currentPath} retry={eventsApi.reload} />
                  ) : null}

                  {eventsApi.loading ? <LoadingState label="Loading audit history…" /> : null}

                  {eventsData && !eventsApi.loading ? (
                    eventsData.length === 0 ? (
                      <EmptyState title="No recorded events">
                        <p>No audit events were returned for this case.</p>
                      </EmptyState>
                    ) : (
                      <div className="event-timeline" role="feed" aria-label="Case event timeline">
                        {eventsData.map((event) => {
                          const isCreated = event.event_type === 'created';
                          const isAssignedEvent = event.event_type === 'assigned';
                          const isStatus = event.event_type === 'status_change';

                          const title = isCreated
                            ? 'Case opened'
                            : isAssignedEvent
                              ? 'Case assigned'
                              : isStatus
                                ? `Status: ${String(event.from_state?.status ?? 'unknown')} → ${String(
                                    event.to_state.status
                                  )}`
                                : event.event_type;

                          return (
                            <article className="event-card" key={event.event_id} aria-labelledby={`event-${event.event_id}`}>
                              <div className="event-header">
                                <div>
                                  <h3 id={`event-${event.event_id}`}>{title}</h3>
                                  <div className="event-meta">
                                    <span>#{event.event_ordinal}</span>
                                    <span>{formatTime(event.occurred_at)} UTC</span>
                                    <span>
                                      Actor: {event.actor_user_id === userId ? 'You' : `${event.actor_user_id.slice(0, 8)}…`}
                                    </span>
                                  </div>
                                </div>
                                <span className="status-label">{event.event_type}</span>
                              </div>

                              <div className="event-sections">
                                {/* 1. Field Changes */}
                                <div className="event-region">
                                  <div className="event-region-title">Field changes</div>
                                  <EventDiff event={event} />
                                </div>

                                {/* 2. Operational Reason */}
                                <div className="event-region">
                                  <div className="event-region-title">Operational reason</div>
                                  {event.reason ? (
                                    <div className="event-reason-box">{event.reason}</div>
                                  ) : (
                                    <p className="muted">No operational note recorded for this transition.</p>
                                  )}
                                </div>

                                {/* 3. Evidence Reference */}
                                <div className="event-region">
                                  <div className="event-region-title">Evidence reference</div>
                                  <p style={{ margin: '4px 0', fontSize: '13px' }}>
                                    Subject Transaction:{' '}
                                    <Link
                                      className="transaction-link"
                                      href={'/transactions/' + caseData.transaction_id + '?returnTo=' + encodeURIComponent(currentPath)}
                                    >
                                      <code>{caseData.transaction_id}</code>
                                    </Link>
                                  </p>
                                  <p className="muted" style={{ margin: '2px 0', fontSize: '12px' }}>
                                    Operation ID: <code>{event.operation_id}</code>
                                  </p>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )
                  ) : null}
                  <div className="pagination">
                    <p>History offset {historyOffset}</p>
                    <div className="action-row">
                      <Button type="button" className="secondary" disabled={historyOffset === 0 || eventsApi.loading}
                        onClick={() => setHistoryOffset(value => Math.max(0, value - 50))}>
                        Previous events
                      </Button>
                      <Button type="button" className="secondary" disabled={eventsApi.loading || !eventsData || eventsData.length < 50}
                        onClick={() => setHistoryOffset(value => value + 50)}>
                        Next events
                      </Button>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {/* Sidebar: Lifecycle Actions & Context */}
            <aside>
              <section className="work-panel" aria-labelledby="actions-heading">
                <div className="panel-heading">
                  <div>
                    <h2 id="actions-heading">Lifecycle Actions</h2>
                    <p>Current version: {caseData.version}</p>
                  </div>
                </div>
                <div className="panel-content">
                  {/* Action controls based on status and role */}
                  {caseData.status === 'open' ? (
                    isAdmin || isAssigned ? (
                      <div className="case-actions-bar" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
                        <StartReviewDialog
                          caseData={caseData}
                          onSuccess={reloadAll}
                          onRefresh={reloadAll}
                        />
                      </div>
                    ) : (
                      <p className="muted">Only the assigned analyst or an admin can start review.</p>
                    )
                  ) : null}

                  {caseData.status === 'in_review' ? (
                    isAdmin || isAssigned ? (
                      <div
                        className="case-actions-bar"
                        style={{ marginTop: 0, paddingTop: 0, borderTop: 0, flexDirection: 'column', alignItems: 'stretch' }}
                      >
                        <EscalateCaseDialog
                          caseData={caseData}
                          onSuccess={reloadAll}
                          onRefresh={reloadAll}
                        />
                        <ResolveCaseDialog
                          caseData={caseData}
                          onSuccess={reloadAll}
                          onRefresh={reloadAll}
                        />
                        <DismissCaseDialog
                          caseData={caseData}
                          onSuccess={reloadAll}
                          onRefresh={reloadAll}
                        />
                      </div>
                    ) : (
                      <p className="muted">Only the assigned analyst or an admin can progress this case.</p>
                    )
                  ) : null}

                  {caseData.status === 'escalated' ? (
                    isAdmin ? (
                      <div
                        className="case-actions-bar"
                        style={{ marginTop: 0, paddingTop: 0, borderTop: 0, flexDirection: 'column', alignItems: 'stretch' }}
                      >
                        <ReturnToReviewDialog
                          caseData={caseData}
                          onSuccess={reloadAll}
                          onRefresh={reloadAll}
                        />
                        <ResolveCaseDialog
                          caseData={caseData}
                          onSuccess={reloadAll}
                          onRefresh={reloadAll}
                        />
                        <DismissCaseDialog
                          caseData={caseData}
                          onSuccess={reloadAll}
                          onRefresh={reloadAll}
                        />
                      </div>
                    ) : (
                      <div className="notice" role="status">
                        This case is escalated to administration. Actions are reserved for administrators until returned to review.
                      </div>
                    )
                  ) : null}

                  {caseData.status === 'closed' || caseData.status === 'dismissed' ? (
                    isAdmin ? (
                      <div className="case-actions-bar" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
                        <ReopenCaseDialog
                          caseData={caseData}
                          onSuccess={reloadAll}
                          onRefresh={reloadAll}
                        />
                      </div>
                    ) : (
                      <div className="notice" role="status">
                        This case is {caseData.status}. Terminal cases can only be reopened by an administrator.
                      </div>
                    )
                  ) : null}
                </div>
              </section>

              <section className="work-panel" aria-labelledby="quick-links" style={{ marginTop: '24px' }}>
                <div className="panel-heading">
                  <h2 id="quick-links">Related Links</h2>
                </div>
                <div className="panel-content">
                  <p>
                    <Link
                      className="transaction-link"
                      href={'/transactions/' + caseData.transaction_id + '?returnTo=' + encodeURIComponent(currentPath)}
                    >
                      &rarr; View subject transaction
                    </Link>
                  </p>
                  <p>
                    <Link className="transaction-link" href={returnTo}>
                      &rarr; Return to cases queue
                    </Link>
                  </p>
                </div>
              </section>
            </aside>
          </div>
        </>
      ) : null}
    </>
  );
}
