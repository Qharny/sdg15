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
    poacherCount: 1,
    captureTime: 9,
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
    poacherCount: 2,
    captureTime: 7.5,
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
    poacherCount: 2,
    captureTime: 6,
  },
  {
    id: "wetland",
    name: "Wetland Marshes",
    tagline: "Special — the ground itself turns on you",
    goalText: "Reach 50% forest cover and 48% biodiversity. Watch the slopes when it rains.",
    winForestPct: 50,
    winBiodiversityPct: 48,
    loggerCount: 3,
    chopTime: 7,
    decayRate: 0.004,
    growthRate: 0.016,
    // Wetland ground barely desertifies on its own - the near-water growth
    // bonus and low decay make that the easy part. Mudslides are the real
    // threat instead (see terrain.js's mudslideEnabled pass).
    desertSpreadInterval: 0.8,
    desertSpreadSampleRate: 0.008,
    desertSpreadAmount: 0.015,
    desertRadiusFactor: 0.12,
    forestRadiusFactor: 0.28,
    mudslide: true,
    mudslideInterval: 8,
    mudslideChance: 0.4,
    mudslideRadius: 2,
    mudslideAmount: 0.24,
    startSeeds: 16,
    maxSeeds: 32,
    seedRegenTime: 7.5,
    maxWater: 100,
    waterRegenRate: 7,
    waterDrainPerUse: 16,
    poacherCount: 2,
    captureTime: 6.5,
  },
  {
    id: "endless",
    name: "Endless Vigil",
    tagline: "Endless — hold the line as long as you can",
    goalText: "There's no finish line. Survive as many days as you can as the valley grows harsher.",
    endless: true,
    collapseDesertPct: 85,
    escalateFactor: 1.05,
    winForestPct: 999,
    winBiodiversityPct: 999,
    loggerCount: 3,
    chopTime: 7,
    decayRate: 0.005,
    growthRate: 0.014,
    desertSpreadInterval: 0.5,
    desertSpreadSampleRate: 0.016,
    desertSpreadAmount: 0.022,
    desertRadiusFactor: 0.2,
    forestRadiusFactor: 0.27,
    startSeeds: 18,
    maxSeeds: 36,
    seedRegenTime: 7,
    maxWater: 100,
    waterRegenRate: 7,
    waterDrainPerUse: 15,
    poacherCount: 2,
    captureTime: 7,
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

const BEST_KEY_PREFIX = "sdg15_best_";
const ENDLESS_BEST_KEY = "sdg15_endless_best_days";

// Best result for a standard (non-endless) level is the fewest in-game days
// taken to win it - lower is better, so a first clear always "sets" a best.
export function getBestResult(levelIndex) {
  const raw = localStorage.getItem(BEST_KEY_PREFIX + levelIndex);
  if (raw === null) return null;
  const day = parseInt(raw, 10);
  return Number.isFinite(day) ? day : null;
}

export function recordResult(levelIndex, day) {
  const prev = getBestResult(levelIndex);
  if (prev === null || day < prev) {
    localStorage.setItem(BEST_KEY_PREFIX + levelIndex, String(day));
    return true; // new best
  }
  return false;
}

export function getBestEndlessDays() {
  const raw = localStorage.getItem(ENDLESS_BEST_KEY);
  const v = parseInt(raw ?? "0", 10);
  return Number.isFinite(v) ? v : 0;
}

export function recordEndlessDays(days) {
  const prev = getBestEndlessDays();
  if (days > prev) {
    localStorage.setItem(ENDLESS_BEST_KEY, String(days));
    return true;
  }
  return false;
}
