// Display and accessibility: theme, text size, motion, contrast and link underlines. Saved on this device.
import { usePrefs, type TextSize, type ThemePref } from '../lib/prefs';
import { Icon } from '../components/ui';

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span><strong>{label}</strong><span className="small muted">{hint}</span></span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function ThemeToggle() {
  const { theme, set } = usePrefs();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="icon-btn" onClick={() => set('theme', next)} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      {theme === 'dark' ? Icon.sun : Icon.moon}
    </button>
  );
}

export default function Settings() {
  const { prefs, set, reset } = usePrefs();
  const themes: [ThemePref, string][] = [['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']];
  const sizes: [TextSize, string][] = [['normal', 'Default'], ['large', 'Large'], ['xl', 'Extra large']];
  return (
    <>
      <section className="card" aria-labelledby="look-h">
        <h2 id="look-h" style={{ fontSize: 'var(--fs-h3)' }}>Appearance</h2>
        <div className="field" role="radiogroup" aria-labelledby="theme-l">
          <span id="theme-l">Theme</span>
          <div className="theme-pick">
            {themes.map(([t, label]) => (
              <button key={t} type="button" role="radio" aria-checked={prefs.theme === t} className={`theme-opt t-${t}`} onClick={() => set('theme', t)}>
                <span className="theme-swatch" aria-hidden="true"><i /><i /><i /></span>
                {label}
              </button>
            ))}
          </div>
          <span className="hint">Automatic follows your phone’s light or dark setting.</span>
        </div>
        <div className="field" role="radiogroup" aria-labelledby="text-l">
          <span id="text-l">Text size</span>
          <div className="segmented full">
            {sizes.map(([t, label], i) => (
              <button key={t} type="button" role="radio" aria-checked={prefs.text === t} aria-pressed={prefs.text === t} onClick={() => set('text', t)}
                style={{ fontSize: `calc(${14 + i * 2}px * var(--ts))` }}>{label}</button>
            ))}
          </div>
          <p className="text-preview" aria-hidden="true">Ride with people going your way.</p>
        </div>
      </section>

      <section className="card" aria-labelledby="a11y-h">
        <h2 id="a11y-h" style={{ fontSize: 'var(--fs-h3)' }}>Accessibility</h2>
        <Toggle label="Reduce motion" hint="Turn off slides, pops and moving lines. Also follows your phone’s setting."
          checked={prefs.reduceMotion} onChange={(v) => set('reduceMotion', v)} />
        <Toggle label="Higher contrast" hint="Darker text and clearer edges on buttons, cards and fields."
          checked={prefs.highContrast} onChange={(v) => set('highContrast', v)} />
        <Toggle label="Underline links" hint="Makes links easy to spot without relying on colour."
          checked={prefs.underlineLinks} onChange={(v) => set('underlineLinks', v)} />
        <p className="small muted">FellaRide works with screen readers (VoiceOver, TalkBack) and keyboards. Use Tab to move and Enter to choose; a “Skip to content” link appears first.</p>
      </section>

      <button type="button" className="btn btn-quiet btn-block" onClick={reset}>Reset to defaults</button>
    </>
  );
}
