export type HumanRole = 'analyst' | 'admin';
export type RecordKind = 'transaction' | 'account' | 'device' | 'merchant';
export function compactRecordId(kind:RecordKind,id:string) {
  const prefix={transaction:'TXN',account:'ACC',device:'DEV',merchant:'MCH'}[kind];
  return `${prefix} · …${id.slice(-6)}`;
}
export function roleHome(role: HumanRole) { return role === 'admin' ? '/admin' : '/overview'; }
export function safeWorkspacePath(value: string | null | undefined, fallback = '/transactions') {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || [...value].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)) return fallback;
  try {
    const url = new URL(value,'https://workspace.invalid');
    if (url.origin !== 'https://workspace.invalid' || !/^\/(overview|admin|access-denied|transactions(?:\/[0-9a-f-]{36})?)$/i.test(url.pathname)) return fallback;
    return url.pathname + url.search;
  } catch { return fallback; }
}
export function landingPath(role: HumanRole, next?: string | null) {
  const home = roleHome(role);
  const path = safeWorkspacePath(next,home);
  if ((role === 'analyst' && path.split('?')[0] === '/admin') || (role === 'admin' && path.split('?')[0] === '/overview')) return home;
  return path;
}
export function formatMoney(value: string, currency: string) {
  const [whole,fraction=''] = value.split('.');
  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(fraction)) return `${currency} ${value}`;
  return `${currency} ${new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US').format(BigInt(whole))}.${fraction.padEnd(2,'0')}`;
}
export function formatTime(value: string | null) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
}
