export interface AnalystAccount {
  user_id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  active_case_count: number;
}

export type AnalystUpdateAction = 'deactivate' | 'reactivate' | 'reset_password';

export interface AnalystListResponse {
  data: AnalystAccount[];
  request_id: string;
}

export interface AnalystCreateResult {
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface AnalystDeactivateResult {
  user_id: string;
  is_active: boolean;
  unassigned_case_count: number;
  sessions_revoked: number;
}

export interface AnalystReactivateResult {
  user_id: string;
  is_active: boolean;
  sessions_revoked: number;
}

export interface AnalystPasswordResetResult {
  user_id: string;
  sessions_revoked: number;
}
