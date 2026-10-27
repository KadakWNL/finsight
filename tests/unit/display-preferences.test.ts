import { expect, test } from 'vitest';
import { parseDisplayPreferences } from '../../src/lib/display-preferences';
import { formatTime } from '../../src/lib/workspace';

test('invalid stored preferences fall back without permitting unsupported conversion currencies', () => {
  expect(parseDisplayPreferences(null)).toEqual({ timeZone: 'UTC', currency: 'original' });
  expect(parseDisplayPreferences({ timeZone: 'not/a-zone', currency: 'USD' })).toEqual({ timeZone: 'UTC', currency: 'original' });
  expect(parseDisplayPreferences({ timeZone: 'Asia/Kolkata', currency: 'INR' })).toEqual({ timeZone: 'Asia/Kolkata', currency: 'INR' });
});

test('displayed times handle date rollover and daylight saving without changing the source timestamp', () => {
  const timestamp = '2026-10-27T21:00:00Z';
  expect(formatTime(timestamp, 'UTC')).toBe('27 Oct 2026, 21:00');
  expect(formatTime(timestamp, 'Asia/Kolkata')).toBe('28 Oct 2026, 02:30');
  expect(formatTime('2026-01-15T12:00:00Z', 'America/New_York')).toBe('15 Jan 2026, 07:00');
  expect(formatTime('2026-07-15T12:00:00Z', 'America/New_York')).toBe('15 Jul 2026, 08:00');
  expect(formatTime(null, 'Asia/Kolkata')).toBe('Not set');
  expect(formatTime('invalid', 'Asia/Kolkata')).toBe('Not recorded');
});
