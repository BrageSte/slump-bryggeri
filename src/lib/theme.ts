import { storage } from "./storage.ts";

export type ThemePreference = "system" | "light" | "dark";
const KEY = "slump.theme";

export function getThemePreference(): ThemePreference {
  const value = storage.get(KEY);
  return value === "light" || value === "dark" ? value : "system";
}

export function applyTheme(preference: ThemePreference = getThemePreference()): void {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
  const dark = preference === "dark" || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#121916" : "#f4f1e8");
}

export function setThemePreference(preference: ThemePreference): void {
  storage.set(KEY, preference === "system" ? null : preference);
  applyTheme(preference);
}
