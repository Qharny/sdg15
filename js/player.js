import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { clamp } from "./utils.js";
import { isTouchDevice } from "./touchControls.js";

const EYE_HEIGHT = 2.1;
const MOVE_SPEED = 9;
const SHOOT_COOLDOWN = 0.45;
const TOUCH_LOOK_SENSITIVITY = 0.0028;

export class PlayerController {
  constructor(camera, domElement, terrain, treeManager, loggerManager, projectileManager, ui, audio, opts = {}) {
    this.camera = camera;
    this.terrain = terrain;
    this.treeManager = treeManager;
    this.loggerManager = loggerManager;
    this.projectileManager = projectileManager;
    this.ui = ui;
    this.audio = audio;

    this.controls = new PointerLockControls(camera, domElement);
    camera.position.set(0, EYE_HEIGHT, 4);
    this.baseFov = camera.fov;
    this._lastSafeX = 0;
    this._lastSafeZ = 4;

    this.bobPhase = 0;
    this.bobBlend = 0;
    this._lastStepPhase = 0;
    this.onManualToggle = null;
    this.onPlant = null;
    this.onViewToggle = null;

    // On touch devices the Pointer Lock API is unsupported (iOS Safari) or
    // unreliable, so movement/look are driven by a virtual joystick and a
    // drag layer (see touchControls.js) instead of real pointer lock.
    this.touchMode = isTouchDevice();
    this.touchMove = { x: 0, z: 0 };
    this._lookEuler = new THREE.Euler(0, 0, 0, "YXZ");

    this.keys = { w: false, a: false, s: false, d: false };
    this.plantType = "tree";
    this.seeds = opts.startSeeds ?? 15;
    this.maxSeeds = opts.maxSeeds ?? 30;
    this.water = opts.maxWater ?? 100;
    this.maxWater = opts.maxWater ?? 100;
    this.seedRegenTime = opts.seedRegenTime ?? 9;
    this.waterRegenRate = opts.waterRegenRate ?? 5.5;
    this.waterDrainPerUse = opts.waterDrainPerUse ?? 18;
    this.waterRadius = 1; // cells irrigated/doused around the target point - boosted by the Wider Irrigation skill
    this.moveSpeedMult = 1; // boosted by the Swift Stride skill
    this.shootCooldown = 0;
    this.envWaterMultiplier = 1;
    this.fireManager = null; // set externally once constructed
    this.poacherManager = null; // set externally once constructed
    this.weedManager = null; // set externally once constructed

    this.seedRegenAccum = 0;
    this.target = { type: null, col: 0, row: 0 };

    this.locked = false;

    document.addEventListener("keydown", (e) => this._onKey(e, true));
    document.addEventListener("keyup", (e) => this._onKey(e, false));
    domElement.addEventListener("mousedown", (e) => {
      if (!this.touchMode && this.locked && e.button === 0) this._shoot();
    });

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
    if (this.touchMode) {
      this.locked = true;
      this.ui.onPointerLock(true);
    } else {
      this.controls.lock();
    }
  }

  unlock() {
    if (this.touchMode) {
      this.locked = false;
      this.ui.onPointerLock(false);
    } else {
      this.controls.unlock();
    }
  }

  // Public wrappers so touchControls.js can trigger the same actions as the
  // keyboard shortcuts without reaching into "private" (underscore) methods.
  plant() { this._plant(); }
  water() { this._water(); }
  shoot() { this._shoot(); }
  cyclePlantType() { this._cyclePlantType(); }

  // Called by the touch joystick each frame it's held; x/z are each in
  // [-1, 1] (strafe, forward) and blend additively with WASD in update().
  setMoveVector(x, z) {
    this.touchMove.x = x;
    this.touchMove.z = z;
  }

  // Called by the touch look-drag layer in place of mouse-look. Mirrors
  // PointerLockControls' own onMouseMove math so touch and mouse feel the
  // same, but applies directly to the camera since pointer lock isn't
  // engaged in touch mode.
  lookDelta(dx, dy) {
    if (!this.locked) return;
    this._lookEuler.setFromQuaternion(this.camera.quaternion);
    this._lookEuler.y -= dx * TOUCH_LOOK_SENSITIVITY;
    this._lookEuler.x -= dy * TOUCH_LOOK_SENSITIVITY;
    const maxPitch = Math.PI / 2 - 0.01;
    this._lookEuler.x = clamp(this._lookEuler.x, -maxPitch, maxPitch);
    this.camera.quaternion.setFromEuler(this._lookEuler);
  }

  _onKey(e, down) {
    if (e.code === "KeyH") {
      if (down) this.onManualToggle?.();
      return;
    }
    if (!this.locked) {
      this.keys.w = this.keys.a = this.keys.s = this.keys.d = false;
      return;
    }
    switch (e.code) {
      case "KeyW": case "ArrowUp": this.keys.w = down; break;
      case "KeyS": case "ArrowDown": this.keys.s = down; break;
      case "KeyA": case "ArrowLeft": this.keys.a = down; break;
      case "KeyD": case "ArrowRight": this.keys.d = down; break;
      case "KeyE": if (down) this._plant(); break;
      case "KeyQ": if (down) this._water(); break;
      case "KeyF": if (down) this._shoot(); break;
      case "Tab": if (down) { e.preventDefault(); this._cyclePlantType(); } break;
      case "KeyV": if (down) this.onViewToggle?.(); break;
    }
  }

  _cyclePlantType() {
    this.plantType = this.plantType === "tree" ? "shrub" : "tree";
    this.ui.toast(
      this.plantType === "shrub"
        ? "Switched to Shrub \u{1F33F} — cheap, fast ground cover (won't become forest)"
        : "Switched to Tree \u{1F333} — slow, but grows into real forest cover",
      1800
    );
  }

  _plant() {
    if (this.target.type !== "plant") return;
    if (this.seeds < 1) { this.ui.toast("No seeds left - water land or wait for the nursery to restock.", 2200); return; }
    const { col, row } = this.target;
    if (this.treeManager.plant(col, row, this.plantType)) {
      this.seeds -= 1;
      this.ui.toast(this.plantType === "shrub" ? "Shrub planted \u{1F33F}" : "Sapling planted \u{1F331}", 1400);
      this.ui.bumpPlanted(this.plantType);
      this.audio?.chime();
      this.onPlant?.();
    }
  }

  _water() {
    if (this.water < this.waterDrainPerUse) { this.ui.toast("Canteen low - wait for it to refill.", 1800); return; }
    const pos = this.camera.position;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const x = pos.x + forward.x * 3;
    const z = pos.z + forward.z * 3;
    this.terrain.waterAround(x, z, this.waterRadius, 0.24);
    const extinguished = this.fireManager?.extinguishAt(x, z);
    this.water -= this.waterDrainPerUse;
    if (extinguished) {
      this.ui.toast("Fire doused! \u{1F4A7}\u{1F525}", 1800);
      this.audio?.chime();
    } else {
      this.ui.toast("Land irrigated \u{1F4A7}", 1200);
      this.audio?.splash();
    }
  }

  _shoot() {
    if (this.shootCooldown > 0) return;
    this.shootCooldown = SHOOT_COOLDOWN;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    this.projectileManager.spawn(this.camera.position, forward);
    this.audio?.shoot();
  }

  _findTarget() {
    const pos = this.camera.position;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);

    if (
      this.loggerManager.findAimedTarget(pos, forward) ||
      this.poacherManager?.findAimedTarget(pos, forward) ||
      this.weedManager?.findAimedTarget(pos, forward)
    ) {
      this.target = { type: "shoot" };
      return;
    }

    const aheadX = pos.x + forward.x * 3;
    const aheadZ = pos.z + forward.z * 3;
    const { col, row } = this.terrain.cellAt(aheadX, aheadZ);

    if (!this.terrain.inBounds(col, row)) { this.target = { type: null }; return; }
    const hasTree = this.treeManager.hasTreeAt(col, row);
    const onFire = !!this.fireManager?.isBurning(col, row);
    if (onFire) {
      this.target = { type: "water", col, row, fire: true };
    } else if (!hasTree && this.terrain.isPlantable(col, row)) {
      this.target = { type: "plant", col, row, plantType: this.plantType };
    } else if (this.terrain.getHealth(col, row) < 0.6) {
      this.target = { type: "water", col, row };
    } else {
      this.target = { type: null };
    }
  }

  update(dt) {
    if (this.locked) {
      const strafeAmount = clamp((this.keys.d ? 1 : 0) - (this.keys.a ? 1 : 0) + this.touchMove.x, -1, 1);
      const forwardAmount = clamp((this.keys.w ? 1 : 0) - (this.keys.s ? 1 : 0) + this.touchMove.z, -1, 1);
      const moving = forwardAmount !== 0 || strafeAmount !== 0;
      const speed = MOVE_SPEED * this.moveSpeedMult;
      if (forwardAmount !== 0) this.controls.moveForward(forwardAmount * speed * dt);
      if (strafeAmount !== 0) this.controls.moveRight(strafeAmount * speed * dt);

      const p = this.camera.position;
      const half = this.terrain.half - 1;
      p.x = clamp(p.x, -half, half);
      p.z = clamp(p.z, -half, half);

      // Mountains and water are hard obstacles - simple bump-and-stop (no
      // sliding) rather than real collision, consistent with the fact that
      // nothing else in this game has collision either.
      const { col, row } = this.terrain.cellAt(p.x, p.z);
      if (this.terrain.isBlocked(col, row)) {
        p.x = this._lastSafeX;
        p.z = this._lastSafeZ;
      } else {
        this._lastSafeX = p.x;
        this._lastSafeZ = p.z;
      }

      // Head-bob: eases toward a moving/idle blend so it starts and stops
      // smoothly rather than snapping, then rides a sine wave for the bob.
      this.bobBlend += ((moving ? 1 : 0) - this.bobBlend) * Math.min(1, dt * 6);
      if (moving) this.bobPhase += dt * speed * 0.9;
      const bobY = Math.sin(this.bobPhase * 2) * 0.055 * this.bobBlend;
      const idleSway = Math.sin(performance.now() * 0.0006) * 0.012;
      p.y = this.terrain.groundHeight(p.x, p.z) + EYE_HEIGHT + bobY + idleSway;

      this.camera.fov = this.baseFov + Math.sin(this.bobPhase) * 0.6 * this.bobBlend;
      this.camera.updateProjectionMatrix();

      if (this.audio) {
        const stepCycle = (this.bobPhase * 2) % (Math.PI * 2);
        if (moving && stepCycle < this._lastStepPhase) {
          const { col, row } = this.terrain.cellAt(p.x, p.z);
          this.audio.footstep(this.terrain.getHealth(col, row));
        }
        this._lastStepPhase = stepCycle;
      }

      this._findTarget();
    }

    if (this.shootCooldown > 0) this.shootCooldown -= dt;

    this.water = clamp(this.water + this.waterRegenRate * this.envWaterMultiplier * dt, 0, this.maxWater);
    this.seedRegenAccum += dt;
    if (this.seedRegenAccum > this.seedRegenTime) {
      this.seedRegenAccum = 0;
      this.seeds = clamp(this.seeds + 1, 0, this.maxSeeds);
    }
  }
}
