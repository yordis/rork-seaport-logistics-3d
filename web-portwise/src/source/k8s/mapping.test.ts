import { describe, expect, it } from "vitest";
import { K8S_PORT_MAPPING, namespaceColor } from "./mapping";

describe("namespaceColor", () => {
  const palette = K8S_PORT_MAPPING.pod.namespaceColors;

  it("is deterministic for the same namespace", () => {
    expect(namespaceColor("team-x", palette)).toBe(namespaceColor("team-x", palette));
  });

  it("maps different namespaces onto the palette", () => {
    expect(palette).toContain(namespaceColor("team-x", palette));
    expect(palette).toContain(namespaceColor("team-y", palette));
  });
});

describe("trucks mapping", () => {
  it("caps the wait for an unmatched Pulling comfortably over the lookback window", () => {
    expect(K8S_PORT_MAPPING.trucks.pull.waitCapSec * 1000).toBeGreaterThan(K8S_PORT_MAPPING.trucks.window);
  });

  it("reuses the scheduler as the ITV carrier instead of duplicating the crane operator label", () => {
    expect(K8S_PORT_MAPPING.trucks.schedule.carrier).toBe(K8S_PORT_MAPPING.crane.operator);
  });
});
