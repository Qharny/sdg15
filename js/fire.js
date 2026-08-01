import * as THREE from "three";

const IGNITE_CHECK_INTERVAL = 2.2;
const BASE_IGNITE_CHANCE = 0.0005; // per mature tree, per check, before weather multiplier
const BURN_DURATION = 9;
const BURN_DAMAGE_PER_SEC = 0.09;
const SPREAD_CHECK_INTERVAL = 1.6;
const SPREAD_CHANCE = 0.05; // per burning cell, per flammable neighbor, per spread check
const MAX_CONCURRENT_FIRES = 24;

function buildFlameTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,225,1)");
  grad.addColorStop(0.22, "rgba(255,215,80,1)");
  grad.addColorStop(0.55, "rgba(255,120,30,0.95)");
  grad.addColorStop(1, "rgba(255,40,10,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function buildSmokeTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(60,58,55,0.55)");
  grad.addColorStop(0.5, "rgba(50,48,46,0.32)");
  grad.addColorStop(1, "rgba(40,40,40,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function makeSpritePool(scene, count, tex, { additive = false } = {}) {
  const pool = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0,
      toneMapped: false, // keep flames vivid regardless of scene tone mapping
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    scene.add(sprite);
    pool.push(sprite);
  }
  return pool;
}

// Wildfire hazard: dry, mature trees can catch fire (much more likely during
// a drought), burn their host cell's health down, try to spread to
// neighboring trees, and kill the tree outright if left to burn out. The
// player's existing irrigate action (Q) doubles as the extinguisher - no new
// controls needed.
export class FireManager {
  constructor(scene, terrain, treeManager) {
    this.scene = scene;
    this.terrain = terrain;
    this.treeManager = treeManager;
    this.burning = new Map(); // "col,row" -> { col, row, timer, idx, x, z, groundY, top, age }
    this.igniteAccum = 0;
    this.spreadAccum = 0;
    this.onIgnite = null;
    this.onExtinguish = null;
    this.onBurnedOut = null;

    const flameTex = buildFlameTexture();
    const smokeTex = buildSmokeTexture();
    // Each active fire uses a small cluster of sprites - a low flame that
    // wraps the trunk/lower foliage, a high flame that pokes out above the
    // canopy silhouette, and a smoke puff that drifts upward - so the fire
    // reads clearly instead of being buried inside/behind the tree geometry.
    this._flameLow = makeSpritePool(scene, MAX_CONCURRENT_FIRES, flameTex, { additive: true });
    this._flameHigh = makeSpritePool(scene, MAX_CONCURRENT_FIRES, flameTex, { additive: true });
    this._smoke = makeSpritePool(scene, MAX_CONCURRENT_FIRES, smokeTex);
    this._freeIdx = [];
    for (let i = MAX_CONCURRENT_FIRES - 1; i >= 0; i--) this._freeIdx.push(i);
  }

  key(col, row) {
    return col + "," + row;
  }

  isBurning(col, row) {
    return this.burning.has(this.key(col, row));
  }

  count() {
    return this.burning.size;
  }

  activeCells() {
    return [...this.burning.values()].map((e) => ({ col: e.col, row: e.row }));
  }

  _ignite(col, row) {
    const k = this.key(col, row);
    if (this.burning.has(k)) return;
    if (this._freeIdx.length === 0) return;
    const idx = this._freeIdx.pop();

    const { x, z } = this.terrain.worldPos(col, row);
    const groundY = this.terrain.groundHeight(x, z);
    const top = this.treeManager.canopyTop(col, row);

    const low = this._flameLow[idx];
    low.position.set(x, groundY + top * 0.32, z);
    low.scale.set(2.1, 2.1, 1);
    low.material.opacity = 1;
    low.visible = true;

    const high = this._flameHigh[idx];
    high.position.set(x, groundY + top * 0.98, z);
    high.scale.set(1.5, 1.9, 1);
    high.material.opacity = 1;
    high.visible = true;

    const smoke = this._smoke[idx];
    smoke.position.set(x, groundY + top * 1.15, z);
    smoke.scale.set(2.2, 2.2, 1);
    smoke.material.opacity = 0.5;
    smoke.visible = true;

    this.burning.set(k, { col, row, timer: BURN_DURATION, idx, x, z, groundY, top, age: 0 });
    if (this.onIgnite) this.onIgnite(col, row);
  }

  _clear(k, entry) {
    this._flameLow[entry.idx].visible = false;
    this._flameLow[entry.idx].material.opacity = 0;
    this._flameHigh[entry.idx].visible = false;
    this._flameHigh[entry.idx].material.opacity = 0;
    this._smoke[entry.idx].visible = false;
    this._smoke[entry.idx].material.opacity = 0;
    this._freeIdx.push(entry.idx);
    this.burning.delete(k);
  }

  // Called by the player's irrigate action - returns true if a fire was here.
  extinguishAt(x, z) {
    const { col, row } = this.terrain.cellAt(x, z);
    const k = this.key(col, row);
    const entry = this.burning.get(k);
    if (!entry) return false;
    this._clear(k, entry);
    if (this.onExtinguish) this.onExtinguish();
    return true;
  }

  update(dt, fireChanceMult = 1) {
    this.igniteAccum += dt;
    if (this.igniteAccum > IGNITE_CHECK_INTERVAL) {
      this.igniteAccum = 0;
      if (fireChanceMult > 0) {
        for (const slot of this.treeManager.cellToSlot.values()) {
          const s = this.treeManager.slots[slot];
          if (s.type === "shrub" || s.growth < 0.5) continue;
          if (this.isBurning(s.col, s.row)) continue;
          if (Math.random() < BASE_IGNITE_CHANCE * fireChanceMult) this._ignite(s.col, s.row);
        }
      }
    }

    this.spreadAccum += dt;
    const doSpread = this.spreadAccum > SPREAD_CHECK_INTERVAL;
    if (doSpread) this.spreadAccum = 0;

    for (const [k, entry] of [...this.burning]) {
      entry.timer -= dt;
      entry.age += dt;
      this.terrain.adjustHealth(entry.col, entry.row, -BURN_DAMAGE_PER_SEC * dt);

      if (entry.timer <= 0 || this.terrain.getHealth(entry.col, entry.row) <= 0.05) {
        if (this.treeManager.hasTreeAt(entry.col, entry.row)) {
          this.treeManager.chop(entry.col, entry.row);
          if (this.onBurnedOut) this.onBurnedOut();
        }
        this._clear(k, entry);
        continue;
      }

      const t = performance.now() * 0.001;
      const low = this._flameLow[entry.idx];
      const lowFlicker = 0.75 + Math.sin(t * 7 + entry.col * 3.1) * 0.2 + Math.sin(t * 17 + entry.row) * 0.08;
      low.material.opacity = Math.min(1, lowFlicker);
      const lowScale = 1.9 + Math.sin(t * 9 + entry.row * 1.7) * 0.35;
      low.scale.set(lowScale, lowScale * 1.05, 1);

      const high = this._flameHigh[entry.idx];
      const highFlicker = 0.65 + Math.sin(t * 8.5 + entry.row * 2.3) * 0.25;
      high.material.opacity = Math.min(1, highFlicker);
      const highScaleX = 1.3 + Math.sin(t * 11 + entry.col) * 0.25;
      const highScaleY = 1.7 + Math.cos(t * 9 + entry.col * 1.3) * 0.3;
      high.scale.set(highScaleX, highScaleY, 1);
      high.position.y = entry.groundY + entry.top * (0.98 + Math.sin(t * 10 + entry.row) * 0.03);

      const smoke = this._smoke[entry.idx];
      const rise = (entry.age % 3) / 3; // loops so the puff doesn't drift away forever
      smoke.position.y = entry.groundY + entry.top * 1.1 + rise * 3.5;
      const smokeScale = 1.8 + rise * 2.2;
      smoke.scale.set(smokeScale, smokeScale, 1);
      smoke.material.opacity = 0.45 * (1 - rise);
    }
  }
}
