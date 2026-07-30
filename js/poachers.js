import * as THREE from "three";
import { randRange } from "./utils.js";

export const MAX_POACHER_SHOOT_RANGE = 34;
const AIM_COS_THRESHOLD = 0.985;

const SEEKING_LINES = [
  "Something's moving out there...",
  "Easy money in this valley.",
  "Nobody's around to stop me.",
  "That one'll fetch a good price.",
];
const CAPTURING_LINES = [
  "Gotcha, stay still...",
  "Almost got the net closed!",
  "Easy now, easy...",
];
const CAPTURED_LINES = ["Got one!", "That's a catch.", "Ha, too slow!"];
const CONFRONTED_LINES = [
  "Alright, I'm out!",
  "Not worth getting hit for.",
  "Fine, I'm leaving!",
  "You win this one.",
];

function buildPoacherMesh() {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x4a4a32 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.9, 3, 6), mat);
  body.position.y = 0.95;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshLambertMaterial({ color: 0xd9a066 }));
  head.position.y = 1.65;
  head.castShadow = true;
  const cage = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.32, 0.32),
    new THREE.MeshLambertMaterial({ color: 0x2b2b2b, wireframe: true })
  );
  cage.position.set(0.42, 1.05, 0);
  group.add(body, head, cage);

  const barBg = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.14), new THREE.MeshBasicMaterial({ color: 0x222222 }));
  const barFg = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.14), new THREE.MeshBasicMaterial({ color: 0xffaa33 }));
  barBg.visible = false;
  barFg.visible = false;

  return { group, barBg, barFg };
}

// Mirrors LoggerManager's seek -> act -> retreat shape, but targets live
// animals instead of tree cells - a second, parallel threat to the
// biodiversity stat instead of just habitat decay.
export class PoacherManager {
  constructor(scene, terrain, animalManager, opts = {}) {
    this.scene = scene;
    this.terrain = terrain;
    this.animalManager = animalManager;
    this.poachers = [];
    this.onAnimalLost = null;
    this.onConfronted = null;
    this.captureTime = opts.captureTime ?? 7;
    const count = opts.poacherCount ?? 1;

    for (let i = 0; i < count; i++) {
      const { group, barBg, barFg } = buildPoacherMesh();
      scene.add(group, barBg, barFg);
      this.poachers.push({
        mesh: group, barBg, barFg,
        active: false,
        state: "idle", // idle -> seeking -> capturing -> retreating
        targetAnimal: null,
        captureProgress: 0,
        retreatTarget: null,
        respawnTimer: randRange(8, 18),
        chatText: null,
        chatTimer: 0,
        chatCooldown: randRange(2, 5),
      });
    }
  }

  _edgeSpawnPoint() {
    const half = this.terrain.half;
    const side = (Math.random() * 4) | 0;
    const t = randRange(-half, half);
    switch (side) {
      case 0: return { x: -half, z: t };
      case 1: return { x: half, z: t };
      case 2: return { x: t, z: -half };
      default: return { x: t, z: half };
    }
  }

  _pickTargetAnimal() {
    const animals = this.animalManager.animals;
    if (!animals.length) return null;
    return animals[(Math.random() * animals.length) | 0];
  }

  _say(p, pool, duration = 3) {
    p.chatText = pool[(Math.random() * pool.length) | 0];
    p.chatTimer = duration;
  }

  huntableUnits() {
    return this.poachers.filter((p) => p.active && (p.state === "seeking" || p.state === "capturing"));
  }

  hit(p) {
    if (!p.active || (p.state !== "seeking" && p.state !== "capturing")) return false;
    p.state = "retreating";
    p.retreatTarget = this._edgeSpawnPoint();
    p.barBg.visible = false;
    p.barFg.visible = false;
    this._say(p, CONFRONTED_LINES, 2.4);
    p.chatCooldown = Infinity;
    if (this.onConfronted) this.onConfronted();
    return true;
  }

  findAimedTarget(originPos, forwardDir, maxRange = MAX_POACHER_SHOOT_RANGE) {
    let best = null, bestDist = maxRange;
    const toUnit = new THREE.Vector3();
    for (const p of this.poachers) {
      if (!p.active || (p.state !== "seeking" && p.state !== "capturing")) continue;
      toUnit.copy(p.mesh.position).sub(originPos);
      const dist = toUnit.length();
      if (dist > maxRange || dist < 0.001) continue;
      toUnit.normalize();
      if (toUnit.dot(forwardDir) < AIM_COS_THRESHOLD) continue;
      if (dist < bestDist) { bestDist = dist; best = p; }
    }
    return best;
  }

  update(dt) {
    for (const p of this.poachers) {
      if (!p.active) {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) {
          const target = this._pickTargetAnimal();
          if (target) {
            p.targetAnimal = target;
            const spawn = this._edgeSpawnPoint();
            p.mesh.position.set(spawn.x, this.terrain.groundHeight(spawn.x, spawn.z), spawn.z);
            p.active = true;
            p.state = "seeking";
            p.captureProgress = 0;
            p.chatText = null;
            p.chatCooldown = randRange(2, 5);
          } else {
            p.respawnTimer = randRange(4, 9);
          }
        }
        continue;
      }

      const pos = p.mesh.position;
      const animalGone = !p.targetAnimal || !this.animalManager.animals.includes(p.targetAnimal);

      if (p.state === "seeking") {
        if (animalGone) {
          p.targetAnimal = this._pickTargetAnimal();
          if (!p.targetAnimal) { p.state = "retreating"; p.retreatTarget = this._edgeSpawnPoint(); continue; }
        }
        const tp = p.targetAnimal.mesh.position;
        const dx = tp.x - pos.x, dz = tp.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.0) {
          p.state = "capturing";
          p.captureProgress = 0;
          p.barBg.visible = true;
          p.barFg.visible = true;
        } else {
          const step = Math.min(dist, 2.9 * dt);
          pos.x += (dx / dist) * step;
          pos.z += (dz / dist) * step;
          p.mesh.rotation.y = Math.atan2(dx, dz);
        }
      } else if (p.state === "capturing") {
        if (animalGone) {
          p.state = "retreating";
          p.retreatTarget = this._edgeSpawnPoint();
          p.barBg.visible = false;
          p.barFg.visible = false;
          continue;
        }
        const tp = p.targetAnimal.mesh.position;
        const dx = tp.x - pos.x, dz = tp.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 2.5) {
          // The animal wandered out of net range - resume the chase.
          p.state = "seeking";
          p.barBg.visible = false;
          p.barFg.visible = false;
          continue;
        }
        p.captureProgress += dt / this.captureTime;
        p.barFg.scale.x = Math.max(0.001, 1 - p.captureProgress);
        if (p.captureProgress >= 1) {
          this.animalManager.removeAnimal(p.targetAnimal);
          p.targetAnimal = null;
          p.state = "retreating";
          p.retreatTarget = this._edgeSpawnPoint();
          p.barBg.visible = false;
          p.barFg.visible = false;
          this._say(p, CAPTURED_LINES, 2.2);
          p.chatCooldown = Infinity;
          if (this.onAnimalLost) this.onAnimalLost();
        }
      } else if (p.state === "retreating") {
        if (!p.retreatTarget) p.retreatTarget = this._edgeSpawnPoint();
        const dx = p.retreatTarget.x - pos.x, dz = p.retreatTarget.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.5) {
          p.active = false;
          p.retreatTarget = null;
          p.respawnTimer = randRange(14, 26);
        } else {
          const step = Math.min(dist, 4.2 * dt);
          pos.x += (dx / dist) * step;
          pos.z += (dz / dist) * step;
          p.mesh.rotation.y = Math.atan2(dx, dz);
        }
      }

      if (p.chatTimer > 0) {
        p.chatTimer -= dt;
        if (p.chatTimer <= 0) p.chatText = null;
      }
      if (p.chatCooldown !== Infinity) {
        p.chatCooldown -= dt;
        if (p.chatCooldown <= 0 && !p.chatText && (p.state === "seeking" || p.state === "capturing")) {
          this._say(p, p.state === "capturing" ? CAPTURING_LINES : SEEKING_LINES, randRange(2.5, 4));
          p.chatCooldown = randRange(7, 13);
        }
      }

      pos.y = this.terrain.groundHeight(pos.x, pos.z);

      if (p.barBg.visible) {
        p.barBg.position.set(pos.x, pos.y + 2.15, pos.z);
        p.barFg.position.set(pos.x, pos.y + 2.15, pos.z + 0.001);
        if (this._billboardQuat) {
          p.barBg.quaternion.copy(this._billboardQuat);
          p.barFg.quaternion.copy(this._billboardQuat);
        }
      }
    }
  }

  faceBillboards(cameraQuaternion) {
    this._billboardQuat = cameraQuaternion;
  }
}
