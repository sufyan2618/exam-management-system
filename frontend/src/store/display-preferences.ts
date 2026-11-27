const themes = ["system", "paper", "night", "contrast"] as const;


function readSetting(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function saveSetting(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Settings still apply for this page. */ }
}

export function applyTheme(theme: string | null) {
  const selected = themes.find((option) => option === theme) ?? "system";
  document.documentElement.dataset.theme = selected;
  return selected;
}

export function applyTextSize(size: string | null) {
  const selected = size === "large" ? "large" : "standard";
  document.documentElement.dataset.textSize = selected;
  return selected;
}

export function restorePreferences() {
  applyTheme(readSetting("workspace-theme"));
  applyTextSize(readSetting("workspace-text-size"));
}

