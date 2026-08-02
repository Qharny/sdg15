// Cumulative, cross-playthrough achievements persisted in localStorage.
// Deliberately event-driven (bumped from specific actions) rather than
// polled continuously, and surfaced purely as toasts - no dedicated screen.
const COUNTERS_KEY = "sdg15_counters";
const UNLOCKED_KEY = "sdg15_achievements";

const DEFAULT_COUNTERS = {
  planted: 0,
  loggersStopped: 0,
  poachersStopped: 0,
  firesExtinguished: 0,
  weedsCleared: 0,
  levelsCleared: 0,
  bestEndlessDays: 0,
  hitMaxSeeds: 0,
  hitPerfectBalance: 0,
};

const DEFS = [
  { id: "first_sapling", name: "First Sapling", desc: "Plant your first tree or shrub.", check: (c) => c.planted >= 1 },
  { id: "green_thumb", name: "Green Thumb", desc: "Plant 50 trees/shrubs across all your playthroughs.", check: (c) => c.planted >= 50 },
  { id: "forest_defender", name: "Forest Defender", desc: "Scare off 10 loggers.", check: (c) => c.loggersStopped >= 10 },
  { id: "ranger", name: "Ranger", desc: "Scare off 5 poachers.", check: (c) => c.poachersStopped >= 5 },
  { id: "firefighter", name: "Firefighter", desc: "Douse 5 wildfires.", check: (c) => c.firesExtinguished >= 5 },
  { id: "sapling_warden", name: "Sapling Warden", desc: "Restore the Sapling Warden valley.", check: (c) => c.levelsCleared >= 1 },
  { id: "grove_guardian", name: "Grove Guardian", desc: "Restore the Grove Guardian valley.", check: (c) => c.levelsCleared >= 2 },
  { id: "land_restorer", name: "Land Restorer", desc: "Restore the Land Restorer valley.", check: (c) => c.levelsCleared >= 3 },
  { id: "wetland_warden", name: "Wetland Warden", desc: "Restore the Wetland Marshes valley.", check: (c) => c.levelsCleared >= 4 },
  { id: "weed_puller", name: "Invasive Fighter", desc: "Clear 15 invasive weed patches.", check: (c) => c.weedsCleared >= 15 },
  { id: "survivor", name: "Survivor", desc: "Survive 10 days in Endless mode.", check: (c) => c.bestEndlessDays >= 10 },
  { id: "full_canteen", name: "No Seed Left Behind", desc: "Fill your seed pouch to capacity.", check: (c) => c.hitMaxSeeds >= 1 },
  { id: "perfect_balance", name: "Perfect Balance", desc: "Reach 50% forest cover and 50% biodiversity at once.", check: (c) => c.hitPerfectBalance >= 1 },
];

function loadCounters() {
  try {
    return { ...DEFAULT_COUNTERS, ...JSON.parse(localStorage.getItem(COUNTERS_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_COUNTERS };
  }
}

function loadUnlocked() {
  try {
    return new Set(JSON.parse(localStorage.getItem(UNLOCKED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export class AchievementManager {
  constructor() {
    this.counters = loadCounters();
    this.unlocked = loadUnlocked();
    this.onUnlock = null; // (def) => {}
  }

  _persist() {
    localStorage.setItem(COUNTERS_KEY, JSON.stringify(this.counters));
    localStorage.setItem(UNLOCKED_KEY, JSON.stringify([...this.unlocked]));
  }

  _checkAll() {
    for (const def of DEFS) {
      if (this.unlocked.has(def.id)) continue;
      if (def.check(this.counters)) {
        this.unlocked.add(def.id);
        this._persist();
        if (this.onUnlock) this.onUnlock(def);
      }
    }
  }

  _bump(key, amount = 1) {
    this.counters[key] = (this.counters[key] || 0) + amount;
    this._persist();
    this._checkAll();
  }

  _raiseTo(key, value) {
    if ((this.counters[key] || 0) >= value) return;
    this.counters[key] = value;
    this._persist();
    this._checkAll();
  }

  notePlanted() { this._bump("planted"); }
  noteLoggerStopped() { this._bump("loggersStopped"); }
  notePoacherStopped() { this._bump("poachersStopped"); }
  noteFireExtinguished() { this._bump("firesExtinguished"); }
  noteWeedCleared() { this._bump("weedsCleared"); }
  noteLevelCleared(count) { this._raiseTo("levelsCleared", count); }
  noteEndlessDays(days) { this._raiseTo("bestEndlessDays", days); }
  noteMaxSeeds() { this._raiseTo("hitMaxSeeds", 1); }
  notePerfectBalance() { this._raiseTo("hitPerfectBalance", 1); }
}
