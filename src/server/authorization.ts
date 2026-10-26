import 'server-only';
import type { SessionUser } from './session';

export function isSafeRedirect(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  // Must start with '/' but not '//' or '/\'
  if (!url.startsWith('/') || url.startsWith('//') || url.startsWith('/\\')) {
    return false;
  }

  // Reject backslashes anywhere in path
  if (url.includes('\\')) {
    return false;
  }

  // Reject ASCII control characters, newlines, carriage returns, tabs
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(url)) {
    return false;
  }

  // Reject URL scheme indicators (e.g. javascript:, http:, data:)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url.slice(1))) {
    return false;
  }

  return true;
}

export interface CaseAccessCheckTarget {
  assigned_to_user_id: string | null;
}

export function canAccessCase(
  user: Pick<SessionUser, 'userId' | 'role'>,
  caseRecord: CaseAccessCheckTarget
): boolean {
  if (user.role === 'admin') {
    return true;
  }

  if (user.role === 'analyst') {
    return caseRecord.assigned_to_user_id === user.userId;
  }

  return false;
}

export interface CaseCommandCheckTarget {
  status: string;
  assigned_to_user_id: string | null;
}

export function canExecuteCaseCommand(
  user: Pick<SessionUser, 'userId' | 'role'>,
  command: string,
  caseRecord?: CaseCommandCheckTarget
): boolean {
  if (command === 'create') {
    return user.role === 'analyst';
  }

  if (!caseRecord) {
    return false;
  }

  const isAssigned = caseRecord.assigned_to_user_id === user.userId;
  const isAdmin = user.role === 'admin';

  switch (command) {
    case 'start_review':
      return caseRecord.status === 'open' && (isAdmin || isAssigned);

    case 'escalate':
      return caseRecord.status === 'in_review' && (isAdmin || isAssigned);

    case 'return_to_review':
      return isAdmin && caseRecord.status === 'escalated';

    case 'resolve':
    case 'dismiss':
      if (caseRecord.status === 'in_review') {
        return isAdmin || isAssigned;
      }
      if (caseRecord.status === 'escalated') {
        return isAdmin;
      }
      return false;

    case 'reopen':
      return isAdmin && (caseRecord.status === 'closed' || caseRecord.status === 'dismissed');

    default:
      return false;
  }
}

export const MINIMAL_ANALYST_QUEUE_FIELDS = [
  'case_id',
  'case_ref',
  'transaction_id',
  'priority',
  'status',
  'opened_at',
  'due_at',
  'assigned_to_user_id',
] as const;

export function filterCaseSummaryForRole<T extends Record<string, unknown>>(
  user: Pick<SessionUser, 'userId' | 'role'>,
  caseRow: T
): Partial<T> {
  // Admin sees full summary
  if (user.role === 'admin') {
    return caseRow;
  }

  // Analyst assigned to case sees full allowed summary
  if (user.role === 'analyst' && caseRow.assigned_to_user_id === user.userId) {
    return caseRow;
  }

  // Unassigned or assigned-to-another queue row: minimal summary projection
  const projected: Partial<T> = {};
  for (const field of MINIMAL_ANALYST_QUEUE_FIELDS) {
    if (field in caseRow) {
      projected[field as keyof T] = caseRow[field as keyof T];
    }
  }
  return projected;
}
