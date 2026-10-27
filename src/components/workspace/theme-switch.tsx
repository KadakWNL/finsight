'use client';
import { useEffect, useId, useState } from 'react';

type ThemePreference = 'system' | 'light' | 'dark';
const themeEvent = 'finsight-theme-change';

function useThemePreference() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    function sync() {
      let stored = document.documentElement.dataset.themePreference;
      try { stored = localStorage.getItem('finsight-theme') ?? undefined; } catch { /* Use the in-memory preference when storage is unavailable. */ }
      const next = stored === 'light' || stored === 'dark' ? stored : 'system';
      const resolved = next === 'system' ? (media.matches ? 'dark' : 'light') : next;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.themePreference = next;
      setPreferenceState(next);
      setTheme(resolved);
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'finsight-theme' || event.key === null) sync();
    };
    sync();
    setReady(true);
    media.addEventListener('change', sync);
    window.addEventListener('storage', onStorage);
    window.addEventListener(themeEvent, sync);
    return () => {
      media.removeEventListener('change', sync);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(themeEvent, sync);
    };
  }, []);

  function setPreference(next: ThemePreference) {
    document.documentElement.dataset.themePreference = next;
    try {
      if (next === 'system') localStorage.removeItem('finsight-theme');
      else localStorage.setItem('finsight-theme', next);
    } catch { /* The in-memory selection remains usable. */ }
    window.dispatchEvent(new Event(themeEvent));
  }

  return { theme, preference, ready, setPreference };
}

export function ThemeSwitch() {
  const { theme, ready, setPreference } = useThemePreference();
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return <button type="button" className="theme-switch" disabled={!ready}
    onClick={() => setPreference(theme === 'dark' ? 'light' : 'dark')} aria-label={label} title={label}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {theme === 'dark' ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></> : <path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"/>}
    </svg>
  </button>;
}

export function AppearanceSettings() {
  const { preference, ready, setPreference } = useThemePreference();
  const groupName = useId();
  const choices = [
    { value: 'system', label: 'System', description: 'Follow your device’s appearance.' },
    { value: 'light', label: 'Light', description: 'A bright workspace.' },
    { value: 'dark', label: 'Dark', description: 'A dimmed workspace.' },
  ] as const;

  return <fieldset className="choice-group" disabled={!ready}>
    <legend>Theme</legend>
    <div className="choice-list theme-choices">
      {choices.map(choice => <label className="choice-option" key={choice.value}>
        <input type="radio" name={groupName} value={choice.value} checked={preference === choice.value}
          onChange={() => setPreference(choice.value)}/>
        <span><strong>{choice.label}</strong><span className="choice-description">{choice.description}</span></span>
      </label>)}
    </div>
    <p className="settings-help">Changes apply immediately and are saved in this browser.</p>
  </fieldset>;
}
