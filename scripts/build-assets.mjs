// Exports the pet art the WeChat mini program ships: the exact pixels of CastAtlas.swift, scaled up
// with hard edges (mini programs can't be trusted to keep pixel art sharp when they scale it), plus a
// 5:4 share-card cover per pet.
// The art lives in the desktop repo (realvivianqiao/tamagotchi). Expects it cloned next to this one, or
// point BOOP_DESKTOP at it:
//   node scripts/build-assets.mjs
//   BOOP_DESKTOP=/path/to/tamagotchi node scripts/build-assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = process.env.BOOP_DESKTOP || path.join(here, '..', '..', 'tamagotchi');
const out = path.join(here, '..', 'images');
const atlasFile = path.join(desktop, 'CastAtlas.swift');
if (!fs.existsSync(atlasFile)) {
  console.error(`Can't find ${atlasFile}. Clone realvivianqiao/tamagotchi next to this repo or set BOOP_DESKTOP.`);
  process.exit(1);
}
fs.mkdirSync(path.join(out, 'pets'), { recursive: true });
fs.mkdirSync(path.join(out, 'share'), { recursive: true });

// ---------- CastAtlas.swift → frames (same decoding as windows/scripts/build-assets.mjs) ----------
const cast = fs.readFileSync(atlasFile, 'utf8');
const packed = (() => {
  const block = cast.slice(cast.indexOf('static let packed = ['));
  return [...block.slice(0, block.indexOf('].joined()')).matchAll(/"([A-Za-z0-9+/=]+)"/g)].map((m) => m[1]).join('');
})();
const raw = zlib.inflateRawSync(Buffer.from(packed, 'base64'));
const colors = cast.match(/static let colors: \[UInt32\] = \[([^\]]*)\]/)[1]
  .split(',').map((s) => s.trim()).filter(Boolean).map((s) => (s === '0' ? null : parseInt(s, 16)));
const SPECIES = JSON.parse(cast.match(/static let species = (\[[^\]]*\])/)[1]);
const POSES = JSON.parse(cast.match(/static let poses = (\[[^\]]*\])/)[1]);
const EYES = JSON.parse(cast.match(/static let eyes = (\[[^\]]*\])/)[1]);
const W = 38, H = 28, N = W * H;

function frame(species, pose, eyes = 'open', tongue = 0, wag = 0) {
  const i = (((SPECIES.indexOf(species) * POSES.length + POSES.indexOf(pose)) * EYES.length + EYES.indexOf(eyes)) * 2 + tongue) * 2 + wag;
  if (i < 0 || (i + 1) * N > raw.length) throw new Error(`no frame ${species}/${pose}/${eyes}`);
  return Array.from({ length: N }, (_, k) => colors[raw[i * N + k]] ?? null);
}

// ---------- tiny PNG writer ----------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(rows, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- pet frames: one shared box per species so swapping frames never shifts the pet ----------
const PETS = ['dog', 'bird', 'octopus', 'cat', 'frog'];
const FRAMES = {
  sit: ['sit', 'open', 0], blink: ['sit', 'closed', 0], happy: ['sit', 'happy', 1], angry: ['sit', 'angry', 0],
  sad: ['sit', 'sad', 0], sleep: ['lie', 'closed', 0], walk0: ['walk0', 'open', 0], walk1: ['walk1', 'open', 0],
};
const SCALE = 10;
let bytes = 0;
for (const sp of PETS) {
  const frames = Object.fromEntries(Object.entries(FRAMES).map(([k, [pose, eyes, tongue]]) => [k, frame(sp, pose, eyes, tongue)]));
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (const px of Object.values(frames)) px.forEach((c, k) => {
    if (c == null) return;
    const x = k % W, y = Math.floor(k / W);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  });
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, ow = bw * SCALE, oh = bh * SCALE;
  for (const [name, px] of Object.entries(frames)) {
    const buf = Buffer.alloc(ow * oh * 4);
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
      const c = px[(y0 + Math.floor(y / SCALE)) * W + x0 + Math.floor(x / SCALE)];
      if (c == null) continue;
      const o = (y * ow + x) * 4;
      buf[o] = (c >> 16) & 255; buf[o + 1] = (c >> 8) & 255; buf[o + 2] = c & 255; buf[o + 3] = 255;
    }
    const file = png(ow, oh, buf);
    fs.writeFileSync(path.join(out, 'pets', `${sp}_${name}.png`), file);
    bytes += file.length;
  }

  // Share-card cover (WeChat shows these at 5:4): the pet, happy, on the room's floor.
  const CW = 500, CH = 400, floorY = 316;
  const cover = Buffer.alloc(CW * CH * 4);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const o = (y * CW + x) * 4, floor = y >= floorY;
    cover[o] = floor ? 0xf6 : 0xff; cover[o + 1] = floor ? 0xdd : 0xf1; cover[o + 2] = floor ? 0xb0 : 0xd6; cover[o + 3] = 255;
  }
  const s = Math.min(Math.floor(380 / bw), Math.floor(270 / bh));
  const left = Math.round((CW - bw * s) / 2), top = floorY + 20 - bh * s;
  frames.happy.forEach((c, k) => {
    const x = k % W - x0, y = Math.floor(k / W) - y0;
    if (c == null || x < 0 || y < 0 || x >= bw || y >= bh) return;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
      const o = ((top + y * s + dy) * CW + left + x * s + dx) * 4;
      cover[o] = (c >> 16) & 255; cover[o + 1] = (c >> 8) & 255; cover[o + 2] = c & 255;
    }
  });
  const file = png(CW, CH, cover);
  fs.writeFileSync(path.join(out, 'share', `${sp}.png`), file);
  bytes += file.length;
}

// The pixel heart that floats up during visits and taps.
{
  const rows = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
  const S = 8, w = rows[0].length * S, h = rows.length * S, buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rows[Math.floor(y / S)][Math.floor(x / S)] !== 'X') continue;
    const o = (y * w + x) * 4;
    buf[o] = 0xe2; buf[o + 1] = 0x58; buf[o + 2] = 0x7a; buf[o + 3] = 255;
  }
  const file = png(w, h, buf);
  fs.writeFileSync(path.join(out, 'heart.png'), file);
  bytes += file.length;
}
console.log(`images: ${PETS.length * (Object.keys(FRAMES).length + 1) + 1} files, ${(bytes / 1024).toFixed(0)} KB`);
