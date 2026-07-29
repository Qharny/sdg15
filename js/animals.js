import * as THREE from "three";
import { heightAt, randRange, clamp } from "./utils.js";

const MAX_ANIMALS = 26;
const SPECIES = [
  { name: "deer", color: 0x8a5a34, scale: 0.55, speed: 2.4 },
  { name: "rabbit", color: 0xcfc2a8, scale: 0.3, speed: 3.1 },
  { name: "fox", color: 0xb5501f, scale: 0.42, speed: 3.4 },
];

function buildCritterMesh(species) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: species.color });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.5, 3, 6), bodyMat);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.4;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), bodyMat);
  head.position.set(0.55, 0.55, 0);
  head.castShadow = true;
  group.add(body, head);
  group.scale.setScalar(species.scale);
  return group;
}

export class AnimalManager {
  constructor(scene, terrain, treeManager) {
    this.scene = scene;
    this.terrain = terrain;
    this.treeManager = treeManager;
    this.animals = [];
    this.spawnCooldown = 0;
  }

  capacity() {
    const mature = this.treeManager.matureCount();
    return clamp(Math.floor(mature / 6), 0, MAX_ANIMALS);
  }

  count() {
    return this.animals.length;
  }

  biodiversityIndex() {
    const cap = MAX_ANIMALS;
    return clamp((this.animals.length / cap) * 100, 0, 100);
  }

  _pickHomeCell() {
    const { size } = this.terrain;
    for (let tries = 0; tries < 24; tries++) {
      const col = (Math.random() * size) | 0;
      const row = (Math.random() * size) | 0;
      if (this.terrain.isMature(col, row) && this.treeManager.hasTreeAt(col, row)) {
        return { col, row };
      }
    }
    return null;
  }

  spawnOne() {
    if (this.animals.length >= this.capacity()) return;
    const home = this._pickHomeCell();
    if (!home) return;
    const species = SPECIES[(Math.random() * SPECIES.length) | 0];
    const mesh = buildCritterMesh(species);
    const { x, z } = this.terrain.worldPos(home.col, home.row);
    mesh.position.set(x, heightAt(x, z), z);
    this.scene.add(mesh);
    this.animals.push({
      mesh,
      species,
      home,
      target: new THREE.Vector3(x, 0, z),
      fleeing: false,
      fleeTimer: 0,
      pauseTimer: randRange(0.5, 2),
    });
  }

  _newWanderTarget(a) {
    const { x: hx, z: hz } = this.terrain.worldPos(a.home.col, a.home.row);
    const angle = Math.random() * Math.PI * 2;
    const r = randRange(2, 9);
    a.target.set(hx + Math.cos(angle) * r, 0, hz + Math.sin(angle) * r);
  }

  update(dt, loggerManager, playerPos) {
    this.spawnCooldown -= dt;
    if (this.spawnCooldown <= 0) {
      this.spawnCooldown = randRange(2.5, 5);
      this.spawnOne();
    }

    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      const p = a.mesh.position;
      const { col, row } = this.terrain.cellAt(p.x, p.z);
      const health = this.terrain.getHealth(col, row);

      let threatened = health < 0.35;
      if (loggerManager) {
        for (const lg of loggerManager.loggers) {
          if (lg.active && lg.mesh.position.distanceTo(p) < 7) { threatened = true; break; }
        }
      }

      if (threatened && !a.fleeing) {
        a.fleeing = true;
        a.fleeTimer = randRange(4, 7);
        const away = p.clone().sub(playerPos.clone().setY(0));
        if (away.lengthSq() < 0.01) away.set(1, 0, 0);
        away.normalize().multiplyScalar(14);
        a.target.set(p.x + away.x, 0, p.z + away.z);
      }

      if (a.fleeing) {
        a.fleeTimer -= dt;
        if (a.fleeTimer <= 0) {
          this.scene.remove(a.mesh);
          this.animals.splice(i, 1);
          continue;
        }
      } else {
        a.pauseTimer -= dt;
        const distToTarget = Math.hypot(a.target.x - p.x, a.target.z - p.z);
        if (distToTarget < 0.4 && a.pauseTimer <= 0) {
          this._newWanderTarget(a);
          a.pauseTimer = randRange(1, 3);
        }
      }

      const dx = a.target.x - p.x, dz = a.target.z - p.z;
      const dist = Math.hypot(dx, dz);
      const spd = a.species.speed * (a.fleeing ? 1.8 : 1);
      if (dist > 0.05) {
        const step = Math.min(dist, spd * dt);
        p.x += (dx / dist) * step;
        p.z += (dz / dist) * step;
        a.mesh.rotation.y = Math.atan2(dx, dz);
      }
      p.y = heightAt(p.x, p.z);
    }
  }
}
