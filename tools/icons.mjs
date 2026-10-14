// Tema — draw the icon.
//
//   node tools/icons.mjs
//
// The mark is テ, the first kana of テーマ (tēma, "theme"), drawn on a 16x16
// pixel grid below. Pixel art scales cleanly only by whole numbers, so every
// size is the same grid at an integer factor: 16 (x1), 32 (x2), 48 (x3) and
// 128 (x8). Writes icons/icon{16,32,48,128}.png and src/popup/logo.svg.
// No dependencies: the PNGs are encoded here with node:zlib.

import { writeFile, mkdir } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The glyph, on its own. The tile, a 1px drop shadow and the spark are
// composed around it below, so the strokes can be redrawn without
// repainting everything else by hand.
const GLYPH = [
  "................",
  "................",
  "................",
  "....wwwwwwww....",
  "....wwwwwwww....",
  "................",
  "..wwwwwwwwwwww..",
  "..wwwwwwwwwwww..",
  ".......ww.......",
  ".......ww.......",
  "......www.......",
  ".....www........",
  "...wwww.........",
  "...www..........",
  "................",
  "................",
];
const N = GLYPH.length;
for (const row of GLYPH) if (row.length !== N) throw new Error("grid rows must be " + N + " wide");

// The spark: a gold plus at the top right, the menu cursor's colour.
const SPARK = [[13, 1], [12, 2], [13, 2], [14, 2], [13, 3]];

// Rounded tile: the corners lose two pixels on the outer rows, one on the next.
const inTile = (x, y) => {
  const cut = y === 0 || y === N - 1 ? 2 : y === 1 || y === N - 2 ? 1 : 0;
  return x >= cut && x < N - cut;
};
// Indigo, lighter at the top.
const TOP = [43, 53, 144], BOTTOM = [20, 25, 71];
const tileAt = (y) => [...TOP.map((c, i) => Math.round(c + (BOTTOM[i] - c) * (y / (N - 1)))), 255];
const WHITE = [244, 246, 255, 255];
const SHADOW = [9, 11, 38, 255];
const GOLD = [255, 215, 94, 255];

const isGlyph = (x, y) => GLYPH[y] && GLYPH[y][x] === "w";
function pixel(x, y) {
  if (SPARK.some(([sx, sy]) => sx === x && sy === y)) return GOLD;
  if (isGlyph(x, y)) return WHITE;
  if (!inTile(x, y)) return [0, 0, 0, 0];
  if (isGlyph(x - 1, y - 1)) return SHADOW;
  return tileAt(y);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(scale) {
  const size = N * scale;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;   // filter: none
    for (let x = 0; x < size; x++) {
      raw.set(pixel(Math.floor(x / scale), Math.floor(y / scale)), row + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function svg() {
  // One rect per horizontal run of a colour, crisp at any size.
  const hex = (c) => "#" + c.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");
  let rects = "";
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N;) {
      const px = pixel(x, y);
      let end = x + 1;
      while (end < N && pixel(end, y).join() === px.join()) end++;
      if (px[3]) rects += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${hex(px)}"/>`;
      x = end;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges">${rects}</svg>\n`;
}

await mkdir(resolve(ROOT, "icons"), { recursive: true });
for (const [size, scale] of [[16, 1], [32, 2], [48, 3], [128, 8]]) {
  await writeFile(resolve(ROOT, `icons/icon${size}.png`), png(scale));
}
await writeFile(resolve(ROOT, "src/popup/logo.svg"), svg(), "utf8");
console.log("wrote icons/icon{16,32,48,128}.png and src/popup/logo.svg");
