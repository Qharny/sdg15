import * as THREE from "three";

const IGNITE_CHECK_INTERVAL = 2.2;
const BASE_IGNITE_CHANCE = 0.0005; // per mature tree, per check, before weather multiplier
const BURN_DURATION = 9;
const BURN_DAMAGE_PER_SEC = 0.09;
const SPREAD_CHECK_INTERVAL = 1.6;
const SPREAD_CHANCE = 0.05; // per burning cell, per flammable neighbor, per spread check
const SPRITE_POOL_SIZE = 24;

function buildFlameTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,240,180,1)");
  grad.addColorStop(0.4, "rgba(255,140,40,0.9)");
  grad.addColorStop(1, "rgba(255,60,20,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
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
    this.burning = new Map(); // "col,row" -> { col, row, timer, slot }
    this.igniteAccum = 0;
    this.spreadAccum = 0;
    this.onIgnite = null;
    this.onExtinguish = null;
    this.onBurnedOut = null;

    const tex = buildFlameTexture();
    this._pool = [];
    for (let i = 0; i < SPRITE_POOL_SIZE; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      scene.add(sprite);
      this._pool.push({ sprite, used: false });
    }
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

  _grabSprite() {
    return this._pool.find((s) => !s.used);
  }

  _ignite(col, row) {
    const k = this.key(col, row);
    if (this.burning.has(k)) return;
    const slot = this._grabSprite();
    if (!slot) return;
    slot.used = true;
    const { x, z } = this.terrain.worldPos(col, row);
    slot.sprite.position.set(x, this.terrain.groundHeight(x, z) + 1.2, z);
    slot.sprite.scale.set(1.6, 1.6, 1);
    slot.sprite.visible = true;
    this.burning.set(k, { col, row, timer: BURN_DURATION, slot });
    if (this.onIgnite) this.onIgnite(col, row);
  }

  _clear(k, entry) {
    entry.slot.used = false;
    entry.slot.sprite.visible = false;
    entry.slot.sprite.material.opacity = 0;
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
      this.terrain.adjustHealth(entry.col, entry.row, -BURN_DAMAGE_PER_SEC * dt);

      if (entry.timer <= 0 || this.terrain.getHealth(entry.col, entry.row) <= 0.05) {
        if (this.treeManager.hasTreeAt(entry.col, entry.row)) {
          this.treeManager.chop(entry.col, entry.row);
          if (this.onBurnedOut) this.onBurnedOut();
        }
        this._clear(k, entry);
        continue;
      }

      const flicker = 0.65 + Math.sin(performance.now() * 0.012 + entry.col * 3.1) * 0.3;
      entry.slot.sprite.material.opacity = flicker;
      const s = 1.3 + Math.sin(performance.now() * 0.02 + entry.row) * 0.25;
      entry.slot.sprite.scale.set(s, s, 1);

      if (doSpread) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nc = entry.col + dc, nr = entry.row + dr;
            if (!this.treeManager.hasTreeAt(nc, nr)) continue;
            if (this.treeManager.getTypeAt(nc, nr) === "shrub") continue;
            if (this.isBurning(nc, nr)) continue;
            if (Math.random() < SPREAD_CHANCE) this._ignite(nc, nr);
          }
        }
      }
    }
  }
}
