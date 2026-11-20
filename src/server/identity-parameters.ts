import 'server-only';
import type { AnalystUpdateAction } from '@/lib/identity-types';

export class IdentityParameterError extends Error {
  constructor(
    public readonly fields: Record<string, string>,
    public readonly statusCode: number = 400
  ) {
    super(Object.values(fields)[0] || 'Invalid account parameters.');
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasControlCharacters(value: string): boolean {
  return [...value].some(character => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

export function validateAnalystId(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new IdentityParameterError({ [field]: 'Expected a valid UUID.' }, 400);
  }
  return value.toLowerCase();
}

function recordBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new IdentityParameterError({ body: 'Expected a JSON object body.' }, 400);
  }
  return body as Record<string, unknown>;
}

function validateKeys(record: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new IdentityParameterError({ [key]: 'This field is not accepted.' });
    }
  }
}

function alias(record: Record<string, unknown>, ...keys: string[]): unknown {
  const present = keys.filter(key => Object.hasOwn(record, key));
  if (present.length > 1) {
    throw new IdentityParameterError({ [keys[0]]: 'Supply this field only once.' });
  }
  return present.length ? record[present[0]] : undefined;
}

export function normalizeAnalystEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new IdentityParameterError({ email: 'Email address is required.' });
  }
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email) || hasControlCharacters(email)) {
    throw new IdentityParameterError({ email: 'Enter a valid email address.' });
  }
  return email;
}

export function validateDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new IdentityParameterError({ display_name: 'Display name is required.' });
  }
  const displayName = value.trim();
  if (displayName.length < 1 || displayName.length > 200 || hasControlCharacters(displayName)) {
    throw new IdentityParameterError({ display_name: 'Display name must contain 1-200 characters.' });
  }
  return displayName;
}

export function validatePassword(value: unknown, field = 'password'): string {
  if (typeof value !== 'string') {
    throw new IdentityParameterError({ [field]: 'Password is required.' });
  }
  if (value.length < 12 || value.length > 1024 || value.trim().length === 0 || hasControlCharacters(value)) {
    throw new IdentityParameterError({ [field]: 'Password must contain 12-1024 characters without control characters.' });
  }
  return value;
}

export function validateReason(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new IdentityParameterError({ reason: 'Reason must be text.' });
  }
  const reason = value.trim();
  if (reason.length < 1 || reason.length > 500 || hasControlCharacters(reason)) {
    throw new IdentityParameterError({ reason: 'Reason must contain 1-500 characters.' });
  }
  return reason;
}

export interface CreateAnalystInput {
  email: string;
  displayName: string;
  password: string;
}

export function parseCreateAnalystPayload(body: unknown): CreateAnalystInput {
  const record = recordBody(body);
  validateKeys(record, ['email', 'display_name', 'displayName', 'password']);
  return {
    email: normalizeAnalystEmail(record.email),
    displayName: validateDisplayName(alias(record, 'display_name', 'displayName')),
    password: validatePassword(record.password),
  };
}

export type AnalystUpdateInput =
  | { action: 'deactivate'; reason?: string }
  | { action: 'reactivate'; password: string }
  | { action: 'reset_password'; password: string };

const actions = new Set<AnalystUpdateAction>(['deactivate', 'reactivate', 'reset_password']);

export function parseAnalystUpdatePayload(body: unknown): AnalystUpdateInput {
  const record = recordBody(body);
  const rawAction = record.action;
  if (typeof rawAction !== 'string' || !actions.has(rawAction as AnalystUpdateAction)) {
    throw new IdentityParameterError({ action: 'Action must be deactivate, reactivate or reset_password.' });
  }
  const action = rawAction as AnalystUpdateAction;

  if (action === 'deactivate') {
    validateKeys(record, ['action', 'reason']);
    return { action, reason: validateReason(record.reason) };
  }

  validateKeys(record, ['action', 'password']);
  return { action, password: validatePassword(record.password) };
}
