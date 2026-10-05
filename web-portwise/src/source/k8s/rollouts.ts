import type { DetailRow, Shipment, ShipmentHold, ShipmentStep } from "@/data/types";
import type { ClusterState } from "./reducer";
import type { Condition, K8sPod, ObjectMeta, OwnerReference } from "./types";
import type { K8sPortMapping, RolloutSignal, WorkloadResource } from "./mapping";

export interface WorkloadRef {
  uid: string;
  resource: WorkloadResource;
}

interface Workload {
  resource: WorkloadResource;
  meta: ObjectMeta;
  desired: number;
  ready: number;
  updated: number;
  observedGeneration?: number;
  conditions: Condition[];
  images: string[];
  completionTime?: string;
}

const RESOURCE_BY_KIND: Record<string, WorkloadResource> = {
  Deployment: "deployments",
  StatefulSet: "statefulsets",
  DaemonSet: "daemonsets",
  ReplicaSet: "replicasets",
  Job: "jobs",
};

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const controllerOf = (meta: ObjectMeta): OwnerReference | undefined => meta.ownerReferences?.find((o) => o.controller) ?? meta.ownerReferences?.[0];

const imagesOf = (template?: { spec?: { containers?: Array<{ name: string; image?: string }> } }): string[] =>
  (template?.spec?.containers ?? []).map((c) => c.image ?? c.name);

/** Every workload that can be a shipment, keyed by uid. ReplicaSets count only when nothing controls them. */
export function collectWorkloads(state: ClusterState): Map<string, Workload> {
  const out = new Map<string, Workload>();
  const add = (w: Workload): void => void out.set(w.meta.uid, w);
  for (const d of Object.values(state.deployments.items)) {
    const desired = d.spec?.replicas ?? 1;
    add({ resource: "deployments", meta: d.metadata, desired, ready: d.status?.readyReplicas ?? 0, updated: d.status?.updatedReplicas ?? 0, observedGeneration: d.status?.observedGeneration, conditions: d.status?.conditions ?? [], images: imagesOf(d.spec?.template) });
  }
  for (const s of Object.values(state.statefulsets.items)) {
    const desired = s.spec?.replicas ?? 1;
    add({ resource: "statefulsets", meta: s.metadata, desired, ready: s.status?.readyReplicas ?? 0, updated: s.status?.updatedReplicas ?? 0, observedGeneration: s.status?.observedGeneration, conditions: s.status?.conditions ?? [], images: imagesOf(s.spec?.template) });
  }
  for (const d of Object.values(state.daemonsets.items)) {
    const st = d.status;
    add({ resource: "daemonsets", meta: d.metadata, desired: st?.desiredNumberScheduled ?? 0, ready: st?.numberReady ?? 0, updated: st?.updatedNumberScheduled ?? 0, observedGeneration: st?.observedGeneration, conditions: st?.conditions ?? [], images: imagesOf(d.spec?.template) });
  }
  for (const r of Object.values(state.replicasets.items)) {
    if (controllerOf(r.metadata)) continue;
    const desired = r.spec?.replicas ?? 1;
    add({ resource: "replicasets", meta: r.metadata, desired, ready: r.status?.readyReplicas ?? 0, updated: r.status?.replicas ?? 0, observedGeneration: r.status?.observedGeneration, conditions: r.status?.conditions ?? [], images: imagesOf(r.spec?.template) });
  }
  for (const j of Object.values(state.jobs.items)) {
    const desired = j.spec?.completions ?? 1;
    add({ resource: "jobs", meta: j.metadata, desired, ready: j.status?.succeeded ?? 0, updated: desired, conditions: j.status?.conditions ?? [], images: imagesOf(j.spec?.template), completionTime: j.status?.completionTime });
  }
  return out;
}

export interface Ownership {
  /** Pod uid to the workload that owns it, following ReplicaSets up to their Deployment. */
  owners: Map<string, WorkloadRef>;
  /** Deployment uid to the uid of its newest ReplicaSet, the latest rollout. */
  latestReplicaSet: Map<string, string>;
}

/** Resolves pod ownership: pod, ReplicaSet, Deployment; or pod straight to a StatefulSet, DaemonSet or Job. */
export function resolveOwnership(state: ClusterState): Ownership {
  const latest = new Map<string, { uid: string; created: string }>();
  for (const rs of Object.values(state.replicasets.items)) {
    const owner = controllerOf(rs.metadata);
    if (owner?.kind !== "Deployment") continue;
    const created = rs.metadata.creationTimestamp ?? "";
    const prev = latest.get(owner.uid);
    if (!prev || created > prev.created || (created === prev.created && rs.metadata.uid > prev.uid)) latest.set(owner.uid, { uid: rs.metadata.uid, created });
  }

  const owners = new Map<string, WorkloadRef>();
  for (const pod of Object.values(state.pods.items)) {
    const ref = controllerOf(pod.metadata);
    const resource = ref ? RESOURCE_BY_KIND[ref.kind] : undefined;
    if (!ref || !resource) continue;
    if (resource === "replicasets") {
      const rs = state.replicasets.items[ref.uid as never];
      const parent = rs ? controllerOf(rs.metadata) : undefined;
      const parentResource = parent ? RESOURCE_BY_KIND[parent.kind] : undefined;
      owners.set(pod.metadata.uid, parent && parentResource ? { uid: parent.uid, resource: parentResource } : { uid: ref.uid, resource });
      continue;
    }
    owners.set(pod.metadata.uid, { uid: ref.uid, resource });
  }
  return { owners, latestReplicaSet: new Map([...latest].map(([k, v]) => [k, v.uid])) };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

function stamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const conditionTimes = (pods: K8sPod[], type: string): string[] =>
  pods.flatMap((p) => p.status?.conditions?.filter((c) => c.type === type && c.status === "True").map((c) => c.lastTransitionTime ?? "") ?? []);

const earliest = (times: string[]): string | null => (times.length ? [...times].sort(byName)[0] : null);
const latestOf = (times: string[]): string | null => (times.length ? [...times].sort(byName)[times.length - 1] : null);

const findCondition = (w: Workload, rule: { type: string; status: string }): Condition | undefined =>
  w.conditions.find((c) => c.type === rule.type && c.status === rule.status);

function isSettled(w: Workload, m: K8sPortMapping): boolean {
  if (w.resource === "jobs") return !!findCondition(w, m.shipments.completeCondition);
  const generationSeen = w.observedGeneration === undefined || w.meta.generation === undefined || w.observedGeneration >= w.meta.generation;
  return generationSeen && w.ready >= w.desired && w.updated >= w.desired;
}

function holdOf(w: Workload, pods: K8sPod[], m: K8sPortMapping): ShipmentHold | undefined {
  const sh = m.shipments;
  const failed = w.resource === "jobs" ? findCondition(w, sh.failedCondition) : undefined;
  if (failed) return { severity: sh.holdSeverity, reason: failed.reason ?? sh.failedCondition.fallbackReason };
  const stalled = findCondition(w, sh.stalledCondition);
  if (stalled) return { severity: sh.holdSeverity, reason: stalled.reason ?? sh.stalledCondition.fallbackReason };
  const waiting = pods
    .flatMap((p) => [...(p.status?.initContainerStatuses ?? []), ...(p.status?.containerStatuses ?? [])])
    .map((c) => c.state?.waiting?.reason ?? "")
    .filter((r) => sh.holdWaitingReasons.includes(r))
    .sort(byName);
  return waiting.length ? { severity: sh.holdSeverity, reason: waiting[0] } : undefined;
}

function signalTimes(w: Workload, pods: K8sPod[], latestRolloutAt: string | undefined, settled: boolean, m: K8sPortMapping): Record<RolloutSignal, string | null> {
  const pc = m.shipments.podConditions;
  const created = w.meta.creationTimestamp ?? "";
  const booked = latestRolloutAt && latestRolloutAt > created ? latestRolloutAt : created;
  const readyAt = w.completionTime ?? latestOf(conditionTimes(pods, "Ready"));
  return {
    rolloutStarted: booked,
    podScheduled: earliest(conditionTimes(pods, pc.podScheduled)),
    podInitialized: earliest(conditionTimes(pods, pc.podInitialized)),
    containersReady: earliest(conditionTimes(pods, pc.containersReady)),
    settled: settled ? readyAt ?? "" : null,
  };
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || byName(a[0], b[0]))[0]?.[0] ?? "";
}

const restarts = (pods: K8sPod[]): number =>
  pods.reduce((s, p) => s + (p.status?.containerStatuses ?? []).reduce((t, c) => t + (c.restartCount ?? 0), 0), 0);

/** Workload rollouts as shipments, in-progress and held first, then by namespace and name. */
export function projectShipments(
  state: ClusterState,
  ownership: Ownership,
  workloads: Map<string, Workload>,
  boxIdOf: (podUid: string) => string | undefined,
  vesselIdOf: (node: string) => string,
  m: K8sPortMapping,
): Shipment[] {
  const sh = m.shipments;
  const podsOf = new Map<string, K8sPod[]>();
  for (const pod of Object.values(state.pods.items).sort((a, b) => byName(a.metadata.name, b.metadata.name) || byName(a.metadata.uid, b.metadata.uid))) {
    const owner = ownership.owners.get(pod.metadata.uid);
    if (owner && workloads.has(owner.uid)) podsOf.set(owner.uid, [...(podsOf.get(owner.uid) ?? []), pod]);
  }

  const shipments = [...workloads.values()].map((w): { s: Shipment; active: boolean } => {
    const uid = w.meta.uid;
    const all = podsOf.get(uid) ?? [];
    const latestRs = ownership.latestReplicaSet.get(uid);
    const onLatest = latestRs ? all.filter((p) => controllerOf(p.metadata)?.uid === latestRs) : [];
    const pods = onLatest.length ? onLatest : all;
    const latestRolloutAt = latestRs ? state.replicasets.items[latestRs as never]?.metadata.creationTimestamp : undefined;
    const settled = isSettled(w, m);
    const hold = holdOf(w, pods, m);
    const times = signalTimes(w, pods, latestRolloutAt, settled, m);
    const steps: ShipmentStep[] = sh.steps.map((r) => ({ label: r.label, time: stamp(times[r.signal]) }));
    const reached = sh.steps.map((r, i) => (times[r.signal] !== null ? i : -1));
    const furthest = Math.max(...reached);
    const current = settled && !hold ? sh.steps.length : Math.min(furthest + 1, sh.steps.length - 1);
    const kind = sh.kinds[w.resource];
    const namespace = w.meta.namespace ?? "";
    const nodes = all.map((p) => p.spec?.nodeName ?? "").filter(Boolean);
    const image = w.images[0] ?? "";
    const sizeLabel = w.resource === "jobs" ? `${w.ready}/${w.desired} completed` : `${w.ready}/${w.desired} ready`;
    const look = hold ? { headline: hold.reason, tone: sh.states.held.tone } : settled ? sh.states.settled : sh.states.inProgress;
    const details: DetailRow[] = [
      { label: "Desired", value: String(w.desired) },
      { label: "Ready", value: String(w.ready) },
      { label: "Updated", value: String(w.updated) },
      { label: "Restarts", value: String(restarts(all)) },
      ...w.images.map((img, i) => ({ label: i === 0 ? "Image" : `Image ${i + 1}`, value: img })),
    ];
    return {
      active: !settled || !!hold,
      s: {
        id: uid,
        label: `${kind.label}/${w.meta.name}`,
        direction: settled && !hold ? sh.direction.settled : sh.direction.inProgress,
        containerIds: all.map((p) => boxIdOf(p.metadata.uid)).filter((id): id is string => !!id),
        vesselId: nodes.length ? vesselIdOf(mostCommon(nodes)) : "",
        destination: namespace,
        consignee: kind.consignee,
        cargo: image,
        sizeLabel,
        steps,
        current,
        hold,
        meta: { sourceId: uid, headline: look.headline, tone: look.tone, fill: w.desired ? Math.min(1, w.ready / w.desired) : 1, details },
      },
    };
  });

  return shipments
    .sort((a, b) => Number(b.active) - Number(a.active) || byName(a.s.destination, b.s.destination) || byName(a.s.label ?? "", b.s.label ?? "") || byName(a.s.id, b.s.id))
    .map((x) => x.s);
}
