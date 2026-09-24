// Generates the PWA icons from one geometric design (a copper sun setting over wort).
// Dependency-free: writes the SVG and rasterizes PNGs with supersampling + node:zlib.
// Run with `npm run icons`.
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const GREEN = [0x29, 0x4a, 0x3d];
const COPPER = [0xc6, 0x8b, 0x42];
const CREAM = [0xf4, 0xf1, 0xe8];

// Cubic Bézier paths in a 512×512 design space. "S" segments are expanded to explicit control points.
const horizon = [[0, 300], [80, 270], [160, 330], [256, 300], [352, 270], [432, 270], [512, 300]];
const wave1 = [[96, 316], [150, 296], [200, 336], [256, 316], [312, 296], [362, 296], [416, 316]];
const wave2 = [[136, 372], [180, 356], [216, 388], [256, 372], [296, 356], [332, 356], [376, 372]];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#294A3D"/>
  <circle cx="256" cy="232" r="120" fill="#C68B42"/>
  <path d="M0 300 C80 270 160 330 256 300 S432 270 512 300 V512 H0 Z" fill="#294A3D"/>
  <path d="M96 316 C150 296 200 336 256 316 S362 296 416 316" fill="none" stroke="#F4F1E8" stroke-width="22" stroke-linecap="round"/>
  <path d="M136 372 C180 356 216 388 256 372 S332 356 376 372" fill="none" stroke="#F4F1E8" stroke-opacity=".55" stroke-width="18" stroke-linecap="round"/>
</svg>
`;

function sampleBezier(points, steps = 48) {
  const out = [];
  for (let seg = 0; seg + 3 < points.length; seg += 3) {
    const [p0, p1, p2, p3] = points.slice(seg, seg + 4);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      out.push([
        u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
        u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1],
      ]);
    }
  }
  return out;
}

const horizonPts = sampleBezier(horizon, 128);
const wave1Pts = sampleBezier(wave1);
const wave2Pts = sampleBezier(wave2);

function horizonY(x) {
  for (let i = 1; i < horizonPts.length; i++) {
    const [x0, y0] = horizonPts[i - 1];
    const [x1, y1] = horizonPts[i];
    if (x >= x0 && x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
  }
  return 300;
}

function distanceToPolyline(x, y, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

function insideRoundedRect(x, y, size, radius) {
  const cx = Math.max(radius, Math.min(size - radius, x));
  const cy = Math.max(radius, Math.min(size - radius, y));
  return x >= 0 && y >= 0 && x <= size && y <= size && Math.hypot(x - cx, y - cy) <= radius;
}

/** Colour (RGBA 0–1) of the design at a point in 512-space. */
function shade(x, y, { rounded }) {
  if (rounded ? !insideRoundedRect(x, y, 512, 112) : x < 0 || y < 0 || x > 512 || y > 512) return [0, 0, 0, 0];
  let color = GREEN;
  if (Math.hypot(x - 256, y - 232) <= 120 && y < horizonY(x)) color = COPPER;
  const mix = (base, top, a) => base.map((c, i) => c * (1 - a) + top[i] * a);
  if (y > 280 && y < 350 && distanceToPolyline(x, y, wave1Pts) <= 11) color = CREAM;
  if (y > 340 && y < 400 && distanceToPolyline(x, y, wave2Pts) <= 9) color = mix(color, CREAM, 0.55);
  return [color[0] / 255, color[1] / 255, color[2] / 255, 1];
}

function render(size, { rounded = true, scale = 1 } = {}) {
  const ss = 3;
  const data = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    data[py * (size * 4 + 1)] = 0; // PNG filter type: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          // Map pixel → design space; `scale` < 1 shrinks the artwork into the maskable safe zone.
          const ux = ((px + (sx + 0.5) / ss) / size - 0.5) / scale * 512 + 256;
          const uy = ((py + (sy + 0.5) / ss) / size - 0.5) / scale * 512 + 256;
          let c = shade(ux, uy, { rounded });
          if (!rounded && c[3] === 0) c = [GREEN[0] / 255, GREEN[1] / 255, GREEN[2] / 255, 1];
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const n = ss * ss;
      const offset = py * (size * 4 + 1) + 1 + px * 4;
      const alpha = a / n;
      data[offset] = alpha ? Math.round((r / a) * 255) : 0;
      data[offset + 1] = alpha ? Math.round((g / a) * 255) : 0;
      data[offset + 2] = alpha ? Math.round((b / a) * 255) : 0;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  return png(size, size, data);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}
function png(width, height, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon.svg", svg);
writeFileSync("public/icons/icon-192.png", render(192));
writeFileSync("public/icons/icon-512.png", render(512));
writeFileSync("public/icons/icon-maskable-512.png", render(512, { rounded: false, scale: 0.8 }));
writeFileSync("public/icons/apple-touch-icon.png", render(180, { rounded: false, scale: 0.9 }));
console.log("Icons written to public/icons");
