// Local-only leaderboard: every level clear and Endless survival gets
// recorded under whatever ranger name is currently set, all in localStorage
// (there's no backend). Export/import lets players compare runs by handing
// each other a JSON blob - a copy-paste "multiplayer" stand-in.
const LB_KEY = "sdg15_leaderboard";
const NAME_KEY = "sdg15_ranger_name";
const MAX_PER_LEVEL = 5;

export function getRangerName() {
  return localStorage.getItem(NAME_KEY) || "Ranger";
}

export function setRangerName(name) {
  const trimmed = (name || "").trim().slice(0, 24) || "Ranger";
  localStorage.setItem(NAME_KEY, trimmed);
  return trimmed;
}

function load() {
  try {
    const arr = JSON.parse(localStorage.getItem(LB_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function save(entries) {
  localStorage.setItem(LB_KEY, JSON.stringify(entries));
}

function isValidEntry(e) {
  return !!e && typeof e.name === "string" && typeof e.levelName === "string" &&
    typeof e.levelIndex === "number" && typeof e.days === "number";
}

// Keeps the list small: for each level, the fastest clears are kept (or, for
// Endless, the longest survivals) - the same "lower/higher is better" split
// levels.js already uses for best-result persistence.
function trim(entries) {
  const byLevel = new Map();
  for (const e of entries) {
    if (!byLevel.has(e.levelIndex)) byLevel.set(e.levelIndex, []);
    byLevel.get(e.levelIndex).push(e);
  }
  const out = [];
  for (const list of byLevel.values()) {
    list.sort((a, b) => (a.endless ? b.days - a.days : a.days - b.days));
    out.push(...list.slice(0, MAX_PER_LEVEL));
  }
  return out;
}

export function getEntries() {
  return trim(load()).sort((a, b) => a.levelIndex - b.levelIndex || (a.endless ? b.days - a.days : a.days - b.days));
}

export function recordEntry(entry) {
  const entries = load();
  entries.push({ ...entry, date: entry.date ?? new Date().toISOString().slice(0, 10) });
  save(trim(entries));
}

export function exportJSON() {
  return JSON.stringify(load(), null, 2);
}

export function downloadJSON() {
  const blob = new Blob([exportJSON()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sdg15-leaderboard.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function copyToClipboard() {
  await navigator.clipboard.writeText(exportJSON());
}

// Merges parsed entries into the existing leaderboard, silently skipping
// anything that doesn't look like a real entry - a malformed/partial paste
// shouldn't be able to corrupt the whole list. Throws with a user-facing
// message on total failure (bad JSON / wrong shape) so the caller can toast it.
export function importJSON(text) {
  let incoming;
  try {
    incoming = JSON.parse(text);
  } catch {
    throw new Error("That doesn't look like valid JSON.");
  }
  if (!Array.isArray(incoming)) throw new Error("Expected a JSON array of leaderboard entries.");
  const valid = incoming.filter(isValidEntry);
  if (valid.length === 0) throw new Error("No valid leaderboard entries found in that JSON.");

  const merged = [...load(), ...valid];
  const seen = new Set();
  const deduped = merged.filter((e) => {
    const key = `${e.name}|${e.levelIndex}|${e.days}|${e.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  save(trim(deduped));
  return valid.length;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Renders grouped-by-level tables into an existing container element.
export function renderLeaderboard(listEl) {
  const entries = getEntries();
  listEl.innerHTML = "";
  if (entries.length === 0) {
    listEl.innerHTML = `<p class="leaderboard-empty">No runs recorded yet — clear a level or survive Endless mode to show up here.</p>`;
    return;
  }
  const byLevel = new Map();
  for (const e of entries) {
    if (!byLevel.has(e.levelIndex)) byLevel.set(e.levelIndex, []);
    byLevel.get(e.levelIndex).push(e);
  }
  for (const [, list] of [...byLevel].sort((a, b) => a[0] - b[0])) {
    const section = document.createElement("div");
    section.className = "leaderboard-section";
    const label = list[0].endless ? "Days survived" : "Days to clear";
    const rows = list.map((e, i) =>
      `<tr><td>${i + 1}</td><td>${escapeHtml(e.name)}</td><td>${e.days}</td><td>${escapeHtml(e.date)}</td></tr>`
    ).join("");
    section.innerHTML = `
      <h4>${escapeHtml(list[0].levelName)}</h4>
      <table class="manual-table leaderboard-table">
        <tr><td>#</td><td>Ranger</td><td>${label}</td><td>Date</td></tr>
        ${rows}
      </table>`;
    listEl.appendChild(section);
  }
}
