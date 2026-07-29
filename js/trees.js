import * as THREE from "three";
import { heightAt } from "./utils.js";

const MAX_TREES = 900;

export class TreeManager {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;

    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2b });
    this.trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, MAX_TREES);
    this.trunks.castShadow = true;
    this.trunks.count = 0;
    scene.add(this.trunks);

    const foliageGeo = new THREE.ConeGeometry(1, 1.8, 7);
    foliageGeo.translate(0, 1.2, 0);
    const foliageMat = new THREE.MeshLambertMaterial({ color: 0x2f7d3a });
    this.foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, MAX_TREES);
    this.foliage.castShadow = true;
    this.foliage.count = 0;
    scene.add(this.foliage);

    this.cellToSlot = new Map(); // "col,row" -> slot index
    this.slots = []; // { col, row, growth, active }
    this.freeSlots = [];
    for (let i = 0; i < MAX_TREES; i++) {
      this.slots.push({ col: -1, row: -1, growth: 0, active: false });
      this.freeSlots.push(i);
    }
    this._dummy = new THREE.Object3D();
    this._growing = new Set();
  }

  key(col, row) {
    return col + "," + row;
  }

  hasTreeAt(col, row) {
    return this.cellToSlot.has(this.key(col, row));
  }

  plant(col, row) {
    const k = this.key(col, row);
    if (this.cellToSlot.has(k)) return false;
    if (this.freeSlots.length === 0) return false;
    const slot = this.freeSlots.pop();
    const s = this.slots[slot];
    s.col = col;
    s.row = row;
    s.growth = 0.08;
    s.active = true;
    this.cellToSlot.set(k, slot);
    this._growing.add(slot);
    this._applyMatrix(slot);
    this.trunks.count = Math.max(this.trunks.count, slot + 1);
    this.foliage.count = Math.max(this.foliage.count, slot + 1);
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
    this._growing.delete(slot);
    this._dummy.position.set(0, -999, 0);
    this._dummy.scale.set(0.001, 0.001, 0.001);
    this._dummy.updateMatrix();
    this.trunks.setMatrixAt(slot, this._dummy.matrix);
    this.foliage.setMatrixAt(slot, this._dummy.matrix);
    this.trunks.instanceMatrix.needsUpdate = true;
    this.foliage.instanceMatrix.needsUpdate = true;
    return true;
  }

  isMature(col, row) {
    const slot = this.cellToSlot.get(this.key(col, row));
    if (slot === undefined) return false;
    return this.slots[slot].growth >= 1;
  }

  matureCount() {
    let n = 0;
    for (const s of this.slots) if (s.active && s.growth >= 1) n++;
    return n;
  }

  liveCount() {
    return this.cellToSlot.size;
  }

  _applyMatrix(slot) {
    const s = this.slots[slot];
    const { x, z } = this.terrain.worldPos(s.col, s.row);
    const y = heightAt(x, z);
    const growth = s.growth;
    this._dummy.position.set(x, y, z);
    this._dummy.rotation.y = (s.col * 928371 + s.row * 12331) % 6.283;
    this._dummy.scale.set(growth, growth, growth);
    this._dummy.updateMatrix();
    this.trunks.setMatrixAt(slot, this._dummy.matrix);
    this.foliage.setMatrixAt(slot, this._dummy.matrix);
  }

  update(dt) {
    if (this._growing.size === 0) return;
    const done = [];
    for (const slot of this._growing) {
      const s = this.slots[slot];
      if (!s.active) { done.push(slot); continue; }
      const health = this.terrain.getHealth(s.col, s.row);
      const rate = 0.06 + health * 0.12;
      s.growth = Math.min(1, s.growth + rate * dt);
      this._applyMatrix(slot);
      if (s.growth >= 1) done.push(slot);
    }
    for (const slot of done) this._growing.delete(slot);
    this.trunks.instanceMatrix.needsUpdate = true;
    this.foliage.instanceMatrix.needsUpdate = true;
  }

  nearestTreeCell(x, z, maxDist = Infinity) {
    let best = null, bestD = maxDist;
    for (const [k, slot] of this.cellToSlot) {
      const s = this.slots[slot];
      const { x: tx, z: tz } = this.terrain.worldPos(s.col, s.row);
      const d = Math.hypot(tx - x, tz - z);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }
}
