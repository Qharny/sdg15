// Difficulty levels. Each level tunes how fast the land decays/heals, how
// aggressive loggers are, how much the player starts with, and how far the
// forest/biodiversity stats need to climb to win - so newer players can
// clear an easy level before facing the original "hard" tuning.

export const LEVELS = [
  {
    id: "sapling",
    name: "Sapling Warden",
    tagline: "Easy — learn the ropes",
    goalText: "Reach 32% forest cover and 28% biodiversity.",
    winForestPct: 32,
    winBiodiversityPct: 28,
    loggerCount: 2,
    chopTime: 11,
    decayRate: 0.0035,
    growthRate: 0.02,
    desertSpreadInterval: 0.6,
    desertSpreadSampleRate: 0.012,
    desertSpreadAmount: 0.02,
    desertRadiusFactor: 0.16,
    forestRadiusFactor: 0.3,
    startSeeds: 20,
    maxSeeds: 45,
    seedRegenTime: 6,
    maxWater: 100,
    waterRegenRate: 8,
    waterDrainPerUse: 14,
  },
  {
    id: "grove",
    name: "Grove Guardian",
    tagline: "Medium — the valley pushes back",
    goalText: "Reach 45% forest cover and 42% biodiversity.",
    winForestPct: 45,
    winBiodiversityPct: 42,
    loggerCount: 3,
    chopTime: 8,
    decayRate: 0.005,
    growthRate: 0.015,
    desertSpreadInterval: 0.5,
    desertSpreadSampleRate: 0.016,
    desertSpreadAmount: 0.025,
    desertRadiusFactor: 0.2,
    forestRadiusFactor: 0.26,
    startSeeds: 16,
    maxSeeds: 34,
    seedRegenTime: 8,
    maxWater: 100,
    waterRegenRate: 6.5,
    waterDrainPerUse: 16,
  },
  {
    id: "restorer",
    name: "Land Restorer",
    tagline: "Hard — full restoration",
    goalText: "Reach 55% forest cover and 55% biodiversity.",
    winForestPct: 55,
    winBiodiversityPct: 55,
    loggerCount: 4,
    chopTime: 6.5,
    decayRate: 0.006,
    growthRate: 0.012,
    desertSpreadInterval: 0.4,
    desertSpreadSampleRate: 0.02,
    desertSpreadAmount: 0.03,
    desertRadiusFactor: 0.22,
    forestRadiusFactor: 0.24,
    startSeeds: 15,
    maxSeeds: 30,
    seedRegenTime: 9,
    maxWater: 100,
    waterRegenRate: 5.5,
    waterDrainPerUse: 18,
  },
];

const UNLOCK_KEY = "sdg15_unlockedLevel";
const PENDING_KEY = "sdg15_pendingLevel";

export function getUnlockedLevel() {
  const v = parseInt(localStorage.getItem(UNLOCK_KEY) ?? "0", 10);
  return Number.isFinite(v) ? Math.max(0, Math.min(v, LEVELS.length - 1)) : 0;
}

export function unlockLevel(index) {
  const clamped = Math.max(0, Math.min(index, LEVELS.length - 1));
  if (clamped > getUnlockedLevel()) localStorage.setItem(UNLOCK_KEY, String(clamped));
}

// Read-once flag left by the victory screen's "Next level"/"Replay" buttons
// so the level-select screen can jump straight to that level's confirm view
// after the page reload they trigger.
export function consumePendingLevel() {
  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  if (raw === null) return null;
  const v = parseInt(raw, 10);
  return Number.isFinite(v) ? v : null;
}

export function setPendingLevel(index) {
  sessionStorage.setItem(PENDING_KEY, String(index));
}
