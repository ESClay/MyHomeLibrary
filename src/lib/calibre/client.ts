/** Browser-side file reading. The CSV is parsed in a Web Worker so a 10,000-row file never freezes the page. */
import { MAX_FILE_BYTES, MAX_ROWS } from "./limits";
import { parseCalibreCsv } from "./parse";
import type { WorkerMessage } from "./parse.worker";
import type { ParsedCatalog } from "./types";

export type ParseProgress = (fraction: number) => void;

/** Decodes the file as UTF-8 (a BOM is dropped by the parser). Falls back to Windows-1252 for files re-saved by Excel. */
export async function readCatalogText(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export async function parseCatalogFile(file: File, onProgress?: ParseProgress): Promise<ParsedCatalog> {
  if (file.size > MAX_FILE_BYTES) throw new Error("That file is larger than 25 MB. Export fewer fields and try again.");
  const text = await readCatalogText(file);

  let catalog: ParsedCatalog;
  if (typeof Worker === "undefined") {
    // No worker support: parse on this thread, yielding between chunks.
    catalog = await parseCalibreCsv(text, { onProgress });
  } else {
    catalog = await new Promise<ParsedCatalog>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL("./parse.worker.ts", import.meta.url), { type: "module" });
      } catch {
        // The worker could not start (a strict browser setting): fall back to chunked parsing here.
        parseCalibreCsv(text, { onProgress }).then(resolve, reject);
        return;
      }
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const msg = event.data;
        if (msg.type === "progress") onProgress?.(msg.fraction);
        else {
          worker.terminate();
          if (msg.type === "done") resolve(msg.catalog);
          else reject(new Error(msg.message));
        }
      };
      worker.onerror = () => {
        worker.terminate();
        reject(new Error("The file could not be read."));
      };
      worker.postMessage({ text });
    });
  }
  if (catalog.rows.length > MAX_ROWS) {
    throw new Error(`That catalog has ${catalog.rows.length.toLocaleString("en")} rows. One import can hold ${MAX_ROWS.toLocaleString("en")}.`);
  }
  return catalog;
}
