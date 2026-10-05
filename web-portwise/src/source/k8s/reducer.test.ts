import { describe, expect, it } from "vitest";
import { ev, namespace, node, pod } from "./fixtures";
import type { ClusterAction, ClusterState } from "./reducer";
import { clusterReducer, compareVersions, emptyCluster, scheduledNodes } from "./reducer";

const apply = (actions: ClusterAction[], state: ClusterState = emptyCluster()): ClusterState => actions.reduce(clusterReducer, state);

const names = (s: ClusterState, r: "nodes" | "pods" | "namespaces"): string[] => Object.values(s[r].items).map((o) => o.metadata.name).sort();

describe("compareVersions", () => {
  it("compares numeric versions by magnitude", () => {
    expect(compareVersions("9", "10")).toBeLessThan(0);
    expect(compareVersions("10", "10")).toBe(0);
    expect(compareVersions("11", "10")).toBeGreaterThan(0);
  });

  it("refuses to order opaque versions", () => {
    expect(compareVersions("abc", "10")).toBeNull();
    expect(compareVersions(undefined, "10")).toBeNull();
  });
});

describe("clusterReducer", () => {
  const list: ClusterAction = { type: "list", resource: "nodes", items: [node("node-b", "5"), node("node-a", "4")], resourceVersion: "5" };

  it("is idempotent for lists", () => {
    const once = apply([list]);
    expect(apply([list], once)).toEqual(once);
  });

  it("is idempotent for repeated watch events", () => {
    const added: ClusterAction = { type: "watch", resource: "nodes", event: ev("ADDED", node("node-c", "6")) };
    const once = apply([list, added]);
    const twice = clusterReducer(once, added);
    expect(twice).toBe(once);
  });

  it("produces the same state regardless of list item order", () => {
    const reversed: ClusterAction = { type: "list", resource: "nodes", items: [node("node-a", "4"), node("node-b", "5")], resourceVersion: "5" };
    expect(JSON.stringify(apply([list]))).toBe(JSON.stringify(apply([reversed])));
  });

  it("keys entries by metadata.uid", () => {
    const s = apply([list, { type: "watch", resource: "nodes", event: ev("MODIFIED", { ...node("node-a", "7"), metadata: { ...node("node-a").metadata, name: "renamed", resourceVersion: "7" } }) }]);
    expect(Object.keys(s.nodes.items).sort()).toEqual(["uid-node-node-a", "uid-node-node-b"]);
    expect(names(s, "nodes")).toEqual(["node-b", "renamed"]);
  });

  it("ignores stale modifications", () => {
    const s = apply([list, { type: "watch", resource: "nodes", event: ev("MODIFIED", node("node-b", "3", { ready: false })) }]);
    expect(s.nodes.items["uid-node-node-b" as never].status?.conditions?.[0].status).toBe("True");
  });

  it("does not resurrect a deleted object from a late duplicate", () => {
    const s = apply([
      list,
      { type: "watch", resource: "nodes", event: ev("DELETED", node("node-a", "8")) },
      { type: "watch", resource: "nodes", event: ev("MODIFIED", node("node-a", "6")) },
    ]);
    expect(names(s, "nodes")).toEqual(["node-b"]);
    expect(s.nodes.resourceVersion).toBe("8");
  });

  it("advances the resume version on bookmarks", () => {
    const s = apply([list, { type: "watch", resource: "nodes", event: ev("BOOKMARK", { metadata: { uid: "", name: "", resourceVersion: "42" } } as never) }]);
    expect(s.nodes.resourceVersion).toBe("42");
    expect(names(s, "nodes")).toEqual(["node-a", "node-b"]);
  });

  it("replaces the table on a relist after 410, dropping objects and tombstones", () => {
    const before = apply([
      list,
      { type: "watch", resource: "nodes", event: ev("DELETED", node("node-a", "8")) },
      { type: "watch", resource: "nodes", event: ev("ADDED", node("node-c", "9")) },
    ]);
    const relist: ClusterAction = { type: "list", resource: "nodes", items: [node("node-a", "20"), node("node-d", "21")], resourceVersion: "21" };
    const after = clusterReducer(before, relist);
    expect(names(after, "nodes")).toEqual(["node-a", "node-d"]);
    expect(after.nodes.tombstones).toEqual({});
    expect(after.nodes.resourceVersion).toBe("21");
  });

  it("leaves other resources untouched", () => {
    const s = apply([{ type: "list", resource: "namespaces", items: [namespace("team-x")], resourceVersion: "1" }, list]);
    expect(names(s, "namespaces")).toEqual(["team-x"]);
  });
});

describe("scheduledNodes", () => {
  const base = apply([{ type: "list", resource: "pods", items: [pod("web", "team-x", "1", { phase: "Pending", scheduled: false })], resourceVersion: "1" }]);

  it("reports the node when a pod becomes scheduled", () => {
    const action: ClusterAction = { type: "watch", resource: "pods", event: ev("MODIFIED", pod("web", "team-x", "2", { phase: "Pending", nodeName: "node-a", scheduled: true })) };
    expect(scheduledNodes(base, action)).toEqual(["node-a"]);
  });

  it("does not report again for an already scheduled pod", () => {
    const action: ClusterAction = { type: "watch", resource: "pods", event: ev("MODIFIED", pod("web", "team-x", "2", { nodeName: "node-a", scheduled: true })) };
    const next = clusterReducer(base, action);
    expect(scheduledNodes(next, { ...action, event: ev("MODIFIED", pod("web", "team-x", "3", { nodeName: "node-a", scheduled: true })) })).toEqual([]);
  });

  it("ignores pods that have no node", () => {
    const action: ClusterAction = { type: "watch", resource: "pods", event: ev("ADDED", pod("job", "team-x", "2", { phase: "Pending" })) };
    expect(scheduledNodes(base, action)).toEqual([]);
  });
});

describe("relist", () => {
  it("returns the same state when a relist changes nothing", () => {
    const items = [node("node-a")];
    const once = clusterReducer(emptyCluster(), { type: "list", resource: "nodes", items, resourceVersion: "5" });
    expect(clusterReducer(once, { type: "list", resource: "nodes", items: [...items], resourceVersion: "5" })).toBe(once);
  });
});
