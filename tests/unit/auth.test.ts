import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { normalizeEmail, hashPassword, verifyPassword } from '../../src/server/auth';
import {
  isSafeRedirect,
  canAccessCase,
  canExecuteCaseCommand,
  filterCaseSummaryForRole,
} from '../../src/server/authorization';

describe('Authentication and Authorization Unit Tests (VS01-VS03)', () => {
  describe('Email Normalization', () => {
    it('normalizes email by trimming and converting to lowercase', () => {
      expect(normalizeEmail('  Analyst@Synthetic.INVALID  ')).toBe('analyst@synthetic.invalid');
      expect(normalizeEmail('USER.NAME+tag@DOMAIN.COM')).toBe('user.name+tag@domain.com');
      expect(normalizeEmail('simple@example.com')).toBe('simple@example.com');
    });
  });

  describe('Argon2id Hashing and Verification', () => {
    it('generates OWASP-compliant Argon2id hash and verifies correctly', async () => {
      const password = 'CorrectHorseBatteryStaple-2026!';
      const hash = await hashPassword(password);

      // Verify Argon2id format with OWASP parameters (19 MiB / m=19456, t=2, p=1)
      expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);

      // Valid password verification
      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);

      // Invalid password verification
      const isInvalid = await verifyPassword('WrongPassword-1234', hash);
      expect(isInvalid).toBe(false);
    });

    it('gracefully handles malformed hashes without crashing', async () => {
      const isValid = await verifyPassword('password', 'not-a-valid-argon-hash');
      expect(isValid).toBe(false);
    });
  });

  describe('Safe Redirect Validator', () => {
    it('accepts safe relative local paths', () => {
      expect(isSafeRedirect('/')).toBe(true);
      expect(isSafeRedirect('/cases')).toBe(true);
      expect(isSafeRedirect('/cases/30000000-0000-0000-0000-000000000060')).toBe(true);
      expect(isSafeRedirect('/dashboard?tab=overview&status=open')).toBe(true);
    });

    it('rejects protocol-relative URLs and domain evasion', () => {
      expect(isSafeRedirect('//evil.com')).toBe(false);
      expect(isSafeRedirect('//localhost:3000')).toBe(false);
      expect(isSafeRedirect('/\\evil.com')).toBe(false);
      expect(isSafeRedirect('///evil.com')).toBe(false);
    });

    it('rejects external URLs and schemes', () => {
      expect(isSafeRedirect('https://evil.com')).toBe(false);
      expect(isSafeRedirect('http://evil.com/cases')).toBe(false);
      expect(isSafeRedirect('javascript:alert(1)')).toBe(false);
      expect(isSafeRedirect('data:text/html,evil')).toBe(false);
      expect(isSafeRedirect('vbscript:msgbox(1)')).toBe(false);
    });

    it('rejects backslashes anywhere in path', () => {
      expect(isSafeRedirect('/cases\\detail')).toBe(false);
      expect(isSafeRedirect('/foo/bar\\baz')).toBe(false);
    });

    it('rejects control characters, newlines, and null bytes', () => {
      expect(isSafeRedirect('/cases\r\nSet-Cookie:bad=1')).toBe(false);
      expect(isSafeRedirect('/cases\0')).toBe(false);
      expect(isSafeRedirect('/cases\t1')).toBe(false);
    });

    it('rejects null, undefined, and non-string inputs', () => {
      expect(isSafeRedirect(null)).toBe(false);
      expect(isSafeRedirect(undefined)).toBe(false);
      expect(isSafeRedirect('')).toBe(false);
    });
  });

  describe('Case Access Policy (canAccessCase)', () => {
    const adminUser = { userId: '10000000-0000-0000-0000-000000000001', role: 'admin' as const };
    const analystAlice = { userId: '10000000-0000-0000-0000-000000000002', role: 'analyst' as const };
    const analystBob = { userId: '10000000-0000-0000-0000-000000000003', role: 'analyst' as const };

    it('allows admin to access any case regardless of assignee', () => {
      expect(canAccessCase(adminUser, { assigned_to_user_id: analystAlice.userId })).toBe(true);
      expect(canAccessCase(adminUser, { assigned_to_user_id: analystBob.userId })).toBe(true);
      expect(canAccessCase(adminUser, { assigned_to_user_id: null })).toBe(true);
    });

    it('allows analyst to access only their own assigned case', () => {
      expect(canAccessCase(analystAlice, { assigned_to_user_id: analystAlice.userId })).toBe(true);
      expect(canAccessCase(analystAlice, { assigned_to_user_id: analystBob.userId })).toBe(false);
      expect(canAccessCase(analystAlice, { assigned_to_user_id: null })).toBe(false);
    });
  });

  describe('Case Command Authorization (canExecuteCaseCommand)', () => {
    const admin = { userId: '10000000-0000-0000-0000-000000000001', role: 'admin' as const };
    const analyst = { userId: '10000000-0000-0000-0000-000000000002', role: 'analyst' as const };
    const otherAnalyst = { userId: '10000000-0000-0000-0000-000000000003', role: 'analyst' as const };

    it('create: only analyst can create', () => {
      expect(canExecuteCaseCommand(analyst, 'create')).toBe(true);
      expect(canExecuteCaseCommand(admin, 'create')).toBe(false);
    });

    it('start_review: open case assigned to analyst or admin', () => {
      const openCase = { status: 'open', assigned_to_user_id: analyst.userId };
      expect(canExecuteCaseCommand(analyst, 'start_review', openCase)).toBe(true);
      expect(canExecuteCaseCommand(admin, 'start_review', openCase)).toBe(true);
      expect(canExecuteCaseCommand(otherAnalyst, 'start_review', openCase)).toBe(false);

      const inReviewCase = { status: 'in_review', assigned_to_user_id: analyst.userId };
      expect(canExecuteCaseCommand(analyst, 'start_review', inReviewCase)).toBe(false);
    });

    it('escalate: in_review case assigned to analyst or admin', () => {
      const inReview = { status: 'in_review', assigned_to_user_id: analyst.userId };
      expect(canExecuteCaseCommand(analyst, 'escalate', inReview)).toBe(true);
      expect(canExecuteCaseCommand(admin, 'escalate', inReview)).toBe(true);
      expect(canExecuteCaseCommand(otherAnalyst, 'escalate', inReview)).toBe(false);
    });

    it('return_to_review: admin only on escalated case', () => {
      const escalated = { status: 'escalated', assigned_to_user_id: analyst.userId };
      expect(canExecuteCaseCommand(admin, 'return_to_review', escalated)).toBe(true);
      expect(canExecuteCaseCommand(analyst, 'return_to_review', escalated)).toBe(false);
    });

    it('resolve and dismiss: assigned analyst in review, admin in review or escalated', () => {
      const inReview = { status: 'in_review', assigned_to_user_id: analyst.userId };
      expect(canExecuteCaseCommand(analyst, 'resolve', inReview)).toBe(true);
      expect(canExecuteCaseCommand(analyst, 'dismiss', inReview)).toBe(true);
      expect(canExecuteCaseCommand(admin, 'resolve', inReview)).toBe(true);
      expect(canExecuteCaseCommand(otherAnalyst, 'resolve', inReview)).toBe(false);

      const escalated = { status: 'escalated', assigned_to_user_id: analyst.userId };
      expect(canExecuteCaseCommand(admin, 'resolve', escalated)).toBe(true);
      expect(canExecuteCaseCommand(admin, 'dismiss', escalated)).toBe(true);
      expect(canExecuteCaseCommand(analyst, 'resolve', escalated)).toBe(false);
    });

    it('reopen: admin only on closed or dismissed cases', () => {
      const closed = { status: 'closed', assigned_to_user_id: analyst.userId };
      const dismissed = { status: 'dismissed', assigned_to_user_id: analyst.userId };
      const open = { status: 'open', assigned_to_user_id: analyst.userId };

      expect(canExecuteCaseCommand(admin, 'reopen', closed)).toBe(true);
      expect(canExecuteCaseCommand(admin, 'reopen', dismissed)).toBe(true);
      expect(canExecuteCaseCommand(analyst, 'reopen', closed)).toBe(false);
      expect(canExecuteCaseCommand(admin, 'reopen', open)).toBe(false);
    });
  });

  describe('Queue Projection Filter (filterCaseSummaryForRole)', () => {
    const admin = { userId: '10000000-0000-0000-0000-000000000001', role: 'admin' as const };
    const analystAlice = { userId: '10000000-0000-0000-0000-000000000002', role: 'analyst' as const };

    const caseData = {
      case_id: '30000000-0000-0000-0000-000000000060',
      case_ref: 'CASE-001',
      transaction_id: '30000000-0000-0000-0000-000000000050',
      priority: 'high',
      status: 'in_review',
      opened_at: '2026-01-01T00:00:00Z',
      due_at: '2026-01-02T00:00:00Z',
      assigned_to_user_id: '10000000-0000-0000-0000-000000000099', // assigned to someone else
      resolution_notes: 'Private sensitive rationale notes',
      internal_score: 95,
    };

    it('returns full case summary to admin', () => {
      const result = filterCaseSummaryForRole(admin, caseData);
      expect(result).toEqual(caseData);
    });

    it('conceals other analysts cases from the queue', () => {
      const result = filterCaseSummaryForRole(analystAlice, caseData);
      expect(result).toBeNull();
    });

    it('returns only approved fields for unassigned cases', () => {
      const result = filterCaseSummaryForRole(analystAlice, { ...caseData, assigned_to_user_id: null });
      expect(result).toEqual({ case_ref: 'CASE-001', transaction_id: caseData.transaction_id,
        priority: 'high', status: 'in_review', due_at: caseData.due_at });
    });

    it('returns full allowed summary when case is assigned to analyst', () => {
      const ownCase = { ...caseData, assigned_to_user_id: analystAlice.userId };
      const result = filterCaseSummaryForRole(analystAlice, ownCase);
      expect(result).toEqual(ownCase);
    });
  });
});
