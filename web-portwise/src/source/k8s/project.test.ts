import { describe, expect, it } from "vitest";
import { YARD_BLOCKS } from "@/data/port";
import { naturalCompare } from "../assign";
import { namespace, node, pod, warning } from "./fixtures";
import { parseQuantity, projectPort } from "./project";
import type { ClusterAction, ClusterState } from "./reducer";
import { clusterReducer, emptyCluster } from "./reducer";
import { K8S_PORT_MAPPING, namespaceColor } from "./mapping";
import type { ResourceKey, ResourceObjects } from "./types";

const listed = (tables: { [K in ResourceKey]?: ResourceObjects[K][] }): ClusterState =>
  (Object.entries(tables) as Array<[ResourceKey, never[]]>).reduce(
    (s, [resource, items]) => clusterReducer(s, { type: "list", resource, items, resourceVersion: "1" } as ClusterAction),
    emptyCluster(),
  );

describe("parseQuantity", () => {
  it("parses cores, millicores and binary suffixes", () => {
    expect(parseQuantity("4")).toBe(4);
    expect(parseQuantity("3500m")).toBe(3.5);
    expect(parseQuantity("1Ki")).toBe(1024);
    expect(parseQuantity("bogus")).toBeNull();
  });
});

describe("projectPort", () => {
  it("is deterministic for the same state", () => {
    const s = listed({ nodes: [node("node-b"), node("node-a")], pods: [pod("web", "team-x", "1", { nodeName: "node-a" })] });
    expect(projectPort(s)).toEqual(projectPort(s));
  });

  it("berths nodes by name, independent of list order", () => {
    const a = projectPort(listed({ nodes: [node("node-b"), node("node-a")] }));
    const b = projectPort(listed({ nodes: [node("node-a"), node("node-b")] }));
    const berths = (p: typeof a) => p.vessels.map((v) => [v.name, v.berth]);
    expect(berths(a)).toEqual([["node-a", 1], ["node-b", 2]]);
    expect(berths(b)).toEqual(berths(a));
  });

  const nodeNames = (count: number): string[] => Array.from({ length: count }, (_, i) => `node-${String(i).padStart(2, "0")}`);

  it.each([0, 1, 5, 12])("lays out one berth per node for %i nodes, none at anchor", (count) => {
    const p = projectPort(listed({ nodes: nodeNames(count).map((n) => node(n)) }));
    expect(p.berths.map((b) => b.n)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    expect(p.vessels.every((v) => v.berth > 0 && v.anchorSlot === undefined)).toBe(true);
    expect(p.cranes).toHaveLength(count * K8S_PORT_MAPPING.berths.cranesPerBerth);
    expect(p.cranes.every((c) => c.vesselId)).toBe(true);
  });

  it("keeps hulls within their berth when the quay is crowded", () => {
    const p = projectPort(listed({ nodes: nodeNames(12).map((n) => node(n, "1", { cpu: "64" })) }));
    const length = p.berths[0].length;
    expect(p.vessels.every((v) => v.length <= length * K8S_PORT_MAPPING.berths.vesselShare)).toBe(true);
  });

  it("recomputes berths from sorted names when a node joins or leaves", () => {
    const berthsOf = (names: string[]) => Object.fromEntries(projectPort(listed({ nodes: names.map((n) => node(n)) })).vessels.map((v) => [v.name, v.berth]));
    expect(berthsOf(["node-c", "node-a"])).toEqual({ "node-a": 1, "node-c": 2 });
    expect(berthsOf(["node-c", "node-a", "node-d"])).toEqual({ "node-a": 1, "node-c": 2, "node-d": 3 });
    expect(berthsOf(["node-c", "node-a", "node-b"])).toEqual({ "node-a": 1, "node-b": 2, "node-c": 3 });
    expect(berthsOf(["node-c"])).toEqual({ "node-c": 1 });
  });

  it("maps namespaces to blocks and colors pods by namespace, with phase still carried in the detail labels", () => {
    const p = projectPort(
      listed({
        namespaces: [namespace("team-x"), namespace("team-y")],
        pods: [pod("web", "team-x", "1", { nodeName: "node-a" }), pod("job", "team-x", "1", { phase: "Failed", nodeName: "node-a" })],
      }),
    );
    expect(p.blocks.map((b) => b.meta?.headline)).toEqual(["team-x", "team-y"]);
    const block = p.blocks[0].id;
    const nsColor = namespaceColor("team-x", K8S_PORT_MAPPING.pod.namespaceColors);
    expect(p.containers.map((c) => [c.code, c.blockId, c.color, c.line])).toEqual([
      ["job", block, nsColor, K8S_PORT_MAPPING.pod.phases.Failed.label],
      ["web", block, nsColor, K8S_PORT_MAPPING.pod.phases.Running.label],
    ]);
    expect(p.containers[0].id).toBe("uid-pod-team-x-job");
    expect(p.containers[0].vesselId).toBe("node-node-a");
  });

  it("keeps the busiest namespaces in the yard and summarises the rest", () => {
    const max = K8S_PORT_MAPPING.yard.blocks;
    const namespaces = Array.from({ length: max + 3 }, (_, i) => namespace(`team-${String(i).padStart(2, "0")}`));
    const pods = [pod("p1", "team-42"), pod("p2", "team-42")];
    const p = projectPort(listed({ namespaces, pods }));
    expect(p.blocks).toHaveLength(max);
    expect(p.blocks.some((b) => b.meta?.headline === "team-42")).toBe(true);
    expect(p.overflow).toEqual({ label: K8S_PORT_MAPPING.yard.overflowLabel, groups: 3, items: 0 });
    expect(new Set(p.blocks.map((b) => b.id)).size).toBe(max);
    expect(p.blocks.every((b) => YARD_BLOCKS.some((g) => g.id === b.id))).toBe(true);
  });

  it("counts pending and unscheduled pods at the anchorage", () => {
    const p = projectPort(
      listed({
        pods: [
          pod("a", "team-x", "1", { phase: "Pending" }),
          pod("b", "team-x", "1", { phase: "Pending", nodeName: "node-a" }),
          pod("c", "team-x", "1", { nodeName: "node-a" }),
          pod("d", "team-x", "1", { phase: "Succeeded" }),
        ],
      }),
    );
    expect(p.anchorage?.count).toBe(2);
    expect(p.kpis?.find((k) => k.id === "waiting")?.value).toBe("2");
  });

  it("has no anchorage marker when nothing waits", () => {
    expect(projectPort(listed({ pods: [pod("c", "team-x", "1", { nodeName: "node-a" })] })).anchorage).toBeNull();
  });

  it("targets alerts at the node, pod or namespace they concern, newest first", () => {
    const p = projectPort(
      listed({
        nodes: [node("node-a")],
        namespaces: [namespace("team-x")],
        pods: [pod("web", "team-x")],
        events: [
          warning("e1", { kind: "Node", name: "node-a" }, "1", "2026-01-01T10:00:00Z"),
          warning("e2", { kind: "Pod", name: "web", namespace: "team-x", uid: "uid-pod-team-x-web" }, "1", "2026-01-01T11:00:00Z"),
          warning("e3", { kind: "Deployment", name: "api", namespace: "team-x" }, "1", "2026-01-01T12:00:00Z"),
          warning("e4", { kind: "Deployment", name: "api", namespace: "elsewhere" }, "1", "2026-01-01T09:00:00Z"),
        ],
      }),
    );
    const block = p.blocks.find((b) => b.meta?.headline === "team-x")?.id;
    expect(p.alerts.map((a) => [a.id, a.target])).toEqual([
      ["uid-ev-e3", { kind: "block", id: block }],
      ["uid-ev-e2", { kind: "container", id: "uid-pod-team-x-web" }],
      ["uid-ev-e1", { kind: "vessel", id: "node-node-a" }],
      ["uid-ev-e4", undefined],
    ]);
    expect(p.alerts[0].severity).toBe("danger");
  });

  it("stacks deck cargo from the pods on a node, oldest first, coloured by namespace", () => {
    const p = projectPort(
      listed({
        nodes: [node("node-a"), node("node-b")],
        pods: [
          pod("c", "team-x", "1", { nodeName: "node-a", created: "2026-01-01T10:00:00Z" }),
          pod("a", "team-x", "1", { nodeName: "node-a", phase: "Pending", created: "2026-01-01T08:00:00Z" }),
          pod("b", "team-y", "1", { nodeName: "node-a", created: "2026-01-01T08:00:00Z" }),
          pod("other", "team-z", "1", { nodeName: "node-b" }),
        ],
      }),
    );
    const vessel = p.vessels.find((v) => v.name === "node-a");
    const teamX = namespaceColor("team-x", K8S_PORT_MAPPING.pod.namespaceColors);
    const teamY = namespaceColor("team-y", K8S_PORT_MAPPING.pod.namespaceColors);
    expect(vessel?.meta?.deck).toEqual([
      { id: "uid-pod-team-x-a", label: "a", color: teamX },
      { id: "uid-pod-team-y-b", label: "b", color: teamY },
      { id: "uid-pod-team-x-c", label: "c", color: teamX },
    ]);
  });

  it("marks a crane active from recorded scheduling activity", () => {
    const s = listed({ nodes: [node("node-a"), node("node-b")] });
    const p = projectPort(s, { "node-a": { activeFrom: 1000, lastMoveAt: 2000, moves: 3 } });
    expect(p.cranes[0].activity).toEqual({ activeFrom: 1000, activeUntil: 2000 + K8S_PORT_MAPPING.crane.activeWindowMs, moves: 3 });
    expect(p.cranes[1].activity?.activeUntil).toBe(0);
  });
});

describe("projectPort block order", () => {
  it("lists blocks in natural id order", () => {
    const namespaces = Array.from({ length: 12 }, (_, i) => namespace(`team-${String(i).padStart(2, "0")}`));
    const ids = projectPort(listed({ namespaces })).blocks.map((b) => b.id);
    expect(ids).toEqual([...ids].sort(naturalCompare));
    expect(ids.indexOf("A2")).toBeLessThan(ids.indexOf("A10"));
  });
});
