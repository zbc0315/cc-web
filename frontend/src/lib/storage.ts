import { useState, useCallback } from 'react';

// ── Typed Storage Keys ──────────────────────────────────────────────────────

export const STORAGE_KEYS = {
  token: 'cc_web_token',
  theme: 'cc_web_theme',
  viewMode: (id: string) => `cc_viewmode_${id}`,
  panelFileTree: 'cc_panel_filetree',
  panelShortcuts: 'cc_panel_shortcuts',
  fileZoom: 'cc_file_zoom',
  skillhubAuthor: 'ccweb_skillhub_author',
  projectOrder: 'cc_project_order',
} as const;

// ── Storage Helpers ─────────────────────────────────────────────────────────

export function getStorage(key: string, fallback: string): string;
export function getStorage<T>(key: string, fallback: T, parse: true): T;
export function getStorage<T>(key: string, fallback: T, parse?: boolean): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return parse ? (JSON.parse(raw) as T) : (raw as T);
  } catch {
    return fallback;
  }
}

export function setStorage(key: string, value: string): void;
export function setStorage(key: string, value: unknown, stringify: true): void;
export function setStorage(key: string, value: unknown, stringify?: boolean): void {
  try {
    localStorage.setItem(key, stringify ? JSON.stringify(value) : String(value));
  } catch { /* Safari private mode, quota exceeded */ }
}

export function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch { /* */ }
}

// ── usePersistedState Hook ──────────────────────────────────────────────────

export function usePersistedState(
  key: string,
  fallback: string,
): [string, (v: string | ((prev: string) => string)) => void];
export function usePersistedState<T>(
  key: string,
  fallback: T,
  options: { parse: true },
): [T, (v: T | ((prev: T) => T)) => void];
export function usePersistedState<T>(
  key: string,
  fallback: T,
  options?: { parse: boolean },
): [T, (v: T | ((prev: T) => T)) => void] {
  const parse = options?.parse ?? false;

  const [value, setValueRaw] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return parse ? (JSON.parse(raw) as T) : (raw as T);
    } catch {
      return fallback;
    }
  });

  const setValue = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValueRaw((prev) => {
        const next = typeof v === 'function' ? (v as (prev: T) => T)(prev) : v;
        try {
          localStorage.setItem(key, parse ? JSON.stringify(next) : String(next));
        } catch { /* */ }
        return next;
      });
    },
    [key, parse],
  );

  return [value, setValue];
}
