import { describe, expect, it } from "vitest";
import { changeState, mergeChange, planUndo } from "./changes";

describe("mergeChange", () => {
  it("keeps the first before and the last after for each field", () => {
    const a = { bookId: "b", before: { hardcover_id: null }, after: { hardcover_id: 11 } };
    const b = { bookId: "b", before: { series_id: null }, after: { series_id: "s1" } };
    const c = { bookId: "b", before: { series_name: null, series_position: null }, after: { series_name: "Dune", series_position: 1 } };
    const m = mergeChange(mergeChange(mergeChange(undefined, a), b), c);
    expect(m.before).toEqual({ hardcover_id: null, series_id: null, series_name: null, series_position: null });
    expect(m.after).toEqual({ hardcover_id: 11, series_id: "s1", series_name: "Dune", series_position: 1 });
    const later = mergeChange(m, { bookId: "b", before: { series_position: 1 }, after: { series_position: 2 } });
    expect(later.before.series_position).toBeNull();
    expect(later.after.series_position).toBe(2);
  });

  it("drops a field that ends where it started", () => {
    const m = mergeChange({ bookId: "b", before: { series_position: null }, after: { series_position: 3 } }, { bookId: "b", before: { series_position: 3 }, after: { series_position: null } });
    expect(m).toEqual({ bookId: "b", before: {}, after: {} });
  });
});

describe("planUndo: restore only what still equals what the job wrote", () => {
  const change = { before: { series_id: null, series_name: null, series_position: null }, after: { series_id: "s1", series_name: "Dune", series_position: 1 } };

  it("restores every field when nothing was edited", () => {
    const plan = planUndo(change, { series_id: "s1", series_name: "Dune", series_position: 1, title: "x" });
    expect(plan.restore).toEqual({ series_id: null, series_name: null, series_position: null });
    expect(plan.edited).toEqual([]);
  });

  it("leaves a field edited since alone and restores the rest", () => {
    const plan = planUndo(change, { series_id: "s1", series_name: "Dune Saga", series_position: 1 });
    expect(plan.restore).toEqual({ series_id: null, series_position: null });
    expect(plan.edited).toEqual(["series_name"]);
  });

  it("treats a number that came back as a string-free equal number as unchanged", () => {
    expect(planUndo({ before: { series_position: null }, after: { series_position: 2 } }, { series_position: 2 }).restore).toEqual({ series_position: null });
  });

  it("restores nothing when every field was edited", () => {
    const plan = planUndo(change, { series_id: null, series_name: "Mine", series_position: 9 });
    expect(plan.restore).toEqual({});
    expect(plan.edited).toHaveLength(3);
  });

  it("ignores fields the job did not touch", () => {
    expect(planUndo({ before: { hardcover_id: null }, after: { hardcover_id: 5 } }, { hardcover_id: 5, series_name: "Typed" }).restore).toEqual({ hardcover_id: null });
  });
});

describe("changeState", () => {
  const change = { before: { series_name: null }, after: { series_name: "Dune" } };
  it("reads applied, edited since and undone", () => {
    expect(changeState(change, { series_name: "Dune" })).toBe("applied");
    expect(changeState(change, { series_name: "Other" })).toBe("edited");
    expect(changeState({ ...change, undoneAt: "2026-11-20T00:00:00Z" }, { series_name: null })).toBe("undone");
  });
});
