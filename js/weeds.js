import * as THREE from "three";
import { randRange } from "./utils.js";

export const MAX_SHOOT_RANGE = 30;
const AIM_COS_THRESHOLD = 0.985;

const SPAWN_CHECK_INTERVAL = 5;
const SPREAD_CHECK_INTERVAL = 3.5;
const MAX_CONCURRENT_WEEDS = 18;
const DRAIN_PER_SEC = 0.018;
const CHOKE_FLOOR = 0.3; // weeds stop draining a cell once it's this degraded - they're a chokehold, not a kill

function buildWeedMesh() {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x6b3f7a });
  const matDark = new THREE.MeshLambertMaterial({ color: 0x4a2a58 });
  for (let i = 0; i < 3; i++) {
    const lobe = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26 + Math.random() * 0.1, 0), i === 1 ? matDark : mat);
    const a = (i / 3) * Math.PI * 2;
    lobe.position.set(Math.cos(a) * 0.22, 0.22 + Math.random() * 0.1, Math.sin(a) * 0.22);
    lobe.castShadow = true;
    group.add(lobe);
  }
  return group;
}

// Invasive weed patches: spawn on tended-but-not-mature land, slowly choke
// the cell's health toward a floor (never kill it outright the way fire
// does), and spread to neighboring land the same way fire spreads to
// flammable neighbors. The player's existing seed-pod slingshot (Click/F)
// doubles as the removal tool - no new controls needed, implemented via the
// same "huntable" interface LoggerManager/PoacherManager expose to
// ProjectileManager.
export class WeedManager {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.patches = new Map(); // "col,row" -> { col, row, mesh, idx }
    this.onSpawn = null;
    this.onCleared = null;

    this._spawnAccum = randRange(0, SPAWN_CHECK_INTERVAL);
    this._spreadAccum = 0;

    this._pool = [];
    for (let i = 0; i < MAX_CONCURRENT_WEEDS; i++) {
      const mesh = buildWeedMesh();
      mesh.visible = false;
      scene.add(mesh);
      this._pool.push(mesh);
    }
    this._freeIdx = [];
    for (let i = MAX_CONCURRENT_WEEDS - 1; i >= 0; i--) this._freeIdx.push(i);
  }

  key(col, row) {
    return col + "," + row;
  }

  count() {
    return this.patches.size;
  }

  activeCells() {
    return [...this.patches.values()].map((e) => ({ col: e.col, row: e.row }));
  }

  // Weeds take root on land that's healthy enough to hold them but not yet
  // real mature forest (a tree's mature canopy shades them out) - so they
  // pressure the mid-recovery band the player is actively trying to grow.
  _isInfestable(col, row) {
    if (!this.terrain.inBounds(col, row) || this.terrain.isBlocked(col, row)) return false;
    if (this.patches.has(this.key(col, row))) return false;
    if (this.terrain.isMature(col, row)) return false;
    return this.terrain.getHealth(col, row) > CHOKE_FLOOR + 0.05;
  }

  _spawnAt(col, row) {
    if (this._freeIdx.length === 0) return;
    const poolIdx = this._freeIdx.pop();
    const { x, z } = this.terrain.worldPos(col, row);
    const y = this.terrain.groundHeight(x, z);
    const mesh = this._pool[poolIdx];
    mesh.position.set(x, y, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.visible = true;
    this.patches.set(this.key(col, row), { col, row, mesh, poolIdx });
    if (this.onSpawn) this.onSpawn(col, row);
  }

  _clear(k, entry) {
    entry.mesh.visible = false;
    this._freeIdx.push(entry.poolIdx);
    this.patches.delete(k);
  }

  // Generic "huntable" interface shared with LoggerManager/PoacherManager so
  // ProjectileManager can treat all three threat types the same way.
  huntableUnits() {
    return [...this.patches.values()];
  }

  hit(patch) {
    const k = this.key(patch.col, patch.row);
    if (!this.patches.has(k)) return false;
    this._clear(k, patch);
    if (this.onCleared) this.onCleared();
    return true;
  }

  findAimedTarget(originPos, forwardDir, maxRange = MAX_SHOOT_RANGE) {
    let best = null, bestDist = maxRange;
    const toPatch = new THREE.Vector3();
    for (const entry of this.patches.values()) {
      toPatch.copy(entry.mesh.position).sub(originPos);
      const dist = toPatch.length();
      if (dist > maxRange || dist < 0.001) continue;
      toPatch.normalize();
      if (toPatch.dot(forwardDir) < AIM_COS_THRESHOLD) continue;
      if (dist < bestDist) { bestDist = dist; best = entry; }
    }
    return best;
  }

  update(dt, weedPressureMult = 1) {
    for (const entry of this.patches.values()) {
      if (this.terrain.getHealth(entry.col, entry.row) > CHOKE_FLOOR) {
        this.terrain.adjustHealth(entry.col, entry.row, -DRAIN_PER_SEC * weedPressureMult * dt);
      }
      const bob = Math.sin(performance.now() * 0.002 + entry.col * 3.1) * 0.03;
      entry.mesh.position.y = this.terrain.groundHeight(entry.mesh.position.x, entry.mesh.position.z) + 0.24 + bob;
    }

    this._spawnAccum += dt;
    if (this._spawnAccum > SPAWN_CHECK_INTERVAL) {
      this._spawnAccum = 0;
      if (weedPressureMult > 0 && this.patches.size < MAX_CONCURRENT_WEEDS && Math.random() < 0.5 * weedPressureMult) {
        const { size } = this.terrain;
        for (let tries = 0; tries < 12; tries++) {
          const col = (Math.random() * size) | 0;
          const row = (Math.random() * size) | 0;
          if (this._isInfestable(col, row)) { this._spawnAt(col, row); break; }
        }
      }
    }

    this._spreadAccum += dt;
    if (this._spreadAccum > SPREAD_CHECK_INTERVAL) {
      this._spreadAccum = 0;
      if (this.patches.size < MAX_CONCURRENT_WEEDS) {
        for (const entry of [...this.patches.values()]) {
          if (Math.random() > 0.22 * weedPressureMult) continue;
          const dc = ((Math.random() * 3) | 0) - 1;
          const dr = ((Math.random() * 3) | 0) - 1;
          const nc = entry.col + dc, nr = entry.row + dr;
          if (this._isInfestable(nc, nr)) { this._spawnAt(nc, nr); break; }
        }
      }
    }
  }
}
