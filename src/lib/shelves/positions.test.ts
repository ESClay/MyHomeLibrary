import { describe, expect, it } from "vitest";
import { GAP, appendPositions, planMove, planReorder, positionBetween, renormalize, type Positioned } from "./positions";

const list = (...ids: string[]): Positioned[] => ids.map((id, i) => ({ id, pos: (i + 1) * GAP }));
const apply = (l: Positioned[], updates: Positioned[]) => {
  const m = new Map(l.map((p) => [p.id, p.pos]));
  for (const u of updates) m.set(u.id, u.pos);
  return [...m.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
};

describe("positionBetween", () => {
  it("handles the ends and the middle", () => {
    expect(positionBetween(null, null)).toBe(GAP);
    expect(positionBetween(null, 1024)).toBe(0);
    expect(positionBetween(2048, null)).toBe(3072);
    expect(positionBetween(1024, 2048)).toBe(1536);
  });
  it("returns null when no integer fits", () => {
    expect(positionBetween(5, 6)).toBeNull();
    expect(positionBetween(5, 5)).toBeNull();
  });
});

describe("planMove", () => {
  it("inserts between two neighbours with one write", () => {
    const l = list("a", "b", "c", "d");
    const plan = planMove(l, "d", 1);
    expect(plan.order).toEqual(["a", "d", "b", "c"]);
    expect(plan.updates).toEqual([{ id: "d", pos: 1536 }]);
    expect(plan.renormalized).toBe(false);
  });
  it("moves to the start and to the end", () => {
    const l = list("a", "b", "c");
    expect(planMove(l, "c", 0).updates).toEqual([{ id: "c", pos: 0 }]);
    expect(planMove(l, "a", 99).updates).toEqual([{ id: "a", pos: 4096 }]);
    expect(planMove(l, "a", 99).order).toEqual(["b", "c", "a"]);
  });
  it("writes nothing for a move to the same place or an unknown id", () => {
    const l = list("a", "b", "c");
    expect(planMove(l, "b", 1).updates).toEqual([]);
    expect(planMove(l, "zz", 0).updates).toEqual([]);
  });
  it("renormalizes when the gap is used up", () => {
    const l: Positioned[] = [
      { id: "a", pos: 10 },
      { id: "b", pos: 11 },
      { id: "c", pos: 12 },
    ];
    const plan = planMove(l, "c", 1);
    expect(plan.renormalized).toBe(true);
    expect(plan.updates).toEqual(renormalize(["a", "c", "b"]));
    expect(apply(l, plan.updates)).toEqual(["a", "c", "b"]);
  });
  it("many inserts at the same spot eventually renormalize and keep the order right", () => {
    let l = list("a", "b", "x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8", "x9", "x10", "x11", "x12");
    for (let i = 1; i <= 12; i++) {
      const plan = planMove(l, `x${i}`, 1);
      l = l.map((p) => ({ ...p, pos: plan.updates.find((u) => u.id === p.id)?.pos ?? p.pos }));
      expect(apply(l, [])).toEqual(plan.order);
    }
  });
  it("ties are stable by id", () => {
    const l: Positioned[] = [
      { id: "b", pos: 5 },
      { id: "a", pos: 5 },
    ];
    expect(planMove(l, "a", 0).order).toEqual(["a", "b"]);
  });
});

describe("planReorder", () => {
  it("turns a single move into one write", () => {
    const l = list("a", "b", "c", "d");
    const plan = planReorder(l, ["a", "c", "d", "b"]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.renormalized).toBe(false);
    expect(apply(l, plan.updates)).toEqual(["a", "c", "d", "b"]);
  });
  it("is a no-op for the same order and ignores unknown ids", () => {
    const l = list("a", "b");
    expect(planReorder(l, ["a", "b"]).updates).toEqual([]);
    expect(planReorder(l, ["nope", "a", "b"]).updates).toEqual([]);
  });
  it("renormalizes for a shuffle that is not one move", () => {
    const l = list("a", "b", "c", "d");
    const plan = planReorder(l, ["b", "a", "d", "c"]);
    expect(plan.renormalized).toBe(true);
    expect(apply(l, plan.updates)).toEqual(["b", "a", "d", "c"]);
  });
  it("keeps ids that were left out at the end", () => {
    expect(planReorder(list("a", "b", "c"), ["c", "a"]).order).toEqual(["c", "a", "b"]);
  });
});

describe("appendPositions", () => {
  it("places new rows after the last one", () => {
    expect(appendPositions(list("a", "b"), ["x", "y"])).toEqual([
      { id: "x", pos: 3072 },
      { id: "y", pos: 4096 },
    ]);
    expect(appendPositions([], ["x"])).toEqual([{ id: "x", pos: GAP }]);
  });
});
