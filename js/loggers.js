import * as THREE from "three";
import { heightAt, randRange } from "./utils.js";

export const CONFRONT_RADIUS = 5.5;

// Ambient/reaction barks shown in speech bubbles above a logger's head -
// picked by state so the chatter reflects what they're actually doing.
const SEEKING_LINES = [
  "Just a few more trees...",
  "Nobody's watching out here.",
  "Quota's not gonna fill itself.",
  "This forest's got plenty to spare.",
  "That grove looks about right.",
];
const CHOPPING_LINES = [
  "This one's coming down!",
  "Almost through...",
  "Good, solid timber here.",
  "Won't take but a minute.",
  "Nice and easy now...",
];
const TREE_DOWN_LINES = ["Timber!", "That's one down.", "Ha, told you!"];
const CONFRONTED_LINES = [
  "Alright, alright, I'm going!",
  "Fine! Not worth the hassle.",
  "You win this round.",
  "Ugh, forget it.",
  "Okay, okay, backing off!",
];

function buildLoggerMesh() {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xb33a3a });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.9, 3, 6), mat);
  body.position.y = 0.95;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshLambertMaterial({ color: 0xe0b088 }));
  head.position.y = 1.65;
  head.castShadow = true;
  const axe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), new THREE.MeshLambertMaterial({ color: 0x5a3a1a }));
  axe.position.set(0.4, 1.1, 0);
  axe.rotation.z = 0.5;
  group.add(body, head, axe);

  // Health bar is intentionally NOT parented to `group`: it must billboard
  // to face the camera independent of the logger's facing rotation, so it's
  // tracked as a separate top-level object synced to the logger each frame.
  const barBg = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.14), new THREE.MeshBasicMaterial({ color: 0x222222 }));
  const barFg = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.14), new THREE.MeshBasicMaterial({ color: 0xff5555 }));
  barBg.visible = false;
  barFg.visible = false;

  return { group, barBg, barFg };
}

export class LoggerManager {
  constructor(scene, terrain, treeManager, opts = {}) {
    this.scene = scene;
    this.terrain = terrain;
    this.treeManager = treeManager;
    this.loggers = [];
    this.onTreeLost = null;
    this.onConfronted = null;
    this.chopTime = opts.chopTime ?? 6.5;
    const loggerCount = opts.loggerCount ?? 4;

    for (let i = 0; i < loggerCount; i++) {
      const { group, barBg, barFg } = buildLoggerMesh();
      scene.add(group);
      scene.add(barBg);
      scene.add(barFg);
      this.loggers.push({
        mesh: group, barBg, barFg,
        active: false,
        state: "idle", // idle -> seeking -> chopping -> retreating
        targetCell: null,
        chopProgress: 0,
        retreatTarget: null,
        respawnTimer: randRange(1, 6),
        chatText: null,
        chatTimer: 0,
        chatCooldown: randRange(1, 4),
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

  _pickTargetCell() {
    const candidates = [];
    for (const [key, slot] of this.treeManager.cellToSlot) {
      const s = this.treeManager.slots[slot];
      if (s.growth > 0.3) candidates.push(s);
    }
    if (candidates.length === 0) return null;
    return candidates[(Math.random() * candidates.length) | 0];
  }

  _say(lg, pool, duration = 3) {
    lg.chatText = pool[(Math.random() * pool.length) | 0];
    lg.chatTimer = duration;
  }

  confrontNearest(playerPos) {
    let best = null, bestD = CONFRONT_RADIUS;
    for (const lg of this.loggers) {
      if (!lg.active || lg.state !== "chopping") continue;
      const d = lg.mesh.position.distanceTo(playerPos);
      if (d < bestD) { bestD = d; best = lg; }
    }
    if (best) {
      best.state = "retreating";
      best.retreatTarget = this._edgeSpawnPoint();
      best.barBg.visible = false;
      best.barFg.visible = false;
      this._say(best, CONFRONTED_LINES, 2.4);
      best.chatCooldown = Infinity; // retreating/despawning - no more ambient chatter
      if (this.onConfronted) this.onConfronted();
      return true;
    }
    return false;
  }

  nearestActiveDistance(playerPos) {
    let best = Infinity;
    for (const lg of this.loggers) {
      if (lg.active && lg.state === "chopping") {
        best = Math.min(best, lg.mesh.position.distanceTo(playerPos));
      }
    }
    return best;
  }

  update(dt) {
    for (const lg of this.loggers) {
      if (!lg.active) {
        lg.respawnTimer -= dt;
        if (lg.respawnTimer <= 0) {
          const target = this._pickTargetCell();
          if (target) {
            lg.targetCell = target;
            const spawn = this._edgeSpawnPoint();
            lg.mesh.position.set(spawn.x, heightAt(spawn.x, spawn.z), spawn.z);
            lg.active = true;
            lg.state = "seeking";
            lg.chopProgress = 0;
            lg.chatText = null;
            lg.chatCooldown = randRange(2, 5);
          } else {
            lg.respawnTimer = randRange(2, 5);
          }
        }
        continue;
      }

      const p = lg.mesh.position;

      if (lg.state === "seeking") {
        if (!lg.targetCell || !lg.targetCell.active) {
          lg.targetCell = this._pickTargetCell();
          if (!lg.targetCell) { lg.state = "retreating"; lg.retreatTarget = this._edgeSpawnPoint(); continue; }
        }
        const { x, z } = this.terrain.worldPos(lg.targetCell.col, lg.targetCell.row);
        const dx = x - p.x, dz = z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.6) {
          lg.state = "chopping";
          lg.chopProgress = 0;
          lg.barBg.visible = true;
          lg.barFg.visible = true;
        } else {
          const step = Math.min(dist, 2.6 * dt);
          p.x += (dx / dist) * step;
          p.z += (dz / dist) * step;
          lg.mesh.rotation.y = Math.atan2(dx, dz);
        }
      } else if (lg.state === "chopping") {
        if (!lg.targetCell.active) {
          lg.state = "retreating";
          lg.retreatTarget = this._edgeSpawnPoint();
          lg.barBg.visible = false;
          lg.barFg.visible = false;
          continue;
        }
        lg.chopProgress += dt / this.chopTime;
        lg.barFg.scale.x = Math.max(0.001, 1 - lg.chopProgress);
        if (lg.chopProgress >= 1) {
          const { col, row } = lg.targetCell;
          this.treeManager.chop(col, row);
          this.terrain.adjustHealth(col, row, -0.35);
          if (this.onTreeLost) this.onTreeLost();
          lg.state = "retreating";
          lg.retreatTarget = this._edgeSpawnPoint();
          lg.barBg.visible = false;
          lg.barFg.visible = false;
          this._say(lg, TREE_DOWN_LINES, 2.2);
          lg.chatCooldown = Infinity;
        }
      } else if (lg.state === "retreating") {
        if (!lg.retreatTarget) lg.retreatTarget = this._edgeSpawnPoint();
        const dx = lg.retreatTarget.x - p.x, dz = lg.retreatTarget.z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.5) {
          lg.active = false;
          lg.retreatTarget = null;
          lg.respawnTimer = randRange(10, 20);
        } else {
          const step = Math.min(dist, 4 * dt);
          p.x += (dx / dist) * step;
          p.z += (dz / dist) * step;
          lg.mesh.rotation.y = Math.atan2(dx, dz);
        }
      }

      if (lg.chatTimer > 0) {
        lg.chatTimer -= dt;
        if (lg.chatTimer <= 0) lg.chatText = null;
      }
      if (lg.chatCooldown !== Infinity) {
        lg.chatCooldown -= dt;
        if (lg.chatCooldown <= 0 && !lg.chatText && (lg.state === "seeking" || lg.state === "chopping")) {
          this._say(lg, lg.state === "chopping" ? CHOPPING_LINES : SEEKING_LINES, randRange(2.5, 4));
          lg.chatCooldown = randRange(7, 13);
        }
      }

      p.y = heightAt(p.x, p.z);

      if (lg.barBg.visible) {
        lg.barBg.position.set(p.x, p.y + 2.15, p.z);
        lg.barFg.position.set(p.x, p.y + 2.15, p.z + 0.001);
        if (this._billboardQuat) {
          lg.barBg.quaternion.copy(this._billboardQuat);
          lg.barFg.quaternion.copy(this._billboardQuat);
        }
      }
    }
  }

  faceBillboards(cameraQuaternion) {
    this._billboardQuat = cameraQuaternion;
  }
}
