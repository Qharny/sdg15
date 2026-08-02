// Accessibility settings: a colorblind-safe terrain/threat palette and a
// high-contrast HUD mode, both persisted in localStorage and applied as
// classes on <body> so CSS (style.css) and the terrain color ramp
// (utils.js's healthToColor) can both read them.
const KEY = "sdg15_accessibility";

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { colorblind: !!raw.colorblind, highContrast: !!raw.highContrast };
  } catch {
    return { colorblind: false, highContrast: false };
  }
}

let state = load();

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function isColorblindMode() {
  return state.colorblind;
}

export function isHighContrastMode() {
  return state.highContrast;
}

export function applyAccessibilityClasses() {
  document.body.classList.toggle("colorblind-mode", state.colorblind);
  document.body.classList.toggle("high-contrast-mode", state.highContrast);
}

export function setColorblind(on) {
  state.colorblind = !!on;
  save();
  applyAccessibilityClasses();
}

export function setHighContrast(on) {
  state.highContrast = !!on;
  save();
  applyAccessibilityClasses();
}

// Colorblind-safe swap for the minimap/HUD threat-dot colors (red/orange/
// yellow read poorly for red-green color blindness) - an Okabe-Ito-derived
// qualitative set that stays distinct under all common forms of CVD.
const THREAT_COLORS = {
  logger: { normal: "#ff5555", colorblind: "#0072B2" },
  poacher: { normal: "#ffaa33", colorblind: "#E69F00" },
  fire: { normal: "#ffcc33", colorblind: "#F0E442" },
  weed: { normal: "#c060e0", colorblind: "#CC79A7" },
};

export function threatColor(kind) {
  const c = THREAT_COLORS[kind];
  if (!c) return "#ffffff";
  return state.colorblind ? c.colorblind : c.normal;
}

// Wires two checkboxes already present in the DOM (see #settings-screen in
// index.html) to these settings, reflecting current state on mount and
// applying+persisting immediately on change - no separate "Save" step.
export function mountAccessibilitySettings(colorblindCheckbox, highContrastCheckbox) {
  colorblindCheckbox.checked = state.colorblind;
  highContrastCheckbox.checked = state.highContrast;
  colorblindCheckbox.addEventListener("change", () => setColorblind(colorblindCheckbox.checked));
  highContrastCheckbox.addEventListener("change", () => setHighContrast(highContrastCheckbox.checked));
}
