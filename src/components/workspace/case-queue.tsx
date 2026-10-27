'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatTime, type HumanRole } from '@/lib/workspace';
import type { CaseListPage, CasePriority, CaseStatus, CaseSummaryItem } from '@/lib/case-types';
import { useApi } from './use-api';
import { EmptyState, ErrorState, LoadingState, PageHeading, PriorityBadge, StatusBadge } from './ui';

interface CaseQueueScreenProps {
  role: HumanRole;
  userId: string;
  displayName: string;
}

export function CaseQueueScreen({ role, userId }: CaseQueueScreenProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const requestedTab = searchParams.get('tab');
  const tabs = role === 'analyst' ? ['mine', 'unassigned', 'all'] : ['all', 'unassigned', 'escalated'];
  const tab = requestedTab && tabs.includes(requestedTab) ? requestedTab : tabs[0];
  const statusFilter = searchParams.get('status') ?? '';
  const priorityFilter = searchParams.get('priority') ?? '';
  const requestedSize = searchParams.get('page_size') ?? '25';
  const pageSize = ['25', '50', '100'].includes(requestedSize) ? requestedSize : '25';
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) || 0);

  // Apply tab scope before server pagination so matching rows cannot be skipped.
  const apiParams = new URLSearchParams();
  if (tab === 'mine' || tab === 'unassigned') apiParams.set('scope', tab);
  if (statusFilter && ['open', 'in_review', 'escalated', 'closed', 'dismissed'].includes(statusFilter)) {
    apiParams.set('status', statusFilter);
  }
  if (priorityFilter && ['low', 'medium', 'high'].includes(priorityFilter)) {
    apiParams.set('priority', priorityFilter);
  }
  if (tab === 'escalated') apiParams.set('status', 'escalated');
  apiParams.set('page_size', pageSize);
  if (offset > 0) {
    apiParams.set('offset', String(offset));
  }

  const search = searchParams.toString();
  const currentPath = '/cases' + (search ? '?' + search : '');
  const apiUrl = '/api/v1/cases' + (apiParams.size ? '?' + apiParams.toString() : '');
  const result = useApi<CaseListPage>(apiUrl);

  function navigate(newParams: URLSearchParams) {
    router.push('/cases' + (newParams.size ? '?' + newParams.toString() : ''), { scroll: false });
  }

  function setTab(newTab: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', newTab);
    params.delete('offset'); // reset pagination on tab switch
    navigate(params);
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const params = new URLSearchParams(searchParams.toString());

    const statusVal = formData.get('status')?.toString().trim();
    if (statusVal) params.set('status', statusVal);
    else params.delete('status');

    const priorityVal = formData.get('priority')?.toString().trim();
    if (priorityVal) params.set('priority', priorityVal);
    else params.delete('priority');

    const sizeVal = formData.get('page_size')?.toString().trim();
    if (sizeVal && sizeVal !== '25') params.set('page_size', sizeVal);
    else params.delete('page_size');

    params.delete('offset');
    navigate(params);
  }

  function resetFilters() {
    const params = new URLSearchParams();
    if (tab) params.set('tab', tab);
    navigate(params);
  }

  // The server scopes rows before applying the page limit.
  const allCases: CaseSummaryItem[] = result.data?.data ?? [];
  const displayedCases = allCases;

  const hasFilterApplied = Boolean(statusFilter || priorityFilter || (tab !== (role === 'analyst' ? 'mine' : 'all')));
  const limitNum = parseInt(pageSize, 10) || 25;
  const hasMore = allCases.length >= limitNum;

  return (
    <>
      <PageHeading
        title="Investigation Cases"
        description="Review assigned queue work, inspect evidence timelines, and execute lifecycle state transitions."
      />

      <nav className="tab-row" aria-label="Investigation tabs">
        {role === 'analyst' ? (
          <>
            <button
              type="button"
              className="tab-button"
              aria-pressed={tab === 'mine'}
              onClick={() => setTab('mine')}
            >
              Assigned to me
            </button>
            <button
              type="button"
              className="tab-button"
              aria-pressed={tab === 'unassigned'}
              onClick={() => setTab('unassigned')}
            >
              Unassigned summaries
            </button>
            <button
              type="button"
              className="tab-button"
              aria-pressed={tab === 'all'}
              onClick={() => setTab('all')}
            >
              All permitted
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="tab-button"
              aria-pressed={tab === 'all'}
              onClick={() => setTab('all')}
            >
              All cases
            </button>
            <button
              type="button"
              className="tab-button"
              aria-pressed={tab === 'unassigned'}
              onClick={() => setTab('unassigned')}
            >
              Unassigned
            </button>
            <button
              type="button"
              className="tab-button"
              aria-pressed={tab === 'escalated'}
              onClick={() => setTab('escalated')}
            >
              Escalated
            </button>
          </>
        )}
      </nav>

      <form key={search} className="filter-panel" onSubmit={applyFilters}>
        <fieldset>
          <legend>Filter cases</legend>
          <div className="filter-grid">
            <div>
              <label htmlFor="filter-status">Status</label>
              <select id="filter-status" name="status" defaultValue={tab === 'escalated' ? 'escalated' : statusFilter} disabled={tab === 'escalated'}>
                <option value="">All statuses</option>
                <option value="open">Open</option>
                <option value="in_review">In review</option>
                <option value="escalated">Escalated</option>
                <option value="closed">Closed (confirmed)</option>
                <option value="dismissed">Dismissed</option>
              </select>
            </div>
            <div>
              <label htmlFor="filter-priority">Priority</label>
              <select id="filter-priority" name="priority" defaultValue={priorityFilter}>
                <option value="">All priorities</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label htmlFor="filter-page-size">Page size</label>
              <select id="filter-page-size" name="page_size" defaultValue={pageSize}>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>
          <div className="filter-actions">
            <div className="action-row">
              <Button type="submit" disabled={result.loading}>
                Apply filters
              </Button>
              <Button type="button" className="secondary" onClick={resetFilters}>
                Reset
              </Button>
            </div>
          </div>
        </fieldset>
      </form>

      {result.error ? (
        <ErrorState
          status={result.error.status}
          message={result.error.message}
          returnTo={currentPath}
          retry={result.reload}
        />
      ) : null}

      <section className="work-panel" aria-busy={result.loading} aria-label="Investigation queue">
        <div className="panel-heading">
          <div>
            <h2>
              {role === 'analyst'
                ? tab === 'mine'
                  ? 'Your active cases'
                  : tab === 'unassigned'
                    ? 'Unassigned case summaries'
                    : 'Permitted cases'
                : tab === 'unassigned'
                  ? 'Unassigned team cases'
                  : tab === 'escalated'
                    ? 'Escalated cases'
                    : 'All team cases'}
            </h2>
            <p>Ordered by opened timestamp (newest first).</p>
          </div>
        </div>

        {result.loading ? <LoadingState label="Loading investigation queue…" /> : null}

        {result.data && !result.loading ? (
          displayedCases.length === 0 ? (
            <EmptyState
              title={
                hasFilterApplied
                  ? 'No cases match these filters'
                  : tab === 'mine'
                    ? 'No cases currently assigned to you'
                    : 'No cases found'
              }
            >
              <p>
                {hasFilterApplied
                  ? 'Reset or adjust the filters to broaden your search.'
                  : 'New cases appear when created from transaction evidence or assigned.'}
              </p>
            </EmptyState>
          ) : (
            <>
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Investigation cases">
                <table className="work-table">
                  <caption className="sr-only">Investigation cases</caption>
                  <thead>
                    <tr>
                      <th scope="col">Case ref</th>
                      <th scope="col">Status</th>
                      <th scope="col">Priority</th>
                      <th scope="col">Subject transaction</th>
                      <th scope="col">Assignee</th>
                      <th scope="col">Due (UTC)</th>
                      <th scope="col">Opened (UTC)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedCases.map((row) => (
                      <tr key={row.case_id ?? row.case_ref}>
                        <td>
                          {row.case_id ? (
                            <Link
                              className="transaction-link"
                              href={'/cases/' + row.case_id + '?returnTo=' + encodeURIComponent(currentPath)}
                            >
                              <strong>{row.case_ref}</strong>
                            </Link>
                          ) : (
                            <span>
                              <strong>{row.case_ref}</strong>
                              <span className="cell-secondary">Unassigned summary</span>
                            </span>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={row.status as CaseStatus} />
                        </td>
                        <td>
                          <PriorityBadge priority={row.priority as CasePriority} />
                        </td>
                        <td>
                          <Link
                            className="transaction-link"
                            href={'/transactions/' + row.transaction_id + '?returnTo=' + encodeURIComponent(currentPath)}
                          >
                            <code>{row.transaction_id.slice(0, 8)}…</code>
                          </Link>
                        </td>
                        <td>
                          {role === 'analyst' ? (
                            row.assigned_to_user_id === userId ? (
                              <strong>You</strong>
                            ) : (
                              <span className="muted">Unassigned</span>
                            )
                          ) : row.assigned_to_user_id === userId ? (
                            <strong>You (admin)</strong>
                          ) : row.assigned_to_user_id ? (
                            <code className="muted">{row.assigned_to_user_id.slice(0, 8)}…</code>
                          ) : (
                            <span className="muted">Unassigned</span>
                          )}
                        </td>
                        <td>{row.due_at ? formatTime(row.due_at) : '—'}</td>
                        <td>{row.opened_at ? formatTime(row.opened_at) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        ) : null}
        {result.data && !result.loading ? (
              <div className="pagination">
                <p>
                  Showing {displayedCases.length} case{displayedCases.length === 1 ? '' : 's'} on this page (offset {offset}).
                </p>
                <div className="action-row">
                  <Button
                    type="button"
                    className="secondary"
                    disabled={offset <= 0 || result.loading}
                    onClick={() => {
                      const params = new URLSearchParams(searchParams.toString());
                      const prevOffset = Math.max(0, offset - limitNum);
                      if (prevOffset > 0) params.set('offset', String(prevOffset));
                      else params.delete('offset');
                      navigate(params);
                    }}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    className="secondary"
                    disabled={!hasMore || result.loading}
                    onClick={() => {
                      const params = new URLSearchParams(searchParams.toString());
                      params.set('offset', String(offset + limitNum));
                      navigate(params);
                    }}
                  >
                    Next
                  </Button>
                </div>
              </div>
        ) : null}
      </section>
    </>
  );
}
