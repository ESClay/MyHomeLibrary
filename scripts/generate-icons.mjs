// Generates placeholder PWA icons (no dependencies): node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [23, 23, 23]; // #171717
const FG = [250, 250, 250];

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

/** Solid background with three book spines; `scale` shrinks the glyph for maskable safe zones. */
function png(size, scale) {
  const spines = [
    { x: 0.0, w: 0.26, h: 0.7 },
    { x: 0.32, w: 0.26, h: 0.9 },
    { x: 0.64, w: 0.26, h: 0.78 },
  ];
  const glyph = size * scale;
  const left = (size - glyph * 0.9) / 2;
  const base = size / 2 + glyph * 0.45;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const inside = spines.some(
        (s) =>
          x >= left + s.x * glyph && x < left + (s.x + s.w) * glyph && y <= base && y > base - s.h * glyph,
      );
      const [r, g, b] = inside ? FG : BG;
      row.set([r, g, b], 1 + x * 3);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
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
console.log("Icons written.");
