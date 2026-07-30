import * as THREE from "three";
import { clamp, healthToColor, heightAt, randRange } from "./utils.js";
import { generateWorldFeatures, CellType } from "./worldgen.js";

const DESERT_THRESHOLD = 0.14;
const PLANTABLE_THRESHOLD = 0.16;
const MATURE_THRESHOLD = 0.72;
const GRASS_THRESHOLD = 0.5;
// Shrubs are fast, cheap ground cover - they hold land above desert/grass
// thresholds but are deliberately capped below MATURE_THRESHOLD so they never
// count as real forest cover or unlock animal habitat on their own.
const SHRUB_HEALTH_CAP = 0.6;

export class Terrain {
  constructor(scene, size = 46, cellSize = 4.2, opts = {}) {
    this.scene = scene;
    this.size = size;
    this.cellSize = cellSize;
    this.half = (size * cellSize) / 2;

    this.decayRate = opts.decayRate ?? 0.006;
    this.growthRate = opts.growthRate ?? 0.012;
    this.desertSpreadInterval = opts.desertSpreadInterval ?? 0.4;
    this.desertSpreadSampleRate = opts.desertSpreadSampleRate ?? 0.02;
    this.desertSpreadAmount = opts.desertSpreadAmount ?? 0.03;
    this.desertRadiusFactor = opts.desertRadiusFactor ?? 0.22;
    this.forestRadiusFactor = opts.forestRadiusFactor ?? 0.24;

    const { cellType, elevation } = generateWorldFeatures(size);
    this.cellType = cellType;
    this.elevation = elevation;

    this.health = new Float32Array(size * size);
    this._generateInitialHealth();
    this._computeNearWater();

    this._buildGroundMesh();
    this._buildWaterSurface();
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
        const idx = this.index(col, row);
        if (this.cellType[idx] !== CellType.LAND) {
          this.health[idx] = 0.1; // not simulated - water/mountain read their own color
          continue;
        }
        const dDesert = Math.hypot(col - desertCenter.x, row - desertCenter.y);
        const dForest = Math.hypot(col - forestCenter.x, row - forestCenter.y);
        let h;
        if (dDesert < size * this.desertRadiusFactor) {
          h = 0.03 + Math.random() * 0.05;
        } else if (dForest < size * this.forestRadiusFactor) {
          h = 0.78 + Math.random() * 0.2;
        } else {
          h = 0.22 + Math.random() * 0.28 - dDesert * 0.004;
        }
        this.health[idx] = clamp(h, 0.02, 1);
      }
    }
  }

  // Marks land cells within a couple of cells of water so the growth pass
  // can give riverside/lakeside land a passive boost - a strategic pull
  // toward the water without needing the player to actively irrigate it.
  _computeNearWater() {
    const { size } = this;
    this._nearWater = new Uint8Array(size * size);
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const idx = this.index(col, row);
        if (this.cellType[idx] !== CellType.LAND) continue;
        search:
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nc = col + dc, nr = row + dr;
            if (!this.inBounds(nc, nr)) continue;
            if (this.cellType[this.index(nc, nr)] === CellType.WATER) {
              this._nearWater[idx] = 1;
              break search;
            }
          }
        }
      }
    }
  }

  // A single continuous, smoothly-shaded mesh whose vertices align exactly
  // 1:1 with health-grid cells (vertex spacing == cellSize), so the ground
  // reads as rolling terrain with soft color gradients instead of a tiled
  // checkerboard of flat squares. Mountains/water add a per-cell elevation
  // offset on top of the base bump function.
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
      pos.setY(i, heightAt(x, z) + this.elevation[i]);
      const [r, g, b] = this.cellColor(i);
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

  // Health-grid color for land, or a fixed water/rock color for the two
  // non-simulated terrain types.
  cellColor(i) {
    const type = this.cellType[i];
    if (type === CellType.WATER) return [0.09, 0.32, 0.52];
    if (type === CellType.MOUNTAIN) {
      const t = clamp(this.elevation[i] / 7.5, 0, 1);
      const base = 0.42 + t * 0.3; // lighter/greyer near the peaks
      return [base, base * 0.96, base * 0.92];
    }
    return healthToColor(this.health[i]);
  }

  // A still, semi-transparent water plane sitting above the dipped ground
  // mesh wherever a cell is WATER - cellType never changes at runtime, so
  // this is built once and never touched again (unlike the grass/rock decor,
  // which reacts to health changes every frame).
  _buildWaterSurface() {
    const WATER_LEVEL_Y = -0.55;
    const count = this.size * this.size;
    const geo = new THREE.PlaneGeometry(this.cellSize * 1.08, this.cellSize * 1.08);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1f5f8b, transparent: true, opacity: 0.82, roughness: 0.15, metalness: 0.1,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // see the note on TreeManager.trunks in trees.js
    const dummy = new THREE.Object3D();
    let n = 0;
    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        if (this.cellType[this.index(col, row)] !== CellType.WATER) continue;
        const { x, z } = this.worldPos(col, row);
        dummy.position.set(x, WATER_LEVEL_Y, z);
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    this.waterSurface = mesh;
  }

  _buildDecor() {
    const count = this.size * this.size;
    const grassGeo = new THREE.IcosahedronGeometry(0.24, 0);
    const grassMat = new THREE.MeshLambertMaterial({ color: 0x3c8a34 });
    this.grass = new THREE.InstancedMesh(grassGeo, grassMat, count);
    this.grass.castShadow = false;
    this.grass.receiveShadow = false;
    this.grass.frustumCulled = false; // see the note on TreeManager.trunks in trees.js

    const rockGeo = new THREE.IcosahedronGeometry(0.3, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x8a8478 });
    this.rocks = new THREE.InstancedMesh(rockGeo, rockMat, count);
    this.rocks.castShadow = true;
    this.rocks.frustumCulled = false;

    this._decorDummy = new THREE.Object3D();
    this._decorSeed = new Float32Array(count);
    for (let i = 0; i < count; i++) this._decorSeed[i] = Math.random();

    this.scene.add(this.grass, this.rocks);
  }

  _updateDecorAt(idx) {
    const col = idx % this.size;
    const row = (idx / this.size) | 0;
    const { x, z } = this.worldPos(col, row);
    const y = heightAt(x, z) + this.elevation[idx];
    const type = this.cellType[idx];
    const h = this.health[idx];
    const seed = this._decorSeed[idx];
    const jitterX = (seed - 0.5) * this.cellSize * 0.7;
    const jitterZ = ((seed * 7.13) % 1 - 0.5) * this.cellSize * 0.7;

    // No grass on water or bare rock, obviously.
    const grassScale = type === CellType.LAND && h >= GRASS_THRESHOLD
      ? clamp((h - GRASS_THRESHOLD) / (1 - GRASS_THRESHOLD), 0, 1) * (0.6 + seed * 0.7)
      : 0;
    this._decorDummy.position.set(x + jitterX, y, z + jitterZ);
    this._decorDummy.rotation.y = seed * 6.283;
    this._decorDummy.scale.setScalar(grassScale);
    this._decorDummy.updateMatrix();
    this.grass.setMatrixAt(idx, this._decorDummy.matrix);

    // Rocks scatter on desert cells and much more densely on mountains -
    // water gets none.
    let rockScale = 0;
    if (type === CellType.MOUNTAIN) rockScale = 0.5 + seed * 0.9;
    else if (type === CellType.LAND && h < DESERT_THRESHOLD) rockScale = (0.4 + seed * 0.9) * (seed > 0.55 ? 1 : 0);
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

  // Ground height including mountain/water elevation - every entity
  // (player, trees, animals, loggers, poachers, projectiles, fire) should
  // read this instead of the bare heightAt() bump function so nothing floats
  // over a lake or sinks into a mountainside.
  groundHeight(x, z) {
    const { col, row } = this.cellAt(x, z);
    const elev = this.inBounds(col, row) ? this.elevation[this.index(col, row)] : 0;
    return heightAt(x, z) + elev;
  }

  getHealth(col, row) {
    if (!this.inBounds(col, row)) return 0;
    return this.health[this.index(col, row)];
  }

  // Mountains and water are permanent obstacles - not part of the
  // plantable/degradable simulation, and blocked for player movement.
  isBlocked(col, row) {
    if (!this.inBounds(col, row)) return true;
    return this.cellType[this.index(col, row)] !== CellType.LAND;
  }

  isDesert(col, row) {
    if (!this.inBounds(col, row) || this.cellType[this.index(col, row)] !== CellType.LAND) return false;
    return this.getHealth(col, row) < DESERT_THRESHOLD;
  }

  isPlantable(col, row) {
    if (!this.inBounds(col, row) || this.cellType[this.index(col, row)] !== CellType.LAND) return false;
    return this.getHealth(col, row) >= PLANTABLE_THRESHOLD;
  }

  isMature(col, row) {
    if (!this.inBounds(col, row) || this.cellType[this.index(col, row)] !== CellType.LAND) return false;
    return this.getHealth(col, row) >= MATURE_THRESHOLD;
  }

  adjustHealth(col, row, delta) {
    if (!this.inBounds(col, row)) return;
    const idx = this.index(col, row);
    if (this.cellType[idx] !== CellType.LAND) return;
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

  // Used by Endless mode to make the valley progressively harder to hold
  // the longer the player survives.
  escalate(factor = 1.08) {
    this.decayRate *= factor;
    this.desertSpreadAmount *= factor;
  }

  // Percentages are computed over LAND cells only - mountains and water are
  // permanent, un-restorable terrain and shouldn't quietly make win/collapse
  // conditions harder or easier than intended.
  forestCoverPct() {
    let mature = 0, land = 0;
    for (let i = 0; i < this.health.length; i++) {
      if (this.cellType[i] !== CellType.LAND) continue;
      land++;
      if (this.health[i] >= MATURE_THRESHOLD) mature++;
    }
    return land ? (mature / land) * 100 : 0;
  }

  desertPct() {
    let desert = 0, land = 0;
    for (let i = 0; i < this.health.length; i++) {
      if (this.cellType[i] !== CellType.LAND) continue;
      land++;
      if (this.health[i] < DESERT_THRESHOLD) desert++;
    }
    return land ? (desert / land) * 100 : 0;
  }

  update(dt, treeManager, envMultipliers = { growth: 1, decay: 1, desertSpread: 1 }) {
    this._tickAccum += dt;
    const { size } = this;

    // Passive decay/growth pass - cheap enough to run on the whole grid.
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const idx = this.index(col, row);
        if (this.cellType[idx] !== CellType.LAND) continue;
        const hasTree = treeManager.hasTreeAt(col, row);
        const nearWaterMul = this._nearWater[idx] ? 1.25 : 1;
        let h = this.health[idx];
        if (hasTree) {
          const isShrub = treeManager.getTypeAt(col, row) === "shrub";
          if (!isShrub) {
            h += this.growthRate * envMultipliers.growth * nearWaterMul * dt;
          } else if (h < SHRUB_HEALTH_CAP) {
            // Grows faster than a tree but stalls out at the cap.
            h += this.growthRate * 1.5 * envMultipliers.growth * nearWaterMul * dt;
          }
        } else {
          h -= this.decayRate * envMultipliers.decay * (this._nearWater[idx] ? 0.7 : 1) * dt;
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
    if (this._tickAccum > this.desertSpreadInterval) {
      this._tickAccum = 0;
      const samples = Math.round(size * size * this.desertSpreadSampleRate);
      for (let i = 0; i < samples; i++) {
        const col = (Math.random() * size) | 0;
        const row = (Math.random() * size) | 0;
        if (this.isDesert(col, row)) {
          const dc = ((Math.random() * 3) | 0) - 1;
          const dr = ((Math.random() * 3) | 0) - 1;
          const nc = col + dc, nr = row + dr;
          if (this.inBounds(nc, nr) && !treeManager.hasTreeAt(nc, nr)) {
            this.adjustHealth(nc, nr, -this.desertSpreadAmount * envMultipliers.desertSpread);
          }
        }
      }
    }

    if (this._dirty.size) {
      for (const idx of this._dirty) {
        const [r, g, b] = this.cellColor(idx);
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
