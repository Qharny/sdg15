const MAP_SIZE = 132; // rendered canvas size in CSS pixels
const BG_REFRESH_INTERVAL = 1.5; // health barely moves frame to frame - redraw the background sparingly

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

  _toMap(x, z) {
    const half = this.terrain.half;
    return {
      mx: ((x + half) / (half * 2)) * MAP_SIZE,
      mz: ((z + half) / (half * 2)) * MAP_SIZE,
    };
  }

  update(dt, playerPos, playerYaw, threats = []) {
    this._refreshTimer += dt;
    if (this._refreshTimer > BG_REFRESH_INTERVAL) {
      this._refreshTimer = 0;
      this._refreshBackground();
    }

    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx.drawImage(this.bgCanvas, 0, 0, MAP_SIZE, MAP_SIZE);

    for (const t of threats) {
      const { mx, mz } = this._toMap(t.x, t.z);
      ctx.beginPath();
      ctx.fillStyle = t.color;
      ctx.arc(mx, mz, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const { mx, mz } = this._toMap(playerPos.x, playerPos.z);
    ctx.save();
    ctx.translate(mx, mz);
    ctx.rotate(playerYaw);
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
