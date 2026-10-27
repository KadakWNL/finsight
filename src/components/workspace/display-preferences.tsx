'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { defaultDisplayPreferences, displayPreferencesKey, parseDisplayPreferences, type DisplayPreferences } from '@/lib/display-preferences';
import { formatMoney, formatTime } from '@/lib/workspace';

const PreferencesContext = createContext<DisplayPreferences & {
  ready: boolean;
  updatePreferences: (updates: Partial<DisplayPreferences>) => void;
}>({
  ...defaultDisplayPreferences,
  ready: false,
  updatePreferences: () => {},
});

export function DisplayPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState(defaultDisplayPreferences);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    function read() {
      try { setPreferences(parseDisplayPreferences(JSON.parse(localStorage.getItem(displayPreferencesKey) ?? 'null'))); }
      catch { setPreferences(defaultDisplayPreferences); }
    }
    function onStorage(event: StorageEvent) {
      if (event.key === displayPreferencesKey || event.key === null) read();
    }
    read();
    setReady(true);
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function updatePreferences(updates: Partial<DisplayPreferences>) {
    const next = parseDisplayPreferences({ ...preferences, ...updates });
    setPreferences(next);
    try { localStorage.setItem(displayPreferencesKey, JSON.stringify(next)); }
    catch { /* Preferences remain usable for this session when storage is unavailable. */ }
  }

  return <PreferencesContext.Provider value={{ ...preferences, ready, updatePreferences }}>{children}</PreferencesContext.Provider>;
}

export function useDisplayPreferences() { return useContext(PreferencesContext); }

export function TransactionAmount({ amount, currencyCode, amountBase, large = false }: {
  amount: string; currencyCode: string; amountBase: string; large?: boolean;
}) {
  const { currency } = useDisplayPreferences();
  const baseFirst = currency === 'INR';
  return <>
    <strong className={large ? 'amount-large' : undefined}>
      {baseFirst ? formatMoney(amountBase, 'INR') : formatMoney(amount, currencyCode)}
    </strong>
    <span className="base-amount">
      {baseFirst ? `${formatMoney(amount, currencyCode)} original` : `${formatMoney(amountBase, 'INR')} base`}
    </span>
  </>;
}

const commonTimeZones = ['UTC', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney'];

export function RegionalSettings() {
  const { timeZone, currency, ready, updatePreferences } = useDisplayPreferences();
  const [zones, setZones] = useState(commonTimeZones);
  useEffect(() => {
    setZones(['UTC', ...new Set([...commonTimeZones, ...Intl.supportedValuesOf('timeZone')].filter(zone => zone !== 'UTC'))].sort((a, b) => a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b)));
  }, []);
  const options = zones.includes(timeZone) ? zones : [...zones, timeZone];
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return <div className="regional-settings">
    <div>
      <label htmlFor="display-time-zone">Time zone</label>
      <div className="timezone-controls">
        <select id="display-time-zone" value={timeZone} disabled={!ready} aria-describedby="timezone-help"
          onChange={event => updatePreferences({ timeZone: event.target.value })}>
          {options.map(zone => <option value={zone} key={zone}>{zone.replaceAll('_', ' ')}</option>)}
        </select>
        <button type="button" className="button-link secondary" disabled={!ready} onClick={() => updatePreferences({ timeZone: deviceZone })}>Use device time zone</button>
      </div>
      <p className="settings-help" id="timezone-help">Transaction, case and audit times use this zone. Date range filters are explicitly entered in UTC.</p>
      <p className="settings-preview">Preview: {formatTime('2026-10-27T12:00:00Z', timeZone)} ({timeZone})</p>
    </div>
    <div>
      <label htmlFor="display-currency">Display currency</label>
      <select id="display-currency" value={currency} disabled={!ready} aria-describedby="currency-help"
        onChange={event => updatePreferences({ currency: event.target.value === 'INR' ? 'INR' : 'original' })}>
        <option value="original">Original transaction currency</option>
        <option value="INR">INR · recorded base amount</option>
      </select>
      <p className="settings-help" id="currency-help">Choose the primary amount shown. Both original and INR base amounts remain visible, using each transaction’s recorded exchange rate.</p>
    </div>
    <p className="settings-help">Changes apply immediately and are saved in this browser.</p>
  </div>;
}
