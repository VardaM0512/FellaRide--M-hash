// Display and accessibility settings, kept on this device. They are applied to <html> as data attributes
// (data-theme, data-text, data-motion, data-contrast) that the stylesheet reads. index.html applies the saved
// values before the first paint so the page never flashes the wrong theme.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
export type TextSize = 'normal' | 'large' | 'xl';

export interface Prefs {
  theme: ThemePref;
  text: TextSize;
  reduceMotion: boolean;   // on top of the system setting, which is always respected
  highContrast: boolean;   // on top of the system "increase contrast" setting
  underlineLinks: boolean;
}

const KEY = 'fellaride.prefs';
const DEFAULTS: Prefs = { theme: 'system', text: 'normal', reduceMotion: false, highContrast: false, underlineLinks: false };

function load(): Prefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULTS; }
}

const media = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null);

export function resolvedTheme(theme: ThemePref): 'light' | 'dark' {
  return theme === 'system' ? (media('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light') : theme;
}

function apply(p: Prefs) {
  const root = document.documentElement;
  const theme = resolvedTheme(p.theme);
  root.dataset.theme = theme;
  root.dataset.text = p.text;
  root.dataset.motion = p.reduceMotion || media('(prefers-reduced-motion: reduce)')?.matches ? 'reduce' : 'full';
  root.dataset.contrast = p.highContrast || media('(prefers-contrast: more)')?.matches ? 'more' : 'normal';
  root.dataset.links = p.underlineLinks ? 'underline' : 'plain';
  root.style.colorScheme = theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', theme === 'dark' ? '#0B0E11' : '#EEEDE8'));
}

interface Ctx { prefs: Prefs; set: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void; reset: () => void; theme: 'light' | 'dark'; motionReduced: boolean }
const PrefsContext = createContext<Ctx>({ prefs: DEFAULTS, set: () => {}, reset: () => {}, theme: 'light', motionReduced: false });

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(load);
  const [, rerender] = useState(0);

  useEffect(() => {
    apply(prefs);
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode: settings last for this visit */ }
  }, [prefs]);

  // follow the system when it changes (dark mode at sunset, reduce motion switched on)
  useEffect(() => {
    const queries = ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)', '(prefers-contrast: more)'].map(media);
    const onChange = () => { apply(load()); rerender((n) => n + 1); };
    queries.forEach((q) => q?.addEventListener('change', onChange));
    return () => queries.forEach((q) => q?.removeEventListener('change', onChange));
  }, []);

  const set = useCallback(<K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v })), []);
  const reset = useCallback(() => setPrefs(DEFAULTS), []);
  const theme = resolvedTheme(prefs.theme);
  const motionReduced = prefs.reduceMotion || !!media('(prefers-reduced-motion: reduce)')?.matches;
  return <PrefsContext.Provider value={{ prefs, set, reset, theme, motionReduced }}>{children}</PrefsContext.Provider>;
}

export const usePrefs = () => useContext(PrefsContext);
