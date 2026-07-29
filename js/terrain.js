import * as THREE from "three";
import { clamp, healthToColor, heightAt } from "./utils.js";

const DESERT_THRESHOLD = 0.14;
const PLANTABLE_THRESHOLD = 0.16;
const MATURE_THRESHOLD = 0.72;

export class Terrain {
  constructor(scene, size = 46, cellSize = 4.2) {
    this.scene = scene;
    this.size = size;
    this.cellSize = cellSize;
    this.half = (size * cellSize) / 2;

    this.health = new Float32Array(size * size);
    this._generateInitialHealth();

    const geo = new THREE.PlaneGeometry(cellSize * 0.92, cellSize * 0.92);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, size * size);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const idx = this.index(col, row);
        const { x, z } = this.worldPos(col, row);
        dummy.position.set(x, heightAt(x, z), z);
        dummy.rotation.y = 0;
        dummy.updateMatrix();
        this.mesh.setMatrixAt(idx, dummy.matrix);
        const [r, g, b] = healthToColor(this.health[idx]);
        color.setRGB(r, g, b);
        this.mesh.setColorAt(idx, color);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);

    this._dirty = new Set();
    this._tickAccum = 0;
  }

  _generateInitialHealth() {
    const { size } = this;
    // A desert basin biased to one side, forest biased to the other,
    // scrub/degraded land in between - gives the player a clear mission.
    const desertCenter = { x: size * 0.28, y: size * 0.32 };
    const forestCenter = { x: size * 0.72, y: size * 0.68 };
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const dDesert = Math.hypot(col - desertCenter.x, row - desertCenter.y);
        const dForest = Math.hypot(col - forestCenter.x, row - forestCenter.y);
        let h;
        if (dDesert < size * 0.22) {
          h = 0.03 + Math.random() * 0.05;
        } else if (dForest < size * 0.24) {
          h = 0.78 + Math.random() * 0.2;
        } else {
          h = 0.22 + Math.random() * 0.28 - dDesert * 0.004;
        }
        this.health[this.index(col, row)] = clamp(h, 0.02, 1);
      }
    }
  }

  index(col, row) {
    return row * this.size + col;
  }

  inBounds(col, row) {
    return col >= 0 && row >= 0 && col < this.size && row < this.size;
  }

  worldPos(col, row) {
    return {
      x: col * this.cellSize - this.half + this.cellSize / 2,
      z: row * this.cellSize - this.half + this.cellSize / 2,
    };
  }

  cellAt(x, z) {
    const col = Math.floor((x + this.half) / this.cellSize);
    const row = Math.floor((z + this.half) / this.cellSize);
    return { col, row };
  }

  getHealth(col, row) {
    if (!this.inBounds(col, row)) return 0;
    return this.health[this.index(col, row)];
  }

  isDesert(col, row) {
    return this.getHealth(col, row) < DESERT_THRESHOLD;
  }

  isPlantable(col, row) {
    return this.getHealth(col, row) >= PLANTABLE_THRESHOLD;
  }

  isMature(col, row) {
    return this.getHealth(col, row) >= MATURE_THRESHOLD;
  }

  adjustHealth(col, row, delta) {
    if (!this.inBounds(col, row)) return;
    const idx = this.index(col, row);
    this.health[idx] = clamp(this.health[idx] + delta, 0.01, 1);
    this._dirty.add(idx);
  }

  waterAround(x, z, radiusCells = 1, amount = 0.22) {
    const { col, row } = this.cellAt(x, z);
    for (let r = -radiusCells; r <= radiusCells; r++) {
      for (let c = -radiusCells; c <= radiusCells; c++) {
        this.adjustHealth(col + c, row + r, amount * (r === 0 && c === 0 ? 1 : 0.5));
      }
    }
  }

  forestCoverPct() {
    let mature = 0;
    for (let i = 0; i < this.health.length; i++) {
      if (this.health[i] >= MATURE_THRESHOLD) mature++;
    }
    return (mature / this.health.length) * 100;
  }

  desertPct() {
    let desert = 0;
    for (let i = 0; i < this.health.length; i++) {
      if (this.health[i] < DESERT_THRESHOLD) desert++;
    }
    return (desert / this.health.length) * 100;
  }

  update(dt, treeManager) {
    this._tickAccum += dt;
    const { size } = this;

    // Passive decay/growth pass - cheap enough to run on the whole grid.
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const idx = this.index(col, row);
        const hasTree = treeManager.hasTreeAt(col, row);
        let h = this.health[idx];
        if (hasTree) {
          h += 0.012 * dt;
        } else {
          h -= 0.006 * dt;
        }
        h = clamp(h, 0.01, 1);
        if (Math.abs(h - this.health[idx]) > 0.0001) {
          this.health[idx] = h;
          this._dirty.add(idx);
        }
      }
    }

    // Desertification spread: sparse random sampling, not a full pass,
    // so it stays gentle and doesn't overwhelm an attentive player.
    if (this._tickAccum > 0.4) {
      this._tickAccum = 0;
      const samples = Math.round(size * size * 0.02);
      for (let i = 0; i < samples; i++) {
        const col = (Math.random() * size) | 0;
        const row = (Math.random() * size) | 0;
        if (this.isDesert(col, row)) {
          const dc = ((Math.random() * 3) | 0) - 1;
          const dr = ((Math.random() * 3) | 0) - 1;
          const nc = col + dc, nr = row + dr;
          if (this.inBounds(nc, nr) && !treeManager.hasTreeAt(nc, nr)) {
            this.adjustHealth(nc, nr, -0.03);
          }
        }
      }
    }

    if (this._dirty.size) {
      const color = new THREE.Color();
      for (const idx of this._dirty) {
        const [r, g, b] = healthToColor(this.health[idx]);
        color.setRGB(r, g, b);
        this.mesh.setColorAt(idx, color);
      }
      this.mesh.instanceColor.needsUpdate = true;
      this._dirty.clear();
    }
  }
}
