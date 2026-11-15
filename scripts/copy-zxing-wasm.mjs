// Copies the barcode decoder's WebAssembly file into public/ so the scanner loads it from our own origin
// instead of a CDN. Runs after `npm install`; public/zxing_reader.wasm is not committed.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = resolve(root, "node_modules/zxing-wasm/dist/reader/zxing_reader.wasm");
const to = resolve(root, "public/zxing_reader.wasm");

if (!existsSync(from)) {
  console.warn("zxing-wasm is not installed; skipping the wasm copy.");
} else {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
