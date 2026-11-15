// Generates the PWA icons and favicon (no dependencies): node scripts/generate-icons.mjs
// Mark: three book spines on a brass shelf, on bookcloth green. Matches src/components/brand.tsx.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [47, 77, 64]; // #2f4d40 bookcloth green
const SHELF = [199, 154, 74]; // #c79a4a brass
const PAPER = [246, 240, 228]; // #f6f0e4

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (const byte of buf) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Bookcloth ground, three spines (paper, brass, paper) on a brass shelf; `scale` shrinks the glyph for maskable safe zones. */
function png(size, scale, rgba = false) {
  const bpp = rgba ? 4 : 3;
  const spines = [
    { x: 0.0, w: 0.26, h: 0.62, c: PAPER },
    { x: 0.32, w: 0.26, h: 0.82, c: SHELF },
    { x: 0.64, w: 0.26, h: 0.7, c: PAPER },
  ];
  const glyph = size * scale;
  const left = (size - glyph * 0.9) / 2;
  const base = size / 2 + glyph * 0.4;
  const shelfH = Math.max(2, glyph * 0.07);
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * bpp);
    for (let x = 0; x < size; x++) {
      let colour = BG;
      for (const s of spines) {
        if (x >= left + s.x * glyph && x < left + (s.x + s.w) * glyph && y <= base && y > base - s.h * glyph) {
          colour = s.c;
          // Two thin bands near the head of the spine, in the ground colour.
          const fromTop = (y - (base - s.h * glyph)) / glyph;
          if ((fromTop > 0.07 && fromTop < 0.1) || (fromTop > 0.13 && fromTop < 0.15)) colour = BG;
        }
      }
      if (y > base && y <= base + shelfH && x >= left - glyph * 0.06 && x < left + glyph * 0.96) colour = SHELF;
      row.set(rgba ? [...colour, 255] : colour, 1 + x * bpp);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, rgba ? 6 : 2, 0, 0, 0], 8); // 8-bit RGB(A)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192, 0.6));
writeFileSync("public/icons/icon-512.png", png(512, 0.6));
writeFileSync("public/icons/maskable-512.png", png(512, 0.42));
writeFileSync("src/app/apple-icon.png", png(180, 0.6));
// favicon.ico: a single 32x32 PNG entry.
const fav = png(32, 0.9, true);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2); // type: icon
ico.writeUInt16LE(1, 4); // one image
ico.set([32, 32, 0, 0], 6);
ico.writeUInt16LE(1, 10); // planes
ico.writeUInt16LE(32, 12); // bit depth
ico.writeUInt32LE(fav.length, 14);
ico.writeUInt32LE(22, 18);
writeFileSync("src/app/favicon.ico", Buffer.concat([ico, fav]));
console.log("Icons written.");
