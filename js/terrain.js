import * as THREE from "three";
import { clamp, healthToColor, heightAt, randRange } from "./utils.js";

const DESERT_THRESHOLD = 0.14;
const PLANTABLE_THRESHOLD = 0.16;
const MATURE_THRESHOLD = 0.72;
const GRASS_THRESHOLD = 0.5;

export class Terrain {
  constructor(scene, size = 46, cellSize = 4.2) {
    this.scene = scene;
    this.size = size;
    this.cellSize = cellSize;
    this.half = (size * cellSize) / 2;

    this.health = new Float32Array(size * size);
    this._generateInitialHealth();

    this._buildGroundMesh();
    this._buildDecor();
    this._refreshAllDecor();

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

  // A single continuous, smoothly-shaded mesh whose vertices align exactly
  // 1:1 with health-grid cells (vertex spacing == cellSize), so the ground
  // reads as rolling terrain with soft color gradients instead of a tiled
  // checkerboard of flat squares.
  _buildGroundMesh() {
    const { size, cellSize } = this;
    const span = (size - 1) * cellSize;
    const geo = new THREE.PlaneGeometry(span, span, size - 1, size - 1);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, heightAt(x, z));
      const [r, g, b] = healthToColor(this.health[i]);
      color.setRGB(r, g, b);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);
    this._colorAttr = geo.attributes.color;
    this._posAttr = pos;
  }

  _buildDecor() {
    const count = this.size * this.size;
    const grassGeo = new THREE.IcosahedronGeometry(0.24, 0);
    const grassMat = new THREE.MeshLambertMaterial({ color: 0x3c8a34 });
    this.grass = new THREE.InstancedMesh(grassGeo, grassMat, count);
    this.grass.castShadow = false;
    this.grass.receiveShadow = false;

    const rockGeo = new THREE.IcosahedronGeometry(0.3, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x8a8478 });
    this.rocks = new THREE.InstancedMesh(rockGeo, rockMat, count);
    this.rocks.castShadow = true;

    this._decorDummy = new THREE.Object3D();
    this._decorSeed = new Float32Array(count);
    for (let i = 0; i < count; i++) this._decorSeed[i] = Math.random();

    this.scene.add(this.grass, this.rocks);
  }

  _updateDecorAt(idx) {
    const col = idx % this.size;
    const row = (idx / this.size) | 0;
    const { x, z } = this.worldPos(col, row);
    const y = heightAt(x, z);
    const h = this.health[idx];
    const seed = this._decorSeed[idx];
    const jitterX = (seed - 0.5) * this.cellSize * 0.7;
    const jitterZ = ((seed * 7.13) % 1 - 0.5) * this.cellSize * 0.7;

    const grassScale = h >= GRASS_THRESHOLD ? clamp((h - GRASS_THRESHOLD) / (1 - GRASS_THRESHOLD), 0, 1) * (0.6 + seed * 0.7) : 0;
    this._decorDummy.position.set(x + jitterX, y, z + jitterZ);
    this._decorDummy.rotation.y = seed * 6.283;
    this._decorDummy.scale.setScalar(grassScale);
    this._decorDummy.updateMatrix();
    this.grass.setMatrixAt(idx, this._decorDummy.matrix);

    const rockScale = h < DESERT_THRESHOLD ? (0.4 + seed * 0.9) * (seed > 0.55 ? 1 : 0) : 0;
    this._decorDummy.position.set(x - jitterX, y, z - jitterZ);
    this._decorDummy.rotation.set(seed * 3, seed * 5, seed * 2);
    this._decorDummy.scale.setScalar(rockScale);
    this._decorDummy.updateMatrix();
    this.rocks.setMatrixAt(idx, this._decorDummy.matrix);
  }

  _refreshAllDecor() {
    for (let i = 0; i < this.health.length; i++) this._updateDecorAt(i);
    this.grass.instanceMatrix.needsUpdate = true;
    this.rocks.instanceMatrix.needsUpdate = true;
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
      for (const idx of this._dirty) {
        const [r, g, b] = healthToColor(this.health[idx]);
        this._colorAttr.setXYZ(idx, r, g, b);
        this._updateDecorAt(idx);
      }
      this._colorAttr.needsUpdate = true;
      this.grass.instanceMatrix.needsUpdate = true;
      this.rocks.instanceMatrix.needsUpdate = true;
      this._dirty.clear();
    }
  }
}
