import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  validateCaseUuid,
  parseCaseQuery,
  parseCreateCasePayload,
  parseCaseCommandPayload,
  CaseParameterError,
} from '../../src/server/case-parameters';

describe('Case Parameter Validation Unit Tests', () => {
  const validUuid = '10000000-0000-0000-0000-000000000001';
  const validTxnId = '20000000-0000-0000-0000-000000000002';
  const validKey = '30000000-0000-0000-0000-000000000003';

  describe('validateCaseUuid', () => {
    it('normalizes valid uppercase UUIDs to lowercase', () => {
      expect(validateCaseUuid(validUuid.toUpperCase())).toBe(validUuid.toLowerCase());
    });

    it('rejects malformed or non-string UUIDs', () => {
      expect(() => validateCaseUuid('invalid-uuid')).toThrow(CaseParameterError);
      expect(() => validateCaseUuid(12345)).toThrow(CaseParameterError);
      expect(() => validateCaseUuid(null)).toThrow(CaseParameterError);
    });
  });

  describe('parseCaseQuery', () => {
    it('accepts only supported queue scopes', () => {
      expect(parseCaseQuery(new URLSearchParams('scope=mine')).scope).toBe('mine');
      expect(parseCaseQuery(new URLSearchParams('scope=unassigned')).scope).toBe('unassigned');
      expect(() => parseCaseQuery(new URLSearchParams('scope=peer'))).toThrow(CaseParameterError);
      expect(() => parseCaseQuery(new URLSearchParams('scope=mine&scope=unassigned'))).toThrow(CaseParameterError);
    });

    it('applies default limit and offset', () => {
      const parsed = parseCaseQuery(new URLSearchParams());
      expect(parsed).toEqual({
        status: undefined,
        priority: undefined,
        limit: 50,
        offset: 0,
      });
    });

    it('accepts valid status and priority filters', () => {
      const parsed = parseCaseQuery(
        new URLSearchParams('status=in_review&priority=high&limit=10&offset=20')
      );
      expect(parsed).toEqual({
        status: 'in_review',
        priority: 'high',
        limit: 10,
        offset: 20,
      });
    });

    it('rejects invalid status or priority', () => {
      expect(() => parseCaseQuery(new URLSearchParams('status=bogus'))).toThrow(CaseParameterError);
      expect(() => parseCaseQuery(new URLSearchParams('priority=urgent'))).toThrow(CaseParameterError);
    });

    it('enforces limit and offset bounds', () => {
      expect(() => parseCaseQuery(new URLSearchParams('limit=0'))).toThrow(CaseParameterError);
      expect(() => parseCaseQuery(new URLSearchParams('limit=101'))).toThrow(CaseParameterError);
      expect(() => parseCaseQuery(new URLSearchParams('offset=-1'))).toThrow(CaseParameterError);
    });
  });

  describe('parseCreateCasePayload', () => {
    it('parses valid creation payload with header idempotency key', () => {
      const headers = new Headers({ 'idempotency-key': validKey });
      const body = {
        transaction_id: validTxnId,
        priority: 'high',
        reason: 'Investigation triggered by high-risk card score',
      };
      const result = parseCreateCasePayload(body, headers);
      expect(result).toEqual({
        idempotencyKey: validKey,
        transactionId: validTxnId,
        priority: 'high',
        reason: 'Investigation triggered by high-risk card score',
      });
    });

    it('accepts idempotency key from body fallback', () => {
      const headers = new Headers();
      const body = {
        idempotency_key: validKey,
        transaction_id: validTxnId,
        priority: 'low',
        reason: 'Random sample check',
      };
      const result = parseCreateCasePayload(body, headers);
      expect(result.idempotencyKey).toBe(validKey);
    });

    it('rejects missing or malformed idempotency key', () => {
      const headers = new Headers();
      const body = {
        transaction_id: validTxnId,
        priority: 'low',
        reason: 'Valid reason',
      };
      expect(() => parseCreateCasePayload(body, headers)).toThrow(CaseParameterError);
    });

    it('rejects blank or whitespace-padded reasons', () => {
      const headers = new Headers({ 'idempotency-key': validKey });
      expect(() =>
        parseCreateCasePayload(
          { transaction_id: validTxnId, priority: 'medium', reason: '   ' },
          headers
        )
      ).toThrow(CaseParameterError);
      expect(() =>
        parseCreateCasePayload(
          { transaction_id: validTxnId, priority: 'medium', reason: ' unpadded ' },
          headers
        )
      ).toThrow(CaseParameterError);
    });

    it('rejects oversize reasons exceeding 2000 chars', () => {
      const headers = new Headers({ 'idempotency-key': validKey });
      expect(() =>
        parseCreateCasePayload(
          { transaction_id: validTxnId, priority: 'medium', reason: 'a'.repeat(2001) },
          headers
        )
      ).toThrow(CaseParameterError);
    });
  });

  describe('parseCaseCommandPayload', () => {
    const headers = new Headers({ 'idempotency-key': validKey });

    it('parses start_review without reason or resolution fields', () => {
      const body = { action: 'start_review', expected_version: 1 };
      const parsed = parseCaseCommandPayload(body, headers);
      expect(parsed).toEqual({
        action: 'start_review',
        expectedVersion: 1,
        idempotencyKey: validKey,
        reason: undefined,
        resolutionCode: undefined,
        resolutionNotes: undefined,
      });
    });

    it('requires reason for escalate, return_to_review, and reopen', () => {
      for (const action of ['escalate', 'return_to_review', 'reopen'] as const) {
        expect(() =>
          parseCaseCommandPayload({ action, expected_version: 2 }, headers)
        ).toThrow(CaseParameterError);

        const parsed = parseCaseCommandPayload(
          { action, expected_version: 2, reason: `Reason for ${action}` },
          headers
        );
        expect(parsed.reason).toBe(`Reason for ${action}`);
      }
    });

    it('requires confirmed_suspicious code for resolve', () => {
      expect(() =>
        parseCaseCommandPayload(
          {
            action: 'resolve',
            expected_version: 3,
            resolution_code: 'false_positive',
            resolution_notes: 'Notes',
          },
          headers
        )
      ).toThrow(CaseParameterError);

      const parsed = parseCaseCommandPayload(
        {
          action: 'resolve',
          expected_version: 3,
          resolution_code: 'confirmed_suspicious',
          resolution_notes: 'Documented suspicious findings',
        },
        headers
      );
      expect(parsed.resolutionCode).toBe('confirmed_suspicious');
      expect(parsed.resolutionNotes).toBe('Documented suspicious findings');
    });

    it('requires false_positive or insufficient_evidence code for dismiss', () => {
      expect(() =>
        parseCaseCommandPayload(
          {
            action: 'dismiss',
            expected_version: 3,
            resolution_code: 'confirmed_suspicious',
            resolution_notes: 'Notes',
          },
          headers
        )
      ).toThrow(CaseParameterError);

      for (const code of ['false_positive', 'insufficient_evidence'] as const) {
        const parsed = parseCaseCommandPayload(
          {
            action: 'dismiss',
            expected_version: 3,
            resolution_code: code,
            resolution_notes: 'Dismissal rationale notes',
          },
          headers
        );
        expect(parsed.resolutionCode).toBe(code);
      }
    });

    it('rejects missing or zero expected_version', () => {
      expect(() =>
        parseCaseCommandPayload({ action: 'start_review' }, headers)
      ).toThrow(CaseParameterError);
      expect(() =>
        parseCaseCommandPayload({ action: 'start_review', expected_version: 0 }, headers)
      ).toThrow(CaseParameterError);
      expect(() =>
        parseCaseCommandPayload({ action: 'start_review', expected_version: -1 }, headers)
      ).toThrow(CaseParameterError);
    });
  });
  it('rejects unknown fields, ambiguous aliases and noninteger coercions', () => {
    const headers = new Headers({ 'idempotency-key': validKey });
    const create = { transaction_id: validTxnId, priority: 'high', reason: 'Synthetic reason' };
    for (const field of ['actor_user_id', 'assigned_to_user_id', 'status', 'case_id', 'case_ref']) {
      expect(() => parseCreateCasePayload({ ...create, [field]: validUuid }, headers)).toThrow(CaseParameterError);
    }
    expect(() => parseCreateCasePayload({ ...create, transactionId: validTxnId }, headers)).toThrow(CaseParameterError);
    expect(() => parseCreateCasePayload({ ...create, idempotency_key: validUuid }, headers)).toThrow(CaseParameterError);
    for (const version of [true, '1', [1], 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseCaseCommandPayload({ action: 'start_review', expected_version: version }, headers)).toThrow(CaseParameterError);
    }
    expect(() => parseCaseCommandPayload({ action: 'start_review', expected_version: 1, assigned_to_user_id: validUuid }, headers)).toThrow(CaseParameterError);
    for (const query of ['limit=1e2', 'offset=1.5', 'offset=9007199254740992', 'limit=1&limit=2', 'page_size=1&limit=2', 'unknown=value']) {
      expect(() => parseCaseQuery(new URLSearchParams(query))).toThrow(CaseParameterError);
    }
  });

});
