export interface DisplayPreferences {
  timeZone: string;
  currency: 'original' | 'INR';
}

export const defaultDisplayPreferences: DisplayPreferences = { timeZone: 'UTC', currency: 'original' };
export const displayPreferencesKey = 'finsight-display-preferences';

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch { return false; }
}

export function parseDisplayPreferences(value: unknown): DisplayPreferences {
  if (!value || typeof value !== 'object') return { ...defaultDisplayPreferences };
  const record = value as Record<string, unknown>;
  return {
    timeZone: isTimeZone(record.timeZone) ? record.timeZone : 'UTC',
    currency: record.currency === 'INR' ? 'INR' : 'original',
  };
}
