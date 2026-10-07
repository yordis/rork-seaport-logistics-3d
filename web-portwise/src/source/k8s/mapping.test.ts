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
