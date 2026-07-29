import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { heightAt, clamp } from "./utils.js";
import { CONFRONT_RADIUS } from "./loggers.js";

const EYE_HEIGHT = 2.1;
const MOVE_SPEED = 9;
const INTERACT_RADIUS = 6.5;

export class PlayerController {
  constructor(camera, domElement, terrain, treeManager, loggerManager, ui) {
    this.camera = camera;
    this.terrain = terrain;
    this.treeManager = treeManager;
    this.loggerManager = loggerManager;
    this.ui = ui;

    this.controls = new PointerLockControls(camera, domElement);
    camera.position.set(0, EYE_HEIGHT, 4);

    this.keys = { w: false, a: false, s: false, d: false };
    this.seeds = 15;
    this.maxSeeds = 30;
    this.water = 100;
    this.maxWater = 100;

    this.seedRegenAccum = 0;
    this.target = { type: null, col: 0, row: 0 };

    this.locked = false;
    this._velocity = new THREE.Vector3();

    document.addEventListener("keydown", (e) => this._onKey(e, true));
    document.addEventListener("keyup", (e) => this._onKey(e, false));

    this.controls.addEventListener("lock", () => {
      this.locked = true;
      ui.onPointerLock(true);
    });
    this.controls.addEventListener("unlock", () => {
      this.locked = false;
      ui.onPointerLock(false);
    });
  }

  lock() {
    this.controls.lock();
  }

  _onKey(e, down) {
    switch (e.code) {
      case "KeyW": case "ArrowUp": this.keys.w = down; break;
      case "KeyS": case "ArrowDown": this.keys.s = down; break;
      case "KeyA": case "ArrowLeft": this.keys.a = down; break;
      case "KeyD": case "ArrowRight": this.keys.d = down; break;
      case "KeyE": if (down) this._plant(); break;
      case "KeyQ": if (down) this._water(); break;
      case "KeyF": if (down) this._confront(); break;
    }
  }

  _plant() {
    if (this.target.type !== "plant") return;
    if (this.seeds < 1) { this.ui.toast("No seeds left - water land or wait for the nursery to restock.", 2200); return; }
    const { col, row } = this.target;
    if (this.treeManager.plant(col, row)) {
      this.seeds -= 1;
      this.ui.toast("Sapling planted \u{1F331}", 1400);
      this.ui.bumpPlanted();
    }
  }

  _water() {
    if (this.water < 18) { this.ui.toast("Canteen low - wait for it to refill.", 1800); return; }
    const pos = this.camera.position;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const x = pos.x + forward.x * 3;
    const z = pos.z + forward.z * 3;
    this.terrain.waterAround(x, z, 1, 0.24);
    this.water -= 18;
    this.ui.toast("Land irrigated \u{1F4A7}", 1200);
  }

  _confront() {
    if (this.loggerManager.confrontNearest(this.camera.position)) {
      this.ui.toast("Logger scared off - keep patrolling your forest!", 2200);
      this.ui.bumpConfronted();
    }
  }

  _findTarget() {
    const pos = this.camera.position;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const aheadX = pos.x + forward.x * 3;
    const aheadZ = pos.z + forward.z * 3;
    const { col, row } = this.terrain.cellAt(aheadX, aheadZ);

    const loggerDist = this.loggerManager.nearestActiveDistance(pos);
    if (loggerDist < CONFRONT_RADIUS) {
      this.target = { type: "confront", col, row };
      return;
    }

    if (!this.terrain.inBounds(col, row)) { this.target = { type: null }; return; }
    const hasTree = this.treeManager.hasTreeAt(col, row);
    if (!hasTree && this.terrain.isPlantable(col, row)) {
      this.target = { type: "plant", col, row };
    } else if (this.terrain.getHealth(col, row) < 0.6) {
      this.target = { type: "water", col, row };
    } else {
      this.target = { type: null };
    }
  }

  update(dt) {
    if (this.locked) {
      const dir = new THREE.Vector3(
        (this.keys.d ? 1 : 0) - (this.keys.a ? 1 : 0),
        0,
        0
      );
      const forwardAmount = (this.keys.w ? 1 : 0) - (this.keys.s ? 1 : 0);
      if (forwardAmount !== 0) this.controls.moveForward(forwardAmount * MOVE_SPEED * dt);
      if (dir.x !== 0) this.controls.moveRight(dir.x * MOVE_SPEED * dt);

      const p = this.camera.position;
      p.y = heightAt(p.x, p.z) + EYE_HEIGHT;
      const half = this.terrain.half - 1;
      p.x = clamp(p.x, -half, half);
      p.z = clamp(p.z, -half, half);

      this._findTarget();
    }

    this.water = clamp(this.water + 5.5 * dt, 0, this.maxWater);
    this.seedRegenAccum += dt;
    if (this.seedRegenAccum > 9) {
      this.seedRegenAccum = 0;
      this.seeds = clamp(this.seeds + 1, 0, this.maxSeeds);
    }
  }
}
