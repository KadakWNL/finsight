import 'server-only';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class SessionCleanupParameterError extends Error {
  statusCode: number;
  fields?: Record<string, string>;

  constructor(fields: Record<string, string>, message = 'Invalid session cleanup parameter.', statusCode = 400) {
    super(message);
    this.name = 'SessionCleanupParameterError';
    this.statusCode = statusCode;
    this.fields = fields;
  }
}

export function validateCleanupUuid(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
    throw new SessionCleanupParameterError(
      { [fieldName]: `${fieldName} must be a valid UUID.` },
      `Invalid ${fieldName} parameter.`,
      400
    );
  }
  return value.toLowerCase();
}

export interface ConfirmCleanupPayload {
  confirm: boolean;
  idempotency_key: string;
}

export function parseConfirmCleanupPayload(raw: unknown): ConfirmCleanupPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SessionCleanupParameterError(
      { body: 'Confirmation body must be a JSON object.' },
      'Invalid request body.',
      400
    );
  }

  const record = raw as Record<string, unknown>;

  if ('session_ids' in record || 'candidate_session_ids' in record || 'cutoff' in record) {
    throw new SessionCleanupParameterError(
      { payload: 'Client cannot supply candidate session IDs or cutoff.' },
      'Authoritative cleanup parameters cannot be client-supplied.',
      400
    );
  }

  if (record.confirm !== true) {
    throw new SessionCleanupParameterError(
      { confirm: 'confirm must be explicitly true to confirm session cleanup.' },
      'Explicit confirmation is required.',
      400
    );
  }

  const idempotencyKey = validateCleanupUuid(record.idempotency_key, 'idempotency_key');

  return {
    confirm: true,
    idempotency_key: idempotencyKey,
  };
}
