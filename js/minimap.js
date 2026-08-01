const MAP_SIZE = 132; // rendered canvas size in CSS pixels
const BG_REFRESH_INTERVAL = 1.5; // health barely moves frame to frame - redraw the background sparingly
const ZOOM = 1.35; // >1 crops in a bit around the player instead of always fitting the whole map
const VOID_COLOR = "#0b1510"; // shown past the terrain edge once the view pans off it

// Cheap top-down minimap: the health grid is rasterized straight into a
// low-res offscreen canvas (one pixel per cell) and scaled up, so there's no
// extra raycasting or scene traversal - just reads terrain.health directly.
export class Minimap {
  constructor(terrain) {
    this.terrain = terrain;
    this.canvas = document.getElementById("minimap");
    this.canvas.width = MAP_SIZE;
    this.canvas.height = MAP_SIZE;
    this.ctx = this.canvas.getContext("2d");

    this.bgCanvas = document.createElement("canvas");
    this.bgCanvas.width = terrain.size;
    this.bgCanvas.height = terrain.size;
    this.bgCtx = this.bgCanvas.getContext("2d");

    this._refreshTimer = 0;
    this._refreshBackground();
  }

  _refreshBackground() {
    const { size, health } = this.terrain;
    const img = this.bgCtx.createImageData(size, size);
    for (let i = 0; i < health.length; i++) {
      const [r, g, b] = this.terrain.cellColor(i);
      const p = i * 4;
      img.data[p] = r * 255;
      img.data[p + 1] = g * 255;
      img.data[p + 2] = b * 255;
      img.data[p + 3] = 255;
    }
    this.bgCtx.putImageData(img, 0, 0);
  }

  // World coords -> pixel space of bgCanvas (1 pixel per terrain cell).
  _toBgPx(x, z) {
    const half = this.terrain.half;
    return {
      bx: ((x + half) / (half * 2)) * this.terrain.size,
      bz: ((z + half) / (half * 2)) * this.terrain.size,
    };
  }

  update(dt, playerPos, playerYaw, threats = []) {
    this._refreshTimer += dt;
    if (this._refreshTimer > BG_REFRESH_INTERVAL) {
      this._refreshTimer = 0;
      this._refreshBackground();
    }

    const ctx = this.ctx;
    const scale = (MAP_SIZE / this.terrain.size) * ZOOM;
    const { bx, bz } = this._toBgPx(playerPos.x, playerPos.z);

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = VOID_COLOR;
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    // Rotate/pan the whole map opposite the player's heading so the player's
    // facing direction always points up on screen, GTA-style, then draw the
    // player + threats within that same transformed space.
    ctx.save();
    ctx.translate(MAP_SIZE / 2, MAP_SIZE / 2);
    ctx.rotate(-playerYaw);
    ctx.scale(scale, scale);
    ctx.translate(-bx, -bz);

    ctx.drawImage(this.bgCanvas, 0, 0);

    for (const t of threats) {
      const { bx: tx, bz: tz } = this._toBgPx(t.x, t.z);
      ctx.beginPath();
      ctx.fillStyle = t.color;
      ctx.arc(tx, tz, 3 / scale, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Player marker: fixed at center, always pointing up - the map rotates
    // around it instead of the marker rotating on a north-up map.
    ctx.save();
    ctx.translate(MAP_SIZE / 2, MAP_SIZE / 2);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
