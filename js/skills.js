// Ranger skill tree: permanent, cross-playthrough upgrades bought with
// skill points earned from achievement unlocks (see AchievementManager.onUnlock
// in main.js). Persisted in localStorage the same way achievements.js does -
// a flat { points, levels } blob rather than per-playthrough state, so
// upgrades carry forward into every future run.
const SKILLS_KEY = "sdg15_skills";

export const SKILL_DEFS = [
  { id: "seedCapacity", name: "Bigger Seed Pouch", icon: "\u{1F331}", desc: "+5 max seeds per level.", maxLevel: 3 },
  { id: "waterCapacity", name: "Bigger Canteen", icon: "\u{1F4A7}", desc: "+15 max water per level.", maxLevel: 3 },
  { id: "irrigation", name: "Wider Irrigation", icon: "\u{1F30A}", desc: "+0.5 cell irrigation/dousing radius per level.", maxLevel: 2 },
  { id: "swiftStride", name: "Swift Stride", icon: "\u{1F97E}", desc: "+8% move speed per level.", maxLevel: 3 },
  { id: "quickRegen", name: "Quick Regen", icon: "\u{267B}\u{FE0F}", desc: "Faster seed regrowth and canteen refill per level.", maxLevel: 3 },
];

// Buying level N of a node costs N points, so maxing a 3-level node costs
// 1+2+3=6 points total - later levels cost progressively more.
function costForLevel(level) {
  return level;
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(SKILLS_KEY) || "{}");
    return { points: raw.points ?? 0, levels: raw.levels ?? {} };
  } catch {
    return { points: 0, levels: {} };
  }
}

export class SkillManager {
  constructor() {
    const data = load();
    this.points = data.points;
    this.levels = data.levels;
  }

  _persist() {
    localStorage.setItem(SKILLS_KEY, JSON.stringify({ points: this.points, levels: this.levels }));
  }

  levelOf(id) {
    return this.levels[id] || 0;
  }

  grantPoint(amount = 1) {
    this.points += amount;
    this._persist();
  }

  canUpgrade(id) {
    const def = SKILL_DEFS.find((d) => d.id === id);
    if (!def) return false;
    const level = this.levelOf(id);
    if (level >= def.maxLevel) return false;
    return this.points >= costForLevel(level + 1);
  }

  upgrade(id) {
    if (!this.canUpgrade(id)) return false;
    const level = this.levelOf(id);
    this.points -= costForLevel(level + 1);
    this.levels[id] = level + 1;
    this._persist();
    return true;
  }

  // Applies the cumulative effect of every purchased level onto a
  // PlayerController instance. Idempotent and safe to call repeatedly (once
  // right after construction, then again after every purchase) - each stat's
  // "base" value (as set by the level's own opts) is captured once on first
  // call and every subsequent call recomputes from that same base.
  applyAll(player) {
    if (player.baseMaxSeeds === undefined) player.baseMaxSeeds = player.maxSeeds;
    if (player.baseMaxWater === undefined) player.baseMaxWater = player.maxWater;
    if (player.baseSeedRegenTime === undefined) player.baseSeedRegenTime = player.seedRegenTime;
    if (player.baseWaterRegenRate === undefined) player.baseWaterRegenRate = player.waterRegenRate;

    player.maxSeeds = player.baseMaxSeeds + this.levelOf("seedCapacity") * 5;
    player.maxWater = player.baseMaxWater + this.levelOf("waterCapacity") * 15;
    player.waterRadius = 1 + this.levelOf("irrigation") * 0.5;
    player.moveSpeedMult = 1 + this.levelOf("swiftStride") * 0.08;
    const regenLevel = this.levelOf("quickRegen");
    player.seedRegenTime = Math.max(3, player.baseSeedRegenTime - regenLevel);
    player.waterRegenRate = player.baseWaterRegenRate + regenLevel;

    player.seeds = Math.min(player.seeds, player.maxSeeds);
    player.water = Math.min(player.water, player.maxWater);
  }
}

// Renders the skill list into two existing DOM elements and wires each
// "Upgrade" button to onUpgrade(id). Kept as a standalone function (rather
// than living in UI) so both the pre-game start screen and the in-game pause
// screen can share it without either needing a live Game/player instance -
// only the pause-screen caller also re-applies bonuses to the active player.
export function renderSkillTree(pointsEl, listEl, skillManager, onUpgrade) {
  pointsEl.textContent = `\u{1F33F} ${skillManager.points} skill point${skillManager.points === 1 ? "" : "s"} available`;
  listEl.innerHTML = "";
  for (const def of SKILL_DEFS) {
    const level = skillManager.levelOf(def.id);
    const maxed = level >= def.maxLevel;
    const cost = maxed ? null : costForLevel(level + 1);

    const row = document.createElement("div");
    row.className = "skill-row";

    const info = document.createElement("div");
    info.className = "skill-info";
    info.innerHTML = `
      <span class="skill-name">${def.icon} ${def.name} <span class="skill-level">Lv ${level}/${def.maxLevel}</span></span>
      <span class="skill-desc">${def.desc}</span>
    `;
    row.appendChild(info);

    const btn = document.createElement("button");
    btn.className = "btn-secondary skill-btn";
    if (maxed) {
      btn.textContent = "Maxed";
      btn.disabled = true;
    } else {
      btn.textContent = `Upgrade (${cost} pt${cost === 1 ? "" : "s"})`;
      btn.disabled = !skillManager.canUpgrade(def.id);
      btn.addEventListener("click", () => onUpgrade(def.id));
    }
    row.appendChild(btn);
    listEl.appendChild(row);
  }
}
