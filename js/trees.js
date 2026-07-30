import * as THREE from "three";
import { randRange } from "./utils.js";

const MAX_TREES = 900;
const LOBES = 3;

export class TreeManager {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;

    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.2, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
    this.trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, MAX_TREES);
    this.trunks.castShadow = true;
    this.trunks.count = 0;
    // InstancedMesh's default frustum-culling bounding sphere is computed
    // from the base geometry at the mesh's own local origin - it has no
    // idea instances are scattered across the whole map via per-instance
    // matrices. Left enabled, the entire mesh gets wrongly culled (all
    // trees vanish) whenever that origin-centered sphere falls outside the
    // camera frustum, e.g. looking away from the map center.
    this.trunks.frustumCulled = false;
    scene.add(this.trunks);

    // Canopy is built from several overlapping low-poly lobes per tree
    // instead of one perfect cone, so foliage reads as irregular/organic.
    const foliageGeo = new THREE.IcosahedronGeometry(1, 1);
    this.foliageLobes = [];
    for (let i = 0; i < LOBES; i++) {
      const hueJitter = 0.85 + i * 0.08;
      const mat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(0.16 * hueJitter, 0.5 * hueJitter, 0.2 * hueJitter),
      });
      const im = new THREE.InstancedMesh(foliageGeo, mat, MAX_TREES);
      im.castShadow = true;
      im.count = 0;
      im.frustumCulled = false; // see note on this.trunks above
      scene.add(im);
      this.foliageLobes.push(im);
    }

    this.cellToSlot = new Map(); // "col,row" -> slot index
    this.slots = []; // per-slot growth/variance state
    this.freeSlots = [];
    for (let i = 0; i < MAX_TREES; i++) {
      this.slots.push({
        col: -1, row: -1, growth: 0, active: false, type: "tree",
        swaySeed: Math.random() * Math.PI * 2,
        swaySpeed: randRange(0.5, 0.9),
        tilt: randRange(-0.05, 0.05),
        trunkScaleXZ: randRange(0.85, 1.2),
        heightScale: randRange(0.85, 1.35),
        lobes: Array.from({ length: LOBES }, () => ({
          ox: randRange(-0.45, 0.45),
          oz: randRange(-0.45, 0.45),
          oy: randRange(0.9, 1.7),
          scale: randRange(0.65, 1.05),
        })),
      });
      this.freeSlots.push(i);
    }
    this._dummy = new THREE.Object3D();
    this.activeSlots = new Set();
    this._time = 0;
  }

  key(col, row) {
    return col + "," + row;
  }

  hasTreeAt(col, row) {
    return this.cellToSlot.has(this.key(col, row));
  }

  plant(col, row, type = "tree") {
    const k = this.key(col, row);
    if (this.cellToSlot.has(k)) return false;
    if (this.freeSlots.length === 0) return false;
    const slot = this.freeSlots.pop();
    const s = this.slots[slot];
    s.col = col;
    s.row = row;
    s.growth = 0.08;
    s.active = true;
    s.type = type;
    this.cellToSlot.set(k, slot);
    this.activeSlots.add(slot);
    this.trunks.count = Math.max(this.trunks.count, slot + 1);
    for (const lobe of this.foliageLobes) lobe.count = Math.max(lobe.count, slot + 1);
    this._applyMatrix(slot);
    return true;
  }

  chop(col, row) {
    const k = this.key(col, row);
    const slot = this.cellToSlot.get(k);
    if (slot === undefined) return false;
    const s = this.slots[slot];
    s.active = false;
    s.growth = 0;
    this.cellToSlot.delete(k);
    this.freeSlots.push(slot);
    this.activeSlots.delete(slot);
    this._dummy.position.set(0, -999, 0);
    this._dummy.scale.set(0.001, 0.001, 0.001);
    this._dummy.updateMatrix();
    this.trunks.setMatrixAt(slot, this._dummy.matrix);
    for (const lobe of this.foliageLobes) lobe.setMatrixAt(slot, this._dummy.matrix);
    this.trunks.instanceMatrix.needsUpdate = true;
    for (const lobe of this.foliageLobes) lobe.instanceMatrix.needsUpdate = true;
    return true;
  }

  isMature(col, row) {
    const slot = this.cellToSlot.get(this.key(col, row));
    if (slot === undefined) return false;
    return this.slots[slot].growth >= 1;
  }

  // Shrubs are cheap, fast ground cover - they never become real forest, so
  // they're excluded from the "mature tree" count that gates animal spawns.
  matureCount() {
    let n = 0;
    for (const slot of this.activeSlots) {
      const s = this.slots[slot];
      if (s.growth >= 1 && s.type !== "shrub") n++;
    }
    return n;
  }

  liveCount() {
    return this.cellToSlot.size;
  }

  getTypeAt(col, row) {
    const slot = this.cellToSlot.get(this.key(col, row));
    return slot === undefined ? null : this.slots[slot].type;
  }

  _applyMatrix(slot) {
    const s = this.slots[slot];
    const { x, z } = this.terrain.worldPos(s.col, s.row);
    const y = this.terrain.groundHeight(x, z);
    const growth = s.growth;
    const sway = Math.sin(this._time * s.swaySpeed + s.swaySeed) * 0.05 * growth;
    const baseRotY = (s.col * 928371 + s.row * 12331) % 6.283;

    // Shrubs render as squat, trunk-less bushes so they read as ground
    // cover rather than a young tree - purely a scale trick, no extra geometry.
    const isShrub = s.type === "shrub";
    const heightMul = isShrub ? 0.4 : 1;
    const trunkMul = isShrub ? 0.15 : 1;
    const lobeMul = isShrub ? 0.8 : 1;

    this._dummy.position.set(x, y, z);
    this._dummy.rotation.set(s.tilt, baseRotY, s.tilt + sway * 0.4);
    this._dummy.scale.set(growth * s.trunkScaleXZ * trunkMul, growth * s.heightScale * heightMul, growth * s.trunkScaleXZ * trunkMul);
    this._dummy.updateMatrix();
    this.trunks.setMatrixAt(slot, this._dummy.matrix);

    for (let i = 0; i < LOBES; i++) {
      const lobe = s.lobes[i];
      this._dummy.position.set(
        x + lobe.ox * growth,
        y + lobe.oy * growth * s.heightScale * heightMul,
        z + lobe.oz * growth
      );
      this._dummy.rotation.set(0, baseRotY + i, sway);
      const ls = growth * lobe.scale * lobeMul;
      this._dummy.scale.set(ls, ls * 0.85, ls);
      this._dummy.updateMatrix();
      this.foliageLobes[i].setMatrixAt(slot, this._dummy.matrix);
    }
  }

  update(dt) {
    this._time += dt;
    if (this.activeSlots.size === 0) return;
    for (const slot of this.activeSlots) {
      const s = this.slots[slot];
      if (s.growth < 1) {
        const health = this.terrain.getHealth(s.col, s.row);
        const rate = 0.06 + health * 0.12;
        s.growth = Math.min(1, s.growth + rate * dt);
      }
      this._applyMatrix(slot);
    }
    this.trunks.instanceMatrix.needsUpdate = true;
    for (const lobe of this.foliageLobes) lobe.instanceMatrix.needsUpdate = true;
  }
}
