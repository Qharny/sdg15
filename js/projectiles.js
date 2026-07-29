import * as THREE from "three";
import { heightAt } from "./utils.js";

const SPEED = 42;
const MAX_LIFE = 1.4;
const HIT_RADIUS = 1.3;
const CHEST_HEIGHT = 1.1;
const POOL_SIZE = 10;
const BURST_POOL_SIZE = 8;
const BURST_LIFE = 0.4;

function buildSeedMesh() {
  const geo = new THREE.IcosahedronGeometry(0.15, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xcdea6a,
    emissive: 0x9fd83a,
    emissiveIntensity: 1.1,
    roughness: 0.35,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  return mesh;
}

// Small radial-gradient sprite reused for both the muzzle-less "pop" of a
// miss hitting the ground and the brighter flash of a logger getting hit.
function makeBurstTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(210,255,150,0.9)");
  grad.addColorStop(1, "rgba(210,255,150,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export class ProjectileManager {
  constructor(scene, terrain, loggerManager) {
    this.scene = scene;
    this.terrain = terrain;
    this.loggerManager = loggerManager;
    this.onHit = null;
    this.onMiss = null;

    this.pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = buildSeedMesh();
      scene.add(mesh);
      this.pool.push({ mesh, active: false, velocity: new THREE.Vector3(), life: 0 });
    }

    const burstTex = makeBurstTexture();
    this.bursts = [];
    for (let i = 0; i < BURST_POOL_SIZE; i++) {
      const mat = new THREE.SpriteMaterial({
        map: burstTex, transparent: true, depthWrite: false, opacity: 0,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      scene.add(sprite);
      this.bursts.push({ sprite, life: 0, active: false });
    }
  }

  spawn(origin, direction) {
    const p = this.pool.find((p) => !p.active);
    if (!p) return;
    p.active = true;
    p.life = 0;
    p.mesh.position.copy(origin);
    p.velocity.copy(direction).normalize().multiplyScalar(SPEED);
    p.mesh.visible = true;
  }

  _burst(position, scale = 1.6) {
    const b = this.bursts.find((b) => !b.active);
    if (!b) return;
    b.active = true;
    b.life = 0;
    b.sprite.position.copy(position);
    b.sprite.scale.set(0.4, 0.4, 1);
    b.sprite.material.opacity = 0.9;
    b.sprite.visible = true;
    b._scale = scale;
  }

  update(dt) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life += dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.rotation.x += dt * 16;
      p.mesh.rotation.y += dt * 11;

      let hitLogger = null;
      for (const lg of this.loggerManager.loggers) {
        if (!lg.active || (lg.state !== "seeking" && lg.state !== "chopping")) continue;
        const base = lg.mesh.position;
        const dx = p.mesh.position.x - base.x;
        const dy = p.mesh.position.y - (base.y + CHEST_HEIGHT);
        const dz = p.mesh.position.z - base.z;
        if (dx * dx + dy * dy + dz * dz < HIT_RADIUS * HIT_RADIUS) { hitLogger = lg; break; }
      }

      const groundY = heightAt(p.mesh.position.x, p.mesh.position.z);
      const expired = p.life > MAX_LIFE || p.mesh.position.y < groundY - 0.2;

      if (hitLogger) {
        this.loggerManager.hitLogger(hitLogger);
        this._burst(p.mesh.position, 2.1);
        if (this.onHit) this.onHit(p.mesh.position.clone());
        p.active = false;
        p.mesh.visible = false;
      } else if (expired) {
        this._burst(p.mesh.position, 1.1);
        if (this.onMiss) this.onMiss(p.mesh.position.clone());
        p.active = false;
        p.mesh.visible = false;
      }
    }

    for (const b of this.bursts) {
      if (!b.active) continue;
      b.life += dt;
      const t = Math.min(1, b.life / BURST_LIFE);
      const scale = 0.4 + t * b._scale;
      b.sprite.scale.set(scale, scale, 1);
      b.sprite.material.opacity = 0.9 * (1 - t);
      if (t >= 1) {
        b.active = false;
        b.sprite.visible = false;
      }
    }
  }
}
