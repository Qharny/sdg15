import * as THREE from "three";

const HEAD_OFFSET_Y = 2.35;

// Cartoon-style speech bubbles for loggers, rendered as plain DOM elements
// positioned each frame by projecting each logger's head into screen space -
// far simpler than building canvas-texture sprites for arbitrary text, and
// it gets crisp text/CSS styling for free.
export class ChatBubbleManager {
  // `units` is a plain array of {active, chatText, mesh} objects - both
  // LoggerManager.loggers and PoacherManager.poachers already match this
  // shape, so one class handles speech bubbles for either threat type.
  constructor(units) {
    this.units = units;

    this.container = document.createElement("div");
    this.container.id = "logger-chat-layer";
    document.body.appendChild(this.container);

    this.bubbles = units.map(() => {
      const el = document.createElement("div");
      el.className = "chat-bubble";
      this.container.appendChild(el);
      return el;
    });

    this._proj = new THREE.Vector3();
  }

  update(camera, renderer) {
    const units = this.units;
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;

    for (let i = 0; i < units.length; i++) {
      const lg = units[i];
      const el = this.bubbles[i];
      if (!lg.active || !lg.chatText) {
        el.classList.remove("visible");
        continue;
      }

      this._proj.set(lg.mesh.position.x, lg.mesh.position.y + HEAD_OFFSET_Y, lg.mesh.position.z);
      this._proj.project(camera);

      if (this._proj.z > 1 || this._proj.z < -1) {
        el.classList.remove("visible");
        continue;
      }
      const x = (this._proj.x * 0.5 + 0.5) * w;
      const y = (-this._proj.y * 0.5 + 0.5) * h;
      if (x < -80 || x > w + 80 || y < -40 || y > h + 40) {
        el.classList.remove("visible");
        continue;
      }

      if (el.textContent !== lg.chatText) el.textContent = lg.chatText;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      el.classList.add("visible");
    }
  }
}
