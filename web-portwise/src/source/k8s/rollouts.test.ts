import { describe, expect, it } from "vitest";
import { deployment, ev, job, kindOf, ownedPod, replicaSet, statefulSet } from "./fixtures";
import { K8S_PORT_MAPPING } from "./mapping";
import { projectPort } from "./project";
import type { ClusterAction, ClusterState } from "./reducer";
import { clusterReducer, emptyCluster } from "./reducer";
import { resolveOwnership } from "./rollouts";
import type { ResourceKey, ResourceObjects } from "./types";

const listed = (tables: { [K in ResourceKey]?: ResourceObjects[K][] }): ClusterState =>
  (Object.entries(tables) as Array<[ResourceKey, never[]]>).reduce(
    (s, [resource, items]) => clusterReducer(s, { type: "list", resource, items, resourceVersion: "1" } as ClusterAction),
    emptyCluster(),
  );

const STEPS = K8S_PORT_MAPPING.shipments.steps.length;
const ALL_POD_CONDITIONS = [
  { type: "PodScheduled", at: "2026-01-01T08:01:00Z" },
  { type: "Initialized", at: "2026-01-01T08:02:00Z" },
  { type: "ContainersReady", at: "2026-01-01T08:03:00Z" },
  { type: "Ready", at: "2026-01-01T08:03:00Z" },
];

const web = deployment("web", "team-x");
const webRs = replicaSet("web-1", "team-x", web);

describe("resolveOwnership", () => {
  it("follows a pod through its ReplicaSet to the Deployment", () => {
    const s = listed({ deployments: [web], replicasets: [webRs], pods: [ownedPod("web-1-a", "team-x", kindOf("ReplicaSet", webRs))] });
    expect(resolveOwnership(s).owners.get("uid-pod-team-x-web-1-a")).toEqual({ uid: web.metadata.uid, resource: "deployments" });
  });

  it("links StatefulSet and Job pods directly", () => {
    const db = statefulSet("db", "team-x");
    const task = job("task", "team-x", "running");
    const owners = resolveOwnership(listed({ statefulsets: [db], jobs: [task], pods: [ownedPod("db-0", "team-x", kindOf("StatefulSet", db)), ownedPod("task-a", "team-x", kindOf("Job", task))] })).owners;
    expect(owners.get("uid-pod-team-x-db-0")?.uid).toBe(db.metadata.uid);
    expect(owners.get("uid-pod-team-x-task-a")?.resource).toBe("jobs");
  });

  it("leaves orphan pods without an owner", () => {
    const owners = resolveOwnership(listed({ pods: [ownedPod("loose", "team-x", null)] })).owners;
    expect(owners.has("uid-pod-team-x-loose")).toBe(false);
  });

  it("picks the newest ReplicaSet as the latest rollout", () => {
    const newer = replicaSet("web-2", "team-x", web, "2026-01-02T08:00:00Z");
    expect(resolveOwnership(listed({ deployments: [web], replicasets: [webRs, newer] })).latestReplicaSet.get(web.metadata.uid)).toBe(newer.metadata.uid);
  });
});

describe("shipments", () => {
  it("turns each workload into a shipment with its pods as boxes", () => {
    const p = projectPort(listed({ deployments: [web], replicasets: [webRs], pods: [ownedPod("web-1-a", "team-x", kindOf("ReplicaSet", webRs), { nodeName: "node-b", conditions: ALL_POD_CONDITIONS })] }));
    expect(p.shipments).toHaveLength(1);
    const s = p.shipments![0];
    expect(s.id).toBe(web.metadata.uid);
    expect(s.label).toBe("deployment/web");
    expect(s.containerIds).toEqual(["uid-pod-team-x-web-1-a"]);
    expect(s.vesselId).toBe("node-node-b");
    expect(p.containers[0].shipmentId).toBe(web.metadata.uid);
    expect(p.logistics).toBe(false);
  });

  it("does not turn ReplicaSets owned by a Deployment into shipments", () => {
    const p = projectPort(listed({ deployments: [web], replicasets: [webRs, replicaSet("loose", "team-x")] }));
    expect(p.shipments!.map((s) => s.label).sort()).toEqual(["deployment/web", "replicaset/loose"]);
  });

  it("delivers a settled rollout", () => {
    const p = projectPort(listed({ deployments: [web], replicasets: [webRs], pods: [ownedPod("web-1-a", "team-x", kindOf("ReplicaSet", webRs), { conditions: ALL_POD_CONDITIONS })] }));
    const s = p.shipments![0];
    expect(s.current).toBe(STEPS);
    expect(s.direction).toBe("import");
    expect(s.hold).toBeUndefined();
    expect(s.steps.every((st) => st.time !== "")).toBe(true);
  });

  it("stops at the furthest step a rollout in progress has reached", () => {
    const d = deployment("api", "team-x", { replicas: 2, ready: 0, updated: 2 });
    const rs = replicaSet("api-1", "team-x", d);
    const p = projectPort(listed({ deployments: [d], replicasets: [rs], pods: [ownedPod("api-1-a", "team-x", kindOf("ReplicaSet", rs), { phase: "Pending", conditions: [ALL_POD_CONDITIONS[0]] })] }));
    const s = p.shipments![0];
    expect(s.current).toBe(2);
    expect(s.direction).toBe("export");
    expect(s.steps[1].time).not.toBe("");
    expect(s.steps[2].time).toBe("");
  });

  it("treats a generation the controller has not observed yet as in progress", () => {
    const d = deployment("api", "team-x", { generation: 3, observed: 2 });
    expect(projectPort(listed({ deployments: [d] })).shipments![0].current).toBeLessThan(STEPS);
  });

  it.each([
    ["CrashLoopBackOff", { waiting: "CrashLoopBackOff" }],
    ["ImagePullBackOff", { waiting: "ImagePullBackOff" }],
    ["ErrImagePull", { waiting: "ErrImagePull" }],
  ])("holds a rollout whose pod is in %s", (reason, podOpts) => {
    const d = deployment("api", "team-x", { replicas: 1, ready: 0 });
    const rs = replicaSet("api-1", "team-x", d);
    const s = projectPort(listed({ deployments: [d], replicasets: [rs], pods: [ownedPod("api-1-a", "team-x", kindOf("ReplicaSet", rs), { ...podOpts, conditions: [ALL_POD_CONDITIONS[0]] })] })).shipments![0];
    expect(s.hold).toEqual({ severity: K8S_PORT_MAPPING.shipments.holdSeverity, reason });
    expect(s.meta?.tone).toBe(K8S_PORT_MAPPING.shipments.states.held.tone);
    expect(s.current).toBeLessThan(STEPS);
  });

  it("holds a rollout whose Progressing condition is False", () => {
    const d = deployment("api", "team-x", { replicas: 2, ready: 1, conditions: [{ type: "Progressing", status: "False", reason: "ProgressDeadlineExceeded" }] });
    expect(projectPort(listed({ deployments: [d] })).shipments![0].hold?.reason).toBe("ProgressDeadlineExceeded");
  });

  it("holds a failed Job and delivers a completed one", () => {
    const p = projectPort(listed({ jobs: [job("bad", "team-x", "failed"), job("good", "team-x", "complete")] }));
    const byLabel = new Map(p.shipments!.map((s) => [s.label, s]));
    expect(byLabel.get("job/bad")?.hold?.reason).toBe("BackoffLimitExceeded");
    expect(byLabel.get("job/good")?.current).toBe(STEPS);
    expect(byLabel.get("job/good")?.steps[STEPS - 1].time).not.toBe("");
    expect(byLabel.get("job/good")?.steps[STEPS - 1].label).toBe("Completed");
    expect(byLabel.get("job/good")?.meta?.headline).toBe("Completed");
  });

  it("orders active and held shipments first, then by namespace and name", () => {
    const p = projectPort(
      listed({
        deployments: [deployment("zeta", "team-a"), deployment("alpha", "team-b"), deployment("busy", "team-z", { replicas: 2, ready: 1 })],
        jobs: [job("bad", "team-y", "failed")],
      }),
    );
    expect(p.shipments!.map((s) => s.label)).toEqual(["job/bad", "deployment/busy", "deployment/zeta", "deployment/alpha"]);
  });

  it("is deterministic and idempotent under repeated events", () => {
    const pod = ownedPod("web-1-a", "team-x", kindOf("ReplicaSet", webRs), { conditions: ALL_POD_CONDITIONS });
    const base = listed({ deployments: [web], replicasets: [webRs], pods: [pod] });
    const again = clusterReducer(clusterReducer(base, { type: "watch", resource: "pods", event: ev("MODIFIED", pod) }), { type: "watch", resource: "deployments", event: ev("MODIFIED", web) });
    expect(again).toBe(base);
    expect(JSON.stringify(projectPort(again))).toBe(JSON.stringify(projectPort(base)));
  });

  it("does not depend on list order", () => {
    const a = projectPort(listed({ deployments: [deployment("one", "team-x"), deployment("two", "team-x")] }));
    const b = projectPort(listed({ deployments: [deployment("two", "team-x"), deployment("one", "team-x")] }));
    expect(b.shipments).toEqual(a.shipments);
  });
});
