// Shared math/noise helpers used by terrain, player and entities so
// everything agrees on ground height without a real heightmap asset.

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Cheap deterministic "bumpy ground" function - not true Perlin noise,
// but continuous and good enough for gentle rolling terrain.
export function heightAt(x, z) {
  return (
    Math.sin(x * 0.045) * Math.cos(z * 0.045) * 1.6 +
    Math.sin(x * 0.11 + z * 0.03) * 0.5 +
    Math.cos(z * 0.09 - x * 0.02) * 0.35
  );
}

export function healthToColor(h) {
  // Stops: desert sand -> cracked dry earth -> scrubland -> lush forest.
  const stops = [
    { t: 0.0, c: [0xd9, 0xc2, 0x8f] },
    { t: 0.18, c: [0x9c, 0x6f, 0x44] },
    { t: 0.45, c: [0xb7, 0xc4, 0x6c] },
    { t: 0.75, c: [0x4f, 0x9d, 0x3f] },
    { t: 1.0, c: [0x1f, 0x6b, 0x2c] },
  ];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (h >= stops[i].t && h <= stops[i + 1].t) {
      a = stops[i]; b = stops[i + 1];
      break;
    }
  }
  const span = b.t - a.t || 1;
  const t = clamp((h - a.t) / span, 0, 1);
  const r = lerp(a.c[0], b.c[0], t) / 255;
  const g = lerp(a.c[1], b.c[1], t) / 255;
  const bl = lerp(a.c[2], b.c[2], t) / 255;
  return [r, g, bl];
}

export function randRange(min, max) {
  return min + Math.random() * (max - min);
}

export function pickRandom(arr) {
  return arr[(Math.random() * arr.length) | 0];
}
