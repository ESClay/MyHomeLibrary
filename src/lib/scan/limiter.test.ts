import { describe, expect, it } from "vitest";
import { createLimiter } from "./limiter";

describe("createLimiter", () => {
  it("never runs more than max tasks at once and finishes them all", async () => {
    const run = createLimiter(3);
    let active = 0;
    let peak = 0;
    const task = async (n: number) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n;
    };
    const out = await Promise.all(Array.from({ length: 10 }, (_, i) => run(() => task(i))));
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(peak).toBe(3);
  });
  it("keeps going after a task fails", async () => {
    const run = createLimiter(1);
    const bad = run(() => Promise.reject(new Error("x")));
    const good = run(async () => "ok");
    await expect(bad).rejects.toThrow("x");
    await expect(good).resolves.toBe("ok");
  });
});
