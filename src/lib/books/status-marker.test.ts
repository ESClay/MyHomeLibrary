import { describe, expect, it } from "vitest";
import { STATUSES, STATUS_LABEL } from "@/lib/books/constants";
import { statusMarkerInfo } from "./status-marker";

describe("statusMarkerInfo", () => {
  it("shows nothing without a status", () => {
    expect(statusMarkerInfo(null)).toBeNull();
    expect(statusMarkerInfo(undefined)).toBeNull();
  });

  it("names every status for assistive tech and for the list", () => {
    for (const s of STATUSES) {
      expect(statusMarkerInfo(s)).toEqual({ status: s, label: STATUS_LABEL[s], name: `My status: ${STATUS_LABEL[s]}` });
    }
  });

  it("ignores an unknown status", () => {
    expect(statusMarkerInfo("bogus" as never)).toBeNull();
  });
});
