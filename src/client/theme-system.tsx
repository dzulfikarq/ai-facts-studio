import React, { useCallback, useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

export type ThemePreference = "light" | "dark" | "system";

const storageKey = "ai-facts-studio:theme";
const choices = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
  { id: "system", label: "System", Icon: Monitor },
] as const;

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch { /* Theme preference is optional. */ }
  return "system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): "light" | "dark" {
  return preference === "system" ? systemDark ? "dark" : "light" : preference;
}

function applyTheme(preference: ThemePreference, systemDark: boolean) {
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme = resolveTheme(preference, systemDark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", root.dataset.theme === "dark" ? "#13111C" : "#F8F7FC");
}

export function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);

  const updatePreference = useCallback((next: ThemePreference) => {
    try { localStorage.setItem(storageKey, next); } catch { /* Theme preference is optional. */ }
    applyTheme(next, window.matchMedia("(prefers-color-scheme: dark)").matches);
    setPreference(next);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyTheme(preference, media.matches);
    apply();
    if (preference !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);

  return [preference, updatePreference] as const;
}

function ThemeChoices({ preference, onChange, compact = false }: { preference: ThemePreference; onChange: (value: ThemePreference) => void; compact?: boolean }) {
  return <div className={`theme-choices ${compact ? "compact" : ""}`} role="group" aria-label="Appearance theme">
    {choices.map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={preference === id} className={preference === id ? "selected" : ""} onClick={() => onChange(id)} title={`${label} theme`}>
      <Icon aria-hidden="true" size={16} strokeWidth={1.8} /><span>{label}</span>
    </button>)}
  </div>;
}

export function ThemeSwitcher({ preference, onChange }: { preference: ThemePreference; onChange: (value: ThemePreference) => void }) {
  const active = choices.find(({ id }) => id === preference)!;
  const ActiveIcon = active.Icon;
  return <details className="theme-switcher">
    <summary aria-label={`Appearance: ${active.label}`} title={`Appearance: ${active.label}`}><ActiveIcon aria-hidden="true" size={17} /><span className="theme-switcher-label">Theme</span></summary>
    <ThemeChoices preference={preference} onChange={onChange} compact />
  </details>;
}

export function AppearanceSettings({ preference, onChange }: { preference: ThemePreference; onChange: (value: ThemePreference) => void }) {
  return <section className="appearance-card">
    <div><span className="eyebrow">TAMPILAN</span><h2>Appearance</h2><p>Pilih Light Purple, Dark Purple, atau ikuti perangkat.</p></div>
    <ThemeChoices preference={preference} onChange={onChange} />
  </section>;
}
