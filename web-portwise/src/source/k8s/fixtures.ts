import type { K8sDeployment, K8sEvent, K8sJob, K8sNamespace, K8sNode, K8sPod, K8sReplicaSet, K8sStatefulSet, WatchEvent, WatchEventType } from "./types";

export const node = (name: string, rv = "1", opts: { ready?: boolean; cpu?: string } = {}): K8sNode => ({
  metadata: { uid: `uid-node-${name}`, name, resourceVersion: rv },
  status: {
    allocatable: { cpu: opts.cpu ?? "4", pods: "110" },
    conditions: [{ type: "Ready", status: opts.ready === false ? "False" : "True" }],
  },
});

export const pod = (name: string, namespace: string, rv = "1", opts: { phase?: string; nodeName?: string; scheduled?: boolean; created?: string } = {}): K8sPod => ({
  metadata: { uid: `uid-pod-${namespace}-${name}`, name, namespace, resourceVersion: rv, creationTimestamp: opts.created },
  spec: { nodeName: opts.nodeName, containers: [{ name: "app", image: "example/app:1" }] },
  status: {
    phase: opts.phase ?? "Running",
    conditions: opts.scheduled === undefined ? undefined : [{ type: "PodScheduled", status: opts.scheduled ? "True" : "False" }],
  },
});

export const namespace = (name: string, rv = "1"): K8sNamespace => ({ metadata: { uid: `uid-ns-${name}`, name, resourceVersion: rv } });

export const warning = (name: string, involved: K8sEvent["involvedObject"], rv = "1", at = "2026-01-01T10:00:00Z"): K8sEvent => ({
  metadata: { uid: `uid-ev-${name}`, name, namespace: involved?.namespace, resourceVersion: rv },
  type: "Warning",
  reason: "BackOff",
  message: "synthetic warning",
  lastTimestamp: at,
  involvedObject: involved,
});

export const ev = <T,>(type: WatchEventType, object: T): WatchEvent<T> => ({ type, object });

type Cond = { type: string; status?: "True" | "False"; at?: string; reason?: string };

const conds = (list: Cond[] = []) => list.map((c) => ({ type: c.type, status: c.status ?? "True", lastTransitionTime: c.at, reason: c.reason }));

const owner = (kind: string, name: string, uid: string) => [{ kind, name, uid, controller: true }];

export const deployment = (name: string, ns: string, opts: { replicas?: number; ready?: number; updated?: number; generation?: number; observed?: number; created?: string; conditions?: Cond[] } = {}): K8sDeployment => ({
  metadata: { uid: `uid-deploy-${ns}-${name}`, name, namespace: ns, resourceVersion: "1", creationTimestamp: opts.created ?? "2026-01-01T08:00:00Z", generation: opts.generation ?? 1 },
  spec: { replicas: opts.replicas ?? 1, template: { spec: { containers: [{ name: "app", image: "example/app:1" }] } } },
  status: { readyReplicas: opts.ready ?? opts.replicas ?? 1, updatedReplicas: opts.updated ?? opts.replicas ?? 1, observedGeneration: opts.observed ?? opts.generation ?? 1, conditions: conds(opts.conditions) },
});

export const replicaSet = (name: string, ns: string, deploy?: K8sDeployment, created = "2026-01-01T08:00:00Z"): K8sReplicaSet => ({
  metadata: {
    uid: `uid-rs-${ns}-${name}`,
    name,
    namespace: ns,
    resourceVersion: "1",
    creationTimestamp: created,
    ownerReferences: deploy ? owner("Deployment", deploy.metadata.name, deploy.metadata.uid) : undefined,
  },
  spec: { replicas: 1 },
  status: { replicas: 1, readyReplicas: 1 },
});

export const statefulSet = (name: string, ns: string, replicas = 1, ready = replicas): K8sStatefulSet => ({
  metadata: { uid: `uid-sts-${ns}-${name}`, name, namespace: ns, resourceVersion: "1", creationTimestamp: "2026-01-01T08:00:00Z", generation: 1 },
  spec: { replicas },
  status: { readyReplicas: ready, updatedReplicas: replicas, observedGeneration: 1 },
});

export const job = (name: string, ns: string, outcome: "running" | "complete" | "failed"): K8sJob => ({
  metadata: { uid: `uid-job-${ns}-${name}`, name, namespace: ns, resourceVersion: "1", creationTimestamp: "2026-01-01T08:00:00Z" },
  spec: { completions: 1 },
  status: {
    succeeded: outcome === "complete" ? 1 : 0,
    failed: outcome === "failed" ? 1 : 0,
    completionTime: outcome === "complete" ? "2026-01-01T08:05:00Z" : undefined,
    conditions: outcome === "complete" ? conds([{ type: "Complete" }]) : outcome === "failed" ? conds([{ type: "Failed", reason: "BackoffLimitExceeded" }]) : [],
  },
});

export const ownedPod = (
  name: string,
  ns: string,
  ownerObj: { kind: string; metadata: { name: string; uid: string } } | null,
  opts: { nodeName?: string; phase?: string; conditions?: Cond[]; waiting?: string; restarts?: number } = {},
): K8sPod => ({
  metadata: { uid: `uid-pod-${ns}-${name}`, name, namespace: ns, resourceVersion: "1", ownerReferences: ownerObj ? owner(ownerObj.kind, ownerObj.metadata.name, ownerObj.metadata.uid) : undefined },
  spec: { nodeName: opts.nodeName ?? "node-a", containers: [{ name: "app", image: "example/app:1" }] },
  status: {
    phase: opts.phase ?? "Running",
    conditions: conds(opts.conditions),
    containerStatuses: [{ name: "app", ready: !opts.waiting, restartCount: opts.restarts ?? 0, state: opts.waiting ? { waiting: { reason: opts.waiting } } : undefined }],
  },
});

export const kindOf = <T extends { metadata: { name: string; uid: string } }>(kind: string, o: T) => ({ kind, metadata: o.metadata });
