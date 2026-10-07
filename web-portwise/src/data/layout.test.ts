import { describe, expect, it } from "vitest";
import { BERTH_COUNT, BERTHS } from "./port";
import { BERTH_SPACING, QUAY_MAX_X, QUAY_MIN_X, berthX, craneXs, layoutBerths, quayExtent, quayShotX } from "./layout";

describe("layoutBerths", () => {
  it("keeps the simulation's berths exactly where they were", () => {
    expect(BERTHS).toHaveLength(BERTH_COUNT);
    expect(BERTHS.map((b) => b.x)).toEqual(Array.from({ length: BERTH_COUNT }, (_, i) => berthX(i + 1)));
    expect(BERTHS.every((b) => b.length === BERTH_SPACING)).toBe(true);
    expect(quayExtent(BERTHS)).toEqual([QUAY_MIN_X, QUAY_MAX_X]);
  });

  it("uses the standard berth length from the quay origin when few berths exist", () => {
    const five = layoutBerths(5);
    expect(five.map((b) => b.x)).toEqual(BERTHS.slice(0, 5).map((b) => b.x));
    expect(quayExtent(five)[1]).toBeLessThan(QUAY_MAX_X);
  });

  it.each([12, 30, 100])("fits %i berths and their cranes within the quay", (count) => {
    const berths = layoutBerths(count);
    expect(berths).toHaveLength(count);
    expect(berths[0].length).toBeLessThan(BERTH_SPACING);
    for (const b of berths) {
      expect(b.x - b.length / 2).toBeGreaterThanOrEqual(QUAY_MIN_X);
      expect(b.x + b.length / 2).toBeLessThanOrEqual(QUAY_MAX_X);
      for (const x of craneXs(b, 2)) expect(Math.abs(x - b.x)).toBeLessThan(b.length / 2);
    }
    berths.slice(1).forEach((b, i) => expect(b.x).toBeGreaterThan(berths[i].x));
  });

  it("has no berths for zero nodes", () => {
    expect(layoutBerths(0)).toEqual([]);
  });
});

describe("quayShotX", () => {
  it("leaves the authored shot alone for the full quay and with no berths", () => {
    expect(quayShotX(-20, BERTHS)).toBe(-20);
    expect(quayShotX(-20, [])).toBe(-20);
  });

  it("follows a short quay and stays within it", () => {
    const five = layoutBerths(5);
    const [lo, hi] = quayExtent(five);
    const x = quayShotX(-20, five);
    expect(x).toBeLessThan(-20);
    expect(x).toBeGreaterThan(lo);
    expect(x).toBeLessThan(hi);
    const twelve = layoutBerths(12);
    expect(quayShotX(-20, twelve)).toBe(-20);
  });
});
