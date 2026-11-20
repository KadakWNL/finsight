import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  normalizeAnalystEmail,
  parseAnalystUpdatePayload,
  parseCreateAnalystPayload,
  validateAnalystId,
  validatePassword,
  IdentityParameterError,
} from '../../src/server/identity-parameters';

describe('Analyst administration parameter validation', () => {
  it('normalizes email and trims the display name', () => {
    const input = parseCreateAnalystPayload({
      email: '  Analyst.New@Synthetic.Invalid ',
      display_name: '  New Analyst  ',
      password: 'correct horse battery staple',
    });
    expect(input).toEqual({
      email: 'analyst.new@synthetic.invalid',
      displayName: 'New Analyst',
      password: 'correct horse battery staple',
    });
  });

  it('accepts the camelCase display name alias', () => {
    expect(parseCreateAnalystPayload({
      email: 'alias@synthetic.invalid',
      displayName: 'Alias',
      password: 'a-long-enough-password',
    }).displayName).toBe('Alias');
  });

  it('rejects missing fields, extra fields and weak passwords', () => {
    expect(() => parseCreateAnalystPayload({ email: 'x@synthetic.invalid', display_name: 'X', password: 'short' }))
      .toThrow(IdentityParameterError);
    expect(() => parseCreateAnalystPayload({ email: 'not-an-email', display_name: 'X', password: 'a-long-enough-password' }))
      .toThrow(IdentityParameterError);
    expect(() => parseCreateAnalystPayload({ email: 'x@synthetic.invalid', display_name: 'X', password: 'a-long-enough-password', role: 'admin' }))
      .toThrow(IdentityParameterError);
    expect(() => validatePassword('a'.repeat(1025))).toThrow(IdentityParameterError);
  });

  it('validates update actions and their allowed fields', () => {
    expect(parseAnalystUpdatePayload({ action: 'deactivate', reason: '  left the team  ' }))
      .toEqual({ action: 'deactivate', reason: 'left the team' });
    expect(parseAnalystUpdatePayload({ action: 'deactivate' }))
      .toEqual({ action: 'deactivate', reason: undefined });
    expect(parseAnalystUpdatePayload({ action: 'reactivate', password: 'a-brand-new-password' }))
      .toEqual({ action: 'reactivate', password: 'a-brand-new-password' });
    expect(parseAnalystUpdatePayload({ action: 'reset_password', password: 'a-brand-new-password' }))
      .toEqual({ action: 'reset_password', password: 'a-brand-new-password' });
  });

  it('rejects unknown actions and cross-action fields', () => {
    expect(() => parseAnalystUpdatePayload({ action: 'delete' })).toThrow(IdentityParameterError);
    expect(() => parseAnalystUpdatePayload({ action: 'deactivate', password: 'a-brand-new-password' }))
      .toThrow(IdentityParameterError);
    expect(() => parseAnalystUpdatePayload({ action: 'reactivate', reason: 'no' }))
      .toThrow(IdentityParameterError);
    expect(() => parseAnalystUpdatePayload({ action: 'reactivate', password: 'short' }))
      .toThrow(IdentityParameterError);
  });

  it('normalizes UUIDs and rejects malformed identifiers', () => {
    expect(validateAnalystId('20000000-0000-0000-0000-00000000000A'))
      .toBe('20000000-0000-0000-0000-00000000000a');
    expect(() => validateAnalystId('not-a-uuid')).toThrow(IdentityParameterError);
    expect(normalizeAnalystEmail(' User@Example.IN ')).toBe('user@example.in');
  });
});
