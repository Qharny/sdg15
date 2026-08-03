// Mobile input: a virtual joystick for movement, a full-screen drag layer
// for looking around (replacing mouse-look since Pointer Lock is unreliable
// or unsupported on phones/tablets), and buttons for the actions keyboard
// keys would otherwise cover. All DOM elements live in index.html under
// #touch-controls; this module only wires up the listeners.

export function isTouchDevice() {
  return (
    window.matchMedia?.("(pointer: coarse)").matches ||
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0
  );
}

const JOYSTICK_RADIUS = 42; // px the thumb can travel from center before clamping

export class TouchControls {
  constructor(player) {
    this.player = player;
    this.root = document.getElementById("touch-controls");
    this.joystick = document.getElementById("touch-joystick");
    this.thumb = document.getElementById("touch-joystick-thumb");
    this.lookLayer = document.getElementById("touch-look-layer");

    this._joystickId = null;
    this._joystickCenter = { x: 0, y: 0 };
    this._lookId = null;
    this._lastLook = { x: 0, y: 0 };

    this._bindJoystick();
    this._bindLook();
    this._bindButtons();
    this._bindOrientation();

    this.root.addEventListener("contextmenu", (e) => e.preventDefault());
    document.body.classList.add("touch-mode");
  }

  _bindJoystick() {
    const el = this.joystick;
    const reset = () => {
      this._joystickId = null;
      this.thumb.style.transform = "translate(0px, 0px)";
      this.player.setMoveVector(0, 0);
    };
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this._joystickId = e.pointerId;
      const rect = el.getBoundingClientRect();
      this._joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this._joystickId) return;
      let dx = e.clientX - this._joystickCenter.x;
      let dy = e.clientY - this._joystickCenter.y;
      const dist = Math.hypot(dx, dy);
      if (dist > JOYSTICK_RADIUS) {
        dx = (dx / dist) * JOYSTICK_RADIUS;
        dy = (dy / dist) * JOYSTICK_RADIUS;
      }
      this.thumb.style.transform = `translate(${dx}px, ${dy}px)`;
      // Screen "up" (negative dy) should read as moving forward.
      this.player.setMoveVector(dx / JOYSTICK_RADIUS, -dy / JOYSTICK_RADIUS);
    });
    el.addEventListener("pointerup", (e) => { if (e.pointerId === this._joystickId) reset(); });
    el.addEventListener("pointercancel", (e) => { if (e.pointerId === this._joystickId) reset(); });
  }

  _bindLook() {
    const el = this.lookLayer;
    el.addEventListener("pointerdown", (e) => {
      this._lookId = e.pointerId;
      this._lastLook = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this._lookId) return;
      const dx = e.clientX - this._lastLook.x;
      const dy = e.clientY - this._lastLook.y;
      this._lastLook = { x: e.clientX, y: e.clientY };
      this.player.lookDelta(dx, dy);
    });
    const clear = (e) => { if (e.pointerId === this._lookId) this._lookId = null; };
    el.addEventListener("pointerup", clear);
    el.addEventListener("pointercancel", clear);
  }

  _bindButtons() {
    const tap = (id, fn) => {
      document.getElementById(id).addEventListener("pointerdown", (e) => {
        e.preventDefault();
        fn();
      });
    };
    tap("touch-btn-plant", () => this.player.plant());
    tap("touch-btn-water", () => this.player.water());
    tap("touch-btn-shoot", () => this.player.shoot());
    tap("touch-btn-switch", () => this.player.cyclePlantType());
    tap("touch-btn-view", () => this.player.onViewToggle?.());
    tap("touch-btn-manual", () => this.player.onManualToggle?.());
    tap("touch-btn-pause", () => this.player.unlock());
  }

  // A blocking "rotate your device" notice (CSS-driven, see style.css) reads
  // the body.portrait class this keeps in sync - portrait play is cramped
  // for a first-person 3D game and there's no reliable way to force
  // landscape on iOS Safari, so we ask instead.
  _bindOrientation() {
    const update = () => {
      document.body.classList.toggle("portrait", window.innerHeight > window.innerWidth);
    };
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    update();
  }
}
