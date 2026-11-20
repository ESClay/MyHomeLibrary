import { describe, expect, it } from "vitest";
import { isOwnScanPath, photoRowState, unfinishedUploads } from "./batch";

const LIB = "3a7d1c11-2f6e-4a52-8f33-9b9e0f5b3a7d";
const USER = "2f6e1a52-8f33-4c1b-9b9e-0f5b3a7d1c11";
const FILE = "7ebf5a55-6da2-4e96-8d77-3f9f7ebf5a55.jpg";

describe("isOwnScanPath", () => {
  it("accepts a photo in the person's own folder", () => {
    expect(isOwnScanPath(`${LIB}/${USER}/${FILE}`, USER, LIB)).toBe(true);
    expect(isOwnScanPath(`${LIB}/${USER}/${FILE}`, USER)).toBe(true);
  });
  it("rejects someone else's folder, another library, odd names and extra segments", () => {
    expect(isOwnScanPath(`${LIB}/other/${FILE}`, USER)).toBe(false);
    expect(isOwnScanPath(`other/${USER}/${FILE}`, USER, LIB)).toBe(false);
    expect(isOwnScanPath(`${LIB}/${USER}/../${FILE}`, USER)).toBe(false);
    expect(isOwnScanPath(`${LIB}/${USER}/notes.txt`, USER)).toBe(false);
    expect(isOwnScanPath(`${LIB}/${USER}/${FILE}/x`, USER)).toBe(false);
  });
});

describe("unfinishedUploads", () => {
  it("clears photos in Storage that were never queued, and keeps queued ones", () => {
    expect(
      unfinishedUploads([
        { path: "a", state: "queued" },
        { path: "b", state: "uploaded" },
        { path: "c", state: "uploading" },
        { path: null, state: "waiting" },
        { path: null, state: "failed" },
      ]),
    ).toEqual(["b", "c"]);
  });
  it("clears nothing once every photo is queued", () => {
    expect(unfinishedUploads([{ path: "a", state: "queued" }, { path: "b", state: "queued" }])).toEqual([]);
  });
});

describe("photoRowState", () => {
  const run = { status: "running", capWait: false };
  it("reads each photo from its own row and its batch", () => {
    expect(photoRowState({ status: "ready", photo_deleted_at: null }, run)).toBe("ready");
    expect(photoRowState({ status: "ready", photo_deleted_at: "x" }, run)).toBe("cleared");
    expect(photoRowState({ status: "saved", photo_deleted_at: "x" }, run)).toBe("saved");
    expect(photoRowState({ status: "failed", photo_deleted_at: null }, run)).toBe("failed");
    expect(photoRowState({ status: "processing", photo_deleted_at: null }, run)).toBe("reading");
    expect(photoRowState({ status: "pending", photo_deleted_at: null }, run)).toBe("queued");
  });
  it("shows waiting for the allowance only while the batch is waiting on it", () => {
    expect(photoRowState({ status: "pending", photo_deleted_at: null }, { status: "queued", capWait: true })).toBe("waiting_cap");
    expect(photoRowState({ status: "pending", photo_deleted_at: null }, { status: "cancelled", capWait: true })).toBe("stopped");
  });
});
