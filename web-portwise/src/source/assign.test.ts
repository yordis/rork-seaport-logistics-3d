import { describe, expect, it } from "vitest";
import { assignBerths, assignSlots, naturalCompare, stableHash } from "./assign";

describe("assignBerths", () => {
  it("gives every name a berth in sorted order, independent of input order", () => {
    const a = assignBerths(["node-c", "node-a", "node-b"]);
    expect([...a]).toEqual([["node-a", 1], ["node-b", 2], ["node-c", 3]]);
    expect([...assignBerths(["node-b", "node-c", "node-a"])]).toEqual([...a]);
  });

  it("deduplicates names", () => {
    expect(assignBerths(["node-a", "node-a"]).size).toBe(1);
  });
});

describe("assignSlots", () => {
  const slots = ["A1", "A2"];

  it("gives slots to the busiest groups and lays winners out by name", () => {
    const r = assignSlots(new Map([["team-z", 9], ["team-a", 1], ["team-m", 5]]), slots);
    expect([...r.slots]).toEqual([["team-m", "A1"], ["team-z", "A2"]]);
    expect(r.overflow).toEqual(["team-a"]);
  });

  it("breaks count ties by name", () => {
    const r = assignSlots(new Map([["team-b", 3], ["team-a", 3], ["team-c", 3]]), slots);
    expect([...r.slots.keys()]).toEqual(["team-a", "team-b"]);
    expect(r.overflow).toEqual(["team-c"]);
  });

  it("is stable while the winning set is unchanged", () => {
    const before = assignSlots(new Map([["team-x", 4], ["team-y", 2]]), slots);
    const after = assignSlots(new Map([["team-y", 7], ["team-x", 4]]), slots);
    expect([...after.slots]).toEqual([...before.slots]);
  });
});

describe("stableHash", () => {
  it("is deterministic", () => {
    expect(stableHash("node-a")).toBe(stableHash("node-a"));
    expect(stableHash("node-a")).not.toBe(stableHash("node-b"));
  });
});

describe("naturalCompare", () => {
  it("orders block ids by row letter, then numeric bay", () => {
    expect(["A10", "B1", "A2", "A1"].sort(naturalCompare)).toEqual(["A1", "A2", "A10", "B1"]);
  });
});
