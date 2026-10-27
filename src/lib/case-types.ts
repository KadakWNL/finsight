export type CaseStatus = 'open' | 'in_review' | 'escalated' | 'closed' | 'dismissed';
export type CasePriority = 'low' | 'medium' | 'high';
export type ResolutionCode = 'confirmed_suspicious' | 'false_positive' | 'insufficient_evidence';

export type CaseCommandType =
  | 'start_review'
  | 'escalate'
  | 'return_to_review'
  | 'resolve'
  | 'dismiss'
  | 'reopen';

export interface CaseSummaryItem {
  case_id?: string;
  case_ref: string;
  transaction_id: string;
  assigned_to_user_id?: string | null;
  status: CaseStatus;
  priority: CasePriority;
  resolution_code?: ResolutionCode | null;
  resolution_notes?: string | null;
  opened_at?: string;
  due_at?: string | null;
  closed_at?: string | null;
  updated_at?: string;
  version?: number;
  [key: string]: unknown;
}

export interface CaseDetail {
  case_id: string;
  case_ref: string;
  transaction_id: string;
  assigned_to_user_id: string | null;
  status: CaseStatus;
  priority: CasePriority;
  resolution_code: ResolutionCode | null;
  resolution_notes: string | null;
  opened_at: string;
  due_at: string | null;
  closed_at: string | null;
  updated_at: string;
  version: number;
  [key: string]: unknown;
}

export interface CaseEventItem {
  event_id: string;
  case_id: string;
  actor_user_id: string;
  event_type: 'created' | 'assigned' | 'status_change';
  from_state: Record<string, unknown> | null;
  to_state: Record<string, unknown>;
  reason: string | null;
  metadata: Record<string, unknown>;
  operation_id: string;
  event_ordinal: number;
  occurred_at: string;
}

export interface CaseListPage {
  data: CaseSummaryItem[];
  limit: number;
  offset: number;
  request_id: string;
}

export interface CaseCommandResult {
  operation_id: string;
  case_id: string;
  case_ref: string;
  status: CaseStatus;
  priority: CasePriority;
  assigned_to_user_id: string | null;
  version: number;
  response_status: number;
  replayed: boolean;
}
