const FACTS = [
  "SDG 15 calls for the sustainable management of forests, combating desertification, and halting biodiversity loss by 2030.",
  "The world has lost about 420 million hectares of forest since 1990 through conversion to other land uses.",
  "Land degradation affects an estimated 1.5 billion people worldwide, reducing food and water security.",
  "Forests are home to more than 80% of all terrestrial species of animals, plants and insects.",
  "Every year, around 12 million hectares of productive land are lost to desertification and drought.",
  "Restoring degraded land can absorb carbon, recharge groundwater and rebuild habitats for wildlife.",
  "Protected areas now cover a growing share of the planet's key biodiversity sites - but gaps remain.",
  "Community forest management has been shown to reduce illegal logging and improve local livelihoods.",
  "Pollinators like bees and birds depend on healthy, connected habitats to keep ecosystems - and farms - productive.",
  "Land degradation neutrality means the amount of healthy land stays stable or improves over time, not shrinks.",
];

export class UI {
  constructor() {
    this.el = {
      hud: document.getElementById("hud"),
      forest: document.getElementById("stat-forest"),
      forestBar: document.getElementById("bar-forest"),
      bio: document.getElementById("stat-biodiversity"),
      bioBar: document.getElementById("bar-biodiversity"),
      day: document.getElementById("stat-day"),
      seeds: document.getElementById("stat-seeds"),
      water: document.getElementById("stat-water"),
      waterBar: document.getElementById("bar-water"),
      prompt: document.getElementById("prompt"),
      toasts: document.getElementById("toasts"),
      start: document.getElementById("start-screen"),
      victory: document.getElementById("victory-screen"),
      pause: document.getElementById("pause-screen"),
      finalStats: document.getElementById("final-stats"),
      crosshair: document.getElementById("crosshair"),
      treesPlanted: document.getElementById("stat-planted"),
      loggersStopped: document.getElementById("stat-confronted"),
      manual: document.getElementById("manual-screen"),
    };
    this.plantedCount = 0;
    this.confrontedCount = 0;
    this.lastDay = 1;
    this.factIndex = 0;
    this.wonAlready = false;
    this.manualOpen = false;
  }

  onPlay(cb) {
    document.getElementById("btn-play").addEventListener("click", cb);
  }

  onResume(cb) {
    document.getElementById("btn-resume").addEventListener("click", cb);
  }

  onRestart(cb) {
    document.getElementById("btn-restart").addEventListener("click", cb);
  }

  onManualOpen(cb) {
    document.getElementById("btn-manual-start").addEventListener("click", cb);
    document.getElementById("btn-manual-pause").addEventListener("click", cb);
  }

  onManualClose(cb) {
    document.getElementById("btn-manual-close").addEventListener("click", cb);
  }

  showManual() {
    this.manualOpen = true;
    this.el.manual.classList.remove("hidden");
    this.el.pause.classList.add("hidden");
  }

  hideManual() {
    this.manualOpen = false;
    this.el.manual.classList.add("hidden");
  }

  onPointerLock(locked) {
    this.el.pause.classList.toggle("hidden", locked || this.wonAlready || this.manualOpen);
    this.el.crosshair.classList.toggle("hidden", !locked);
    if (locked) {
      this.el.start.classList.add("hidden");
      this.el.hud.classList.remove("hidden");
    }
  }

  bumpPlanted() {
    this.plantedCount++;
  }

  bumpConfronted() {
    this.confrontedCount++;
  }

  toast(msg, duration = 2000) {
    const div = document.createElement("div");
    div.className = "toast";
    div.textContent = msg;
    this.el.toasts.appendChild(div);
    requestAnimationFrame(() => div.classList.add("show"));
    setTimeout(() => {
      div.classList.remove("show");
      setTimeout(() => div.remove(), 400);
    }, duration);
  }

  updatePrompt(target) {
    const map = {
      plant: "Press [E] to plant a sapling here",
      water: "Press [Q] to irrigate this land",
      confront: "Press [F] to confront the logger!",
    };
    if (target && map[target.type]) {
      this.el.prompt.textContent = map[target.type];
      this.el.prompt.classList.remove("hidden");
      this.el.prompt.classList.toggle("urgent", target.type === "confront");
    } else {
      this.el.prompt.classList.add("hidden");
    }
  }

  update({ forestPct, biodiversity, day, seeds, maxSeeds, water, maxWater }) {
    this.el.forest.textContent = `${forestPct.toFixed(1)}%`;
    this.el.forestBar.style.width = `${forestPct}%`;
    this.el.bio.textContent = `${biodiversity.toFixed(0)}%`;
    this.el.bioBar.style.width = `${biodiversity}%`;
    this.el.day.textContent = day;
    this.el.seeds.textContent = `${seeds}/${maxSeeds}`;
    this.el.water.textContent = `${water.toFixed(0)}%`;
    this.el.waterBar.style.width = `${(water / maxWater) * 100}%`;
    this.el.treesPlanted.textContent = this.plantedCount;
    this.el.loggersStopped.textContent = this.confrontedCount;

    if (day !== this.lastDay) {
      this.lastDay = day;
      this.toast(`Day ${day} — ${FACTS[this.factIndex % FACTS.length]}`, 6500);
      this.factIndex++;
    }
  }

  showVictory(stats) {
    if (this.wonAlready) return;
    this.wonAlready = true;
    this.el.finalStats.innerHTML = `
      <p>Forest cover restored to <strong>${stats.forestPct.toFixed(1)}%</strong></p>
      <p>Biodiversity index reached <strong>${stats.biodiversity.toFixed(0)}%</strong></p>
      <p>${this.plantedCount} trees planted &middot; ${this.confrontedCount} loggers stopped</p>
      <p>It took <strong>${stats.day}</strong> in-game days.</p>`;
    this.el.victory.classList.remove("hidden");
    document.exitPointerLock?.();
  }
}
