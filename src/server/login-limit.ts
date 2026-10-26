import 'server-only';
import { createHmac } from 'node:crypto';
import { getAuthSecret } from './auth-security';

export function createLoginLimiter() {
  const accounts = new Map<string, { count: number; until: number }>();
  let total = { count: 0, until: 0 };
  return (identifier: string, now = Date.now()): boolean => {
    if (now >= total.until) total = { count: 0, until: now + 60_000 };
    if (++total.count > 100) return false;
    for (const [key, entry] of accounts) if (now >= entry.until) accounts.delete(key);
    const key = createHmac('sha256', getAuthSecret()).update(identifier.trim().toLowerCase()).digest('hex');
    const entry = accounts.get(key) ?? { count: 0, until: now + 15 * 60_000 };
    if (accounts.size >= 10_000 && !accounts.has(key)) return false;
    accounts.set(key, entry);
    return ++entry.count <= 5;
  };
}

const processState = globalThis as typeof globalThis & { finsightLoginLimiter?: ReturnType<typeof createLoginLimiter> };
export const consumeLoginAttempt = processState.finsightLoginLimiter ??= createLoginLimiter();
