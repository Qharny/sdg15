// One-time generation of non-simulated terrain features: mountains, a lake,
// and the rivers connecting them. Produces a per-cell `cellType` (land/water/
// mountain) and an `elevation` offset added on top of the base heightAt()
// bump function - kept separate from the health grid because none of these
// cells are part of the growth/decay/desertification simulation.
export const CellType = { LAND: 0, WATER: 1, MOUNTAIN: 2 };

// Mountains sit in the NE corner, the lake just south of them, and the two
// rivers (mountain -> lake, lake -> east edge) stay entirely in that
// quadrant - by construction none of this comes near the map's center,
// which is where the player always spawns.
const MOUNTAIN_PEAKS = [
  { cx: 0.82, cy: 0.15, radius: 0.16, height: 7.5 },
  { cx: 0.68, cy: 0.24, radius: 0.11, height: 5 },
];
const LAKE = { cx: 0.60, cy: 0.32, radius: 0.09 };
const RIVERS = [
  { from: { cx: 0.64, cy: 0.28 }, to: { cx: 0.60, cy: 0.32 } }, // foothill feeder into the lake
  { from: { cx: 0.60, cy: 0.32 }, to: { cx: 0.98, cy: 0.43 } }, // outflow to the east edge
];

function idx(size, col, row) {
  return row * size + col;
}

function clampInt(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Cheap deterministic per-cell jitter (same trick as the decor placement
// elsewhere in the codebase) so mountain/lake edges don't read as perfect
// geometric shapes, without needing a real noise library.
function cellJitter(col, row) {
  const v = Math.sin(col * 12.9898 + row * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function stampWater(size, cellType, elevation, col, row, depth) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (Math.hypot(dr, dc) > 1.05 && Math.random() < 0.6) continue;
      const c = col + dc, r = row + dr;
      if (c < 0 || r < 0 || c >= size || r >= size) continue;
      const i = idx(size, c, r);
      cellType[i] = CellType.WATER;
      elevation[i] = depth;
    }
  }
}

function carveRiver(size, cellType, elevation, start, end, depth) {
  let col = start.col, row = start.row;
  const maxSteps = size * 3;
  for (let i = 0; i < maxSteps; i++) {
    stampWater(size, cellType, elevation, col, row, depth);
    const dx = end.col - col, dz = end.row - row;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.5) break;
    const stepCol = dx / dist + (Math.random() - 0.5) * 0.9;
    const stepRow = dz / dist + (Math.random() - 0.5) * 0.9;
    col = clampInt(col + Math.round(stepCol), 0, size - 1);
    row = clampInt(row + Math.round(stepRow), 0, size - 1);
  }
}

export function generateWorldFeatures(size) {
  const cellType = new Uint8Array(size * size);
  const elevation = new Float32Array(size * size);

  // Mountains: radial falloff from one or more peaks; only the inner core
  // of each peak is classified MOUNTAIN (blocks planting/movement) - the
  // outer slope just raises the terrain so peaks don't have a hard edge.
  for (const peak of MOUNTAIN_PEAKS) {
    const cx = peak.cx * size, cy = peak.cy * size, r = peak.radius * size;
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const d = Math.hypot(col - cx, row - cy);
        if (d > r) continue;
        const t = 1 - d / r;
        const jitter = 0.75 + cellJitter(col, row) * 0.5;
        const h = peak.height * t * t * jitter;
        const i = idx(size, col, row);
        if (h > elevation[i]) {
          elevation[i] = h;
          if (t > 0.22) cellType[i] = CellType.MOUNTAIN;
        }
      }
    }
  }

  // Lake: a roughly circular water body with a jittered edge so it doesn't
  // read as a perfect circle.
  const lcx = LAKE.cx * size, lcy = LAKE.cy * size, lr = LAKE.radius * size;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const d = Math.hypot(col - lcx, row - lcy);
      const jr = lr * (0.82 + cellJitter(col + 91, row + 17) * 0.36);
      if (d < jr) {
        const i = idx(size, col, row);
        cellType[i] = CellType.WATER;
        elevation[i] = -1.4;
      }
    }
  }

  for (const river of RIVERS) {
    carveRiver(
      size, cellType, elevation,
      { col: Math.round(river.from.cx * size), row: Math.round(river.from.cy * size) },
      { col: Math.round(river.to.cx * size), row: Math.round(river.to.cy * size) },
      -0.7
    );
  }

  // Defensive clear around the player's spawn point (map center, world
  // origin) - the layout above is chosen to never need this, but it's cheap
  // insurance against a stray river meander wandering too close.
  const cx = size / 2, cz = size / 2, safeRadius = 5;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (Math.hypot(col - cx, row - cz) < safeRadius) {
        const i = idx(size, col, row);
        cellType[i] = CellType.LAND;
        elevation[i] = 0;
      }
    }
  }

  return { cellType, elevation };
}
