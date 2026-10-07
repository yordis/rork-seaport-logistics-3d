import { describe, expect, it } from "vitest";
import { event, namespace, node, pod } from "./fixtures";
import { SHUTTLE_ID_PREFIX, parseImageRef } from "./trips";
import type { PortSnapshot } from "../model";
import { projectPort } from "./project";
import type { ClusterAction, ClusterState } from "./reducer";
import { clusterReducer, emptyCluster } from "./reducer";
import { K8S_PORT_MAPPING } from "./mapping";
import type { ResourceKey, ResourceObjects } from "./types";

const eventTrucks = (p: PortSnapshot) => (p.trucks ?? []).filter((t) => !t.id.startsWith(SHUTTLE_ID_PREFIX));
const shuttles = (p: PortSnapshot) => (p.trucks ?? []).filter((t) => t.id.startsWith(SHUTTLE_ID_PREFIX));

const listed = (tables: { [K in ResourceKey]?: ResourceObjects[K][] }): ClusterState =>
  (Object.entries(tables) as Array<[ResourceKey, never[]]>).reduce(
    (s, [resource, items]) => clusterReducer(s, { type: "list", resource, items, resourceVersion: "1" } as ClusterAction),
    emptyCluster(),
  );

describe("parseImageRef", () => {
  it.each<[string, string, { registry: string; plate: string }]>([
    ["nginx", "docker.io", { registry: "docker.io", plate: "nginx" }],
    ["nginx:1.21", "docker.io", { registry: "docker.io", plate: "nginx:1.21" }],
    ["docker.io/library/nginx:1.21", "docker.io", { registry: "docker.io", plate: "library/nginx:1.21" }],
    ["registry.example.com:5000/app:1.0", "docker.io", { registry: "registry.example.com:5000", plate: "app:1.0" }],
    ["nginx@sha256:deadbeef", "docker.io", { registry: "docker.io", plate: "nginx" }],
    ["nginx:1.21@sha256:deadbeef", "docker.io", { registry: "docker.io", plate: "nginx:1.21" }],
    ["gcr.io/distroless/static", "quay.io", { registry: "gcr.io", plate: "distroless/static" }],
  ])("parses %s against default registry %s", (image, defaultRegistry, expected) => {
    expect(parseImageRef(image, defaultRegistry)).toEqual(expected);
  });
});

describe("buildTrucks (via projectPort)", () => {
  const pullingEvent = (name: string, podName: string, at: string) =>
    event(name, {
      reason: "Pulling",
      message: 'Pulling image "docker.io/library/nginx:1.21"',
      involved: { kind: "Pod", name: podName, namespace: "team-x", uid: `uid-pod-team-x-${podName}` },
      at,
    });

  const pulledEvent = (name: string, podName: string, at: string) =>
    event(name, {
      reason: "Pulled",
      message: 'Successfully pulled image "docker.io/library/nginx:1.21" in 8s',
      involved: { kind: "Pod", name: podName, namespace: "team-x", uid: `uid-pod-team-x-${podName}` },
      at,
    });

  it("builds a gate-to-apron truck with a finite wait from a matched Pulling/Pulled pair", () => {
    const nowMs = Date.parse("2026-01-01T10:05:00Z");
    const s = listed({
      nodes: [node("node-a")],
      pods: [pod("web", "team-x", "1", { nodeName: "node-a" })],
      events: [pullingEvent("pulling1", "web", "2026-01-01T10:00:00Z"), pulledEvent("pulled1", "web", "2026-01-01T10:00:08Z")],
    });
    const p = projectPort(s, {}, K8S_PORT_MAPPING, nowMs);
    expect(eventTrucks(p)).toHaveLength(1);
    const truck = eventTrucks(p)[0];
    expect(truck?.kind).toBe("external");
    expect(truck?.plate).toBe("library/nginx:1.21");
    expect(truck?.carrier).toBe("docker.io");
    expect(truck?.once).toBe(true);
    const waitSec = truck?.route.find((pt) => pt.status === "Pulling")?.wait;
    expect(waitSec).toBeCloseTo(8, 1);
  });

  it("caps the wait for a Pulling event with no matching Pulled yet", () => {
    const nowMs = Date.parse("2026-01-01T10:05:00Z");
    const s = listed({
      nodes: [node("node-a")],
      pods: [pod("web", "team-x", "1", { nodeName: "node-a" })],
      events: [pullingEvent("pulling1", "web", "2026-01-01T10:00:00Z")],
    });
    const p = projectPort(s, {}, K8S_PORT_MAPPING, nowMs);
    const waitSec = eventTrucks(p)[0]?.route.find((pt) => pt.status === "Pulling")?.wait;
    expect(waitSec).toBe(K8S_PORT_MAPPING.trucks.pull.waitCapSec);
  });

  it("drops a Pulling event older than the lookback window", () => {
    const nowMs = Date.parse("2026-01-01T11:00:00Z");
    const s = listed({
      nodes: [node("node-a")],
      pods: [pod("web", "team-x", "1", { nodeName: "node-a" })],
      events: [pullingEvent("pulling1", "web", "2026-01-01T10:00:00Z")],
    });
    const p = projectPort(s, {}, K8S_PORT_MAPPING, nowMs);
    expect(eventTrucks(p)).toEqual([]);
  });

  it("caps eligible trucks at the configured maximum, newest first", () => {
    const base = Date.parse("2026-01-01T10:00:00Z");
    const count = K8S_PORT_MAPPING.trucks.maxTrucks + 3;
    const pods = Array.from({ length: count }, (_, i) => pod(`w${i}`, "team-x", "1", { nodeName: "node-a" }));
    const events = Array.from({ length: count }, (_, i) => pullingEvent(`pulling${i}`, `w${i}`, new Date(base + i * 1000).toISOString()));
    const nowMs = base + count * 1000;
    const s = listed({ nodes: [node("node-a")], pods, events });
    const p = projectPort(s, {}, K8S_PORT_MAPPING, nowMs);
    expect(eventTrucks(p)).toHaveLength(K8S_PORT_MAPPING.trucks.maxTrucks);
    expect(eventTrucks(p)[0]?.id).toBe(`uid-ev-pulling${count - 1}`);
  });

  it("builds an ITV truck from a Scheduled event with the right plate, carrier and trip text", () => {
    const nowMs = Date.parse("2026-01-01T10:05:00Z");
    const s = listed({
      nodes: [node("node-a")],
      namespaces: [namespace("team-x")],
      pods: [pod("web", "team-x", "1", { nodeName: "node-a" })],
      events: [
        event("scheduled1", {
          reason: "Scheduled",
          message: "Successfully assigned team-x/web to node-a",
          involved: { kind: "Pod", name: "web", namespace: "team-x", uid: "uid-pod-team-x-web" },
          at: "2026-01-01T10:00:00Z",
        }),
      ],
    });
    const p = projectPort(s, {}, K8S_PORT_MAPPING, nowMs);
    const truck = eventTrucks(p).find((t) => t.kind === "itv");
    expect(truck?.plate).toBe("web");
    expect(truck?.carrier).toBe(K8S_PORT_MAPPING.trucks.schedule.carrier);
    expect(truck?.trip).toBe("team-x/web → node-a");
    expect(truck?.once).toBe(true);
  });

  it("routes a Scheduled event through the gate when its namespace has no yard block", () => {
    const nowMs = Date.parse("2026-01-01T10:05:00Z");
    const s = listed({
      nodes: [node("node-a")],
      events: [
        event("scheduled-orphan", {
          reason: "Scheduled",
          message: "Successfully assigned orphan-ns/web to node-a",
          involved: { kind: "Pod", name: "web", namespace: "orphan-ns", uid: "uid-pod-orphan-ns-web" },
          at: "2026-01-01T10:00:00Z",
        }),
      ],
    });
    const p = projectPort(s, {}, K8S_PORT_MAPPING, nowMs);
    const truck = eventTrucks(p)[0];
    expect(truck?.kind).toBe("itv");
    expect(truck?.gate).toBeUndefined();
    expect(truck?.route.some((pt) => pt.status === K8S_PORT_MAPPING.trucks.schedule.status)).toBe(true);
  });

  it("skips a Scheduled event whose target node is unknown", () => {
    const nowMs = Date.parse("2026-01-01T10:05:00Z");
    const s = listed({
      nodes: [node("node-a")],
      namespaces: [namespace("team-x")],
      pods: [pod("web", "team-x", "1", { nodeName: "node-a" })],
      events: [
        event("scheduled-unknown", {
          reason: "Scheduled",
          message: "Successfully assigned team-x/web to node-ghost",
          involved: { kind: "Pod", name: "web", namespace: "team-x", uid: "uid-pod-team-x-web" },
          at: "2026-01-01T10:00:00Z",
        }),
      ],
    });
    const p = projectPort(s, {}, K8S_PORT_MAPPING, nowMs);
    expect(eventTrucks(p)).toEqual([]);
  });

  it("sends a short cached-image trip for a Pulled event with no Pulling", () => {
    const nowMs = Date.parse("2026-01-01T10:05:00Z");
    const s = listed({
      nodes: [node("node-a")],
      pods: [pod("web", "team-x", "1", { nodeName: "node-a" })],
      events: [pulledEvent("pulled-only", "web", "2026-01-01T10:00:00Z")],
    });
    const p = projectPort(s, {}, K8S_PORT_MAPPING, nowMs);
    const truck = eventTrucks(p)[0];
    expect(truck?.kind).toBe("external");
    expect(truck?.trip).toContain(K8S_PORT_MAPPING.trucks.pull.cachedLabel);
    expect(truck?.route.find((pt) => pt.status === K8S_PORT_MAPPING.trucks.pull.cachedStatus)?.wait).toBe(K8S_PORT_MAPPING.trucks.pull.cachedWaitSec);
  });

  it("keeps looping shuttles between each namespace block and the nodes running its pods, busiest first", () => {
    const nowMs = Date.parse("2026-01-01T10:05:00Z");
    const s = listed({
      nodes: [node("node-a"), node("node-b")],
      namespaces: [namespace("team-x"), namespace("team-y")],
      pods: [
        pod("w1", "team-x", "1", { nodeName: "node-a" }),
        pod("w2", "team-x", "1", { nodeName: "node-a" }),
        pod("w3", "team-y", "1", { nodeName: "node-b" }),
        pod("w4", "team-x", "1", { nodeName: "node-b" }),
      ],
    });
    const p = projectPort(s, {}, K8S_PORT_MAPPING, nowMs);
    const list = shuttles(p);
    expect(list.map((t) => t.id)).toEqual([`${SHUTTLE_ID_PREFIX}node-a/team-x`, `${SHUTTLE_ID_PREFIX}node-b/team-x`, `${SHUTTLE_ID_PREFIX}node-b/team-y`]);
    expect(list[0]?.once).toBeUndefined();
    expect(list.every((t) => t.ambient)).toBe(true);
    expect(eventTrucks(p).some((t) => t.ambient)).toBe(false);
    expect(list[0]?.trip).toBe("team-x ⇄ node-a · 2 pods");
    expect(list[0]?.carrier).toBe(K8S_PORT_MAPPING.trucks.shuttle.carrier);
    expect(projectPort(s, {}, K8S_PORT_MAPPING, nowMs).trucks).toEqual(p.trucks);
  });
});
