import { describe, expect, it } from "vitest";
import { moveItem, orderReducer } from "./order";

describe("row order reducer", () => {
  const rows = ["a", "b", "c", "d"];
  it("moves a row to an index", () => {
    expect(orderReducer(rows, { type: "move", id: "a", to: 2 })).toEqual(["b", "c", "a", "d"]);
    expect(orderReducer(rows, { type: "move", id: "d", to: 0 })).toEqual(["d", "a", "b", "c"]);
  });
  it("steps up and down, stopping at the ends", () => {
    expect(orderReducer(rows, { type: "up", id: "c" })).toEqual(["a", "c", "b", "d"]);
    expect(orderReducer(rows, { type: "down", id: "b" })).toEqual(["a", "c", "b", "d"]);
    expect(orderReducer(rows, { type: "up", id: "a" })).toBe(rows);
    expect(orderReducer(rows, { type: "down", id: "d" })).toBe(rows);
  });
  it("ignores unknown ids and out of range targets", () => {
    expect(orderReducer(rows, { type: "move", id: "zz", to: 1 })).toBe(rows);
    expect(orderReducer(rows, { type: "move", id: "a", to: 9 })).toBe(rows);
  });
  it("resets to the server's order", () => {
    expect(orderReducer(rows, { type: "reset", ids: ["x"] })).toEqual(["x"]);
  });
  it("moveItem does not mutate and clamps", () => {
    const src = ["a", "b", "c"];
    expect(moveItem(src, 0, 99)).toEqual(["b", "c", "a"]);
    expect(src).toEqual(["a", "b", "c"]);
  });
});
