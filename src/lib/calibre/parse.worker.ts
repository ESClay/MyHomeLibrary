/// <reference lib="webworker" />
import { parseCalibreCsv } from "./parse";

export type WorkerRequest = { text: string };
export type WorkerMessage =
  | { type: "progress"; fraction: number }
  | { type: "done"; catalog: Awaited<ReturnType<typeof parseCalibreCsv>> }
  | { type: "error"; message: string };

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  try {
    const catalog = await parseCalibreCsv(event.data.text, {
      onProgress: (fraction) => self.postMessage({ type: "progress", fraction } satisfies WorkerMessage),
    });
    self.postMessage({ type: "done", catalog } satisfies WorkerMessage);
  } catch (e) {
    self.postMessage({ type: "error", message: e instanceof Error ? e.message : "The file could not be read." } satisfies WorkerMessage);
  }
};
