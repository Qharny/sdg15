// Long-term seasons (tied to in-game day count) and short-term weather
// (randomized, real-time) combine into a single set of multipliers that
// terrain growth/decay/desertification and the player's canteen refill all
// read from - so "it's raining in winter" actually means something instead
// of being cosmetic.
import { randRange } from "./utils.js";

const SEASON_LENGTH_DAYS = 3;

export const SEASONS = [
  { name: "Spring", icon: "\u{1F338}", growth: 1.25, decay: 0.9, desertSpread: 0.85 },
  { name: "Summer", icon: "\u{2600}\u{FE0F}", growth: 1.0, decay: 1.1, desertSpread: 1.15 },
  { name: "Autumn", icon: "\u{1F342}", growth: 0.85, decay: 1.05, desertSpread: 1.0 },
  { name: "Winter", icon: "\u{2744}\u{FE0F}", growth: 0.55, decay: 0.65, desertSpread: 0.6 },
];

const WEATHER = {
  clear: { label: "Clear", icon: "\u{2600}\u{FE0F}", growth: 1, decay: 1, desertSpread: 1, waterRegen: 1, fireChance: 1 },
  rain: { label: "Rain", icon: "\u{1F327}\u{FE0F}", growth: 1.4, decay: 0.6, desertSpread: 0.5, waterRegen: 2.2, fireChance: 0 },
  drought: { label: "Drought", icon: "\u{1F525}", growth: 0.6, decay: 1.5, desertSpread: 1.8, waterRegen: 0.5, fireChance: 3.5 },
};

export class EnvironmentManager {
  constructor() {
    this.weatherState = "clear";
    this.weatherTimer = randRange(40, 65);
    this.seasonIndex = 0;
    this.onWeatherChange = null; // (state) => {}
    this.onSeasonChange = null; // (seasonDef) => {}
  }

  get season() {
    return SEASONS[this.seasonIndex];
  }

  get weather() {
    return WEATHER[this.weatherState];
  }

  _pickNextWeather() {
    const r = Math.random();
    if (r < 0.55) return "clear";
    if (r < 0.8) return "rain";
    return "drought";
  }

  update(dt, day) {
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      let next = this._pickNextWeather();
      if (next === this.weatherState) next = "clear";
      this.weatherState = next;
      this.weatherTimer = next === "clear" ? randRange(40, 70) : randRange(24, 40);
      if (this.onWeatherChange) this.onWeatherChange(next);
    }

    const idx = Math.floor((Math.max(1, day) - 1) / SEASON_LENGTH_DAYS) % SEASONS.length;
    if (idx !== this.seasonIndex) {
      this.seasonIndex = idx;
      if (this.onSeasonChange) this.onSeasonChange(SEASONS[idx]);
    }
  }

  getMultipliers() {
    const s = this.season, w = this.weather;
    return {
      growth: s.growth * w.growth,
      decay: s.decay * w.decay,
      desertSpread: s.desertSpread * w.desertSpread,
      waterRegen: w.waterRegen,
      fireChance: w.fireChance,
    };
  }

  weatherLabel() {
    return `${this.weather.icon} ${this.weather.label}`;
  }

  seasonLabel() {
    return `${this.season.icon} ${this.season.name}`;
  }
}
