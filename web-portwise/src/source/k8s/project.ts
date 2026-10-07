import type { Alert, CraneActivity, Container, DeckCargo, DetailRow, QuayCrane, Selection, StatusTone, Vessel, YardBlock } from "@/data/types";
import { BAY_PITCH, BLOCK_BAYS, BLOCK_HALF_X, BLOCK_HALF_Z, BLOCK_ROWS, BLOCK_TIERS, CONTAINER_H, ROW_PITCH, craneXs, layoutBerths } from "@/data/layout";
import { YARD_BLOCKS } from "@/data/port";
import { assignBerths, assignSlots, naturalCompare, stableHash } from "../assign";
import type { KpiReading, PortSnapshot } from "../model";
import type { ClusterState } from "./reducer";
import type { K8sEvent, K8sNode, K8sPod, PodPhase } from "./types";
import { toPodPhase } from "./types";
import { K8S_PORT_MAPPING, namespaceColor } from "./mapping";
import { collectWorkloads, projectShipments, resolveOwnership } from "./rollouts";
import { buildTrucks } from "./trips";
import type { K8sPortMapping, NodeStateStyle } from "./mapping";

/** Per node name: scheduling moves the live store observed, as epoch ms. */
export interface NodeActivity {
  activeFrom: number;
  lastMoveAt: number;
  moves: number;
}

export type BerthActivity = Readonly<Record<string, NodeActivity>>;

const IDLE: CraneActivity = { activeFrom: 0, activeUntil: 0, moves: 0 };

const toCraneActivity = (a: NodeActivity | undefined, windowMs: number): CraneActivity =>
  a && a.lastMoveAt ? { activeFrom: a.activeFrom, activeUntil: a.lastMoveAt + windowMs, moves: a.moves } : a ? { ...IDLE, moves: a.moves } : IDLE;
const SLOTS_PER_BLOCK = BLOCK_BAYS * BLOCK_ROWS * BLOCK_TIERS;

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Kubernetes resource quantity to a plain number (cores for CPU, count for pods). */
export function parseQuantity(q: string | undefined): number | null {
  if (!q) return null;
  const m = /^(\d+(?:\.\d+)?)(m|k|Ki|Mi|Gi)?$/.exec(q.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  return unit === "m" ? n / 1000 : unit === "k" ? n * 1000 : unit === "Ki" ? n * 1024 : unit === "Mi" ? n * 1024 ** 2 : unit === "Gi" ? n * 1024 ** 3 : n;
}

const tone = (fill: number): StatusTone => (fill >= 0.85 ? "brick" : fill >= 0.6 ? "amber" : "moss");

const values = <T,>(items: Readonly<Record<string, T>>): T[] => Object.values(items);

const nodeName = (n: K8sNode): string => n.metadata.name;

function nodeState(node: K8sNode, m: K8sPortMapping): NodeStateStyle {
  const ready = node.status?.conditions?.find((c) => c.type === "Ready")?.status === "True";
  if (!ready) return m.vessel.notReady;
  return node.spec?.unschedulable ? m.vessel.cordoned : m.vessel.ready;
}

function nodeRoles(node: K8sNode, prefix: string): string {
  const roles = Object.keys(node.metadata.labels ?? {})
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .filter(Boolean)
    .sort(byName);
  return roles.join(", ") || "worker";
}

function vesselLength(node: K8sNode, m: K8sPortMapping): number {
  const { cpuRange, podsRange, length } = m.vessel;
  const cpu = parseQuantity(node.status?.allocatable?.cpu);
  const pods = parseQuantity(node.status?.allocatable?.pods);
  const k = cpu !== null ? (cpu - cpuRange.min) / (cpuRange.max - cpuRange.min) : pods !== null ? (pods - podsRange.min) / (podsRange.max - podsRange.min) : 0.5;
  return Math.round(lerp(length.min, length.max, clamp01(k)));
}

const isWaiting = (pod: K8sPod, m: K8sPortMapping): boolean => {
  const phase = toPodPhase(pod.status?.phase);
  if (phase === "Succeeded" || phase === "Failed") return false;
  return !pod.spec?.nodeName || m.pod.waitingPhases.includes(phase);
};

const restarts = (pod: K8sPod): number => (pod.status?.containerStatuses ?? []).reduce((s, c) => s + (c.restartCount ?? 0), 0);

const images = (pod: K8sPod): string[] => (pod.spec?.containers ?? []).map((c) => c.image ?? c.name);

export function eventTime(e: K8sEvent): string {
  return e.lastTimestamp ?? e.eventTime ?? e.firstTimestamp ?? e.metadata.creationTimestamp ?? "";
}

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "--:--" : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Projects cluster state onto the port model. Pure: the same state and activity always produce the same snapshot. */
export function projectPort(state: ClusterState, activity: BerthActivity = {}, m: K8sPortMapping = K8S_PORT_MAPPING, nowMs: number = Date.now()): PortSnapshot {
  const nodes = values(state.nodes.items).sort((a, b) => byName(nodeName(a), nodeName(b)));
  const pods = values(state.pods.items).sort((a, b) => byName(a.metadata.namespace ?? "", b.metadata.namespace ?? "") || byName(a.metadata.name, b.metadata.name));
  const vesselIdOf = (name: string): string => `${m.ids.vessel}${name}`;

  const podsByNode = new Map<string, K8sPod[]>();
  const podsByNs = new Map<string, K8sPod[]>();
  for (const p of pods) {
    const node = p.spec?.nodeName;
    if (node) podsByNode.set(node, [...(podsByNode.get(node) ?? []), p]);
    const ns = p.metadata.namespace ?? "";
    podsByNs.set(ns, [...(podsByNs.get(ns) ?? []), p]);
  }

  const berthOf = assignBerths(nodes.map(nodeName));
  const berths = layoutBerths(berthOf.size);
  const perBerth = m.berths.cranesPerBerth;
  const craneIdsAt = (berth: number): string[] => Array.from({ length: perBerth }, (_, k) => `${m.ids.crane}${pad2((berth - 1) * perBerth + k + 1)}`);
  const vessels: Vessel[] = nodes.map((node) => {
    const name = nodeName(node);
    const st = nodeState(node, m);
    const onNode = podsByNode.get(name) ?? [];
    const active = onNode.filter((p) => toPodPhase(p.status?.phase) === "Running").length;
    const deck: DeckCargo[] = [...onNode]
      .sort((a, b) => byName(a.metadata.creationTimestamp ?? "", b.metadata.creationTimestamp ?? "") || byName(a.metadata.name, b.metadata.name))
      .map((p) => ({ id: p.metadata.uid, label: p.metadata.name, color: namespaceColor(p.metadata.namespace ?? "", m.pod.namespaceColors) }));
    const podCap = parseQuantity(node.status?.allocatable?.pods) ?? 110;
    const cpu = node.status?.allocatable?.cpu ?? "?";
    const info = node.status?.nodeInfo;
    const berth = berthOf.get(name) ?? 0;
    const room = (berths[berth - 1]?.length ?? Infinity) * m.berths.vesselShare;
    const details: DetailRow[] = [
      { label: "Node", value: name },
      { label: "Status", value: st.headline },
      { label: "Roles", value: nodeRoles(node, m.vessel.roleLabelPrefix) },
      { label: "Pods", value: `${active} running · ${onNode.length} / ${podCap}` },
      { label: "Allocatable CPU", value: cpu },
      { label: "Kubelet", value: info?.kubeletVersion ?? "?" },
      { label: "OS", value: [info?.osImage, info?.architecture].filter(Boolean).join(" · ") || "?" },
    ];
    return {
      id: vesselIdOf(name),
      name,
      short: name,
      imo: "",
      line: m.vessel.line,
      flag: "",
      voyage: "",
      from: "",
      to: "",
      berth,
      status: st.status,
      dischargeTotal: 0,
      discharged: 0,
      loadTotal: podCap,
      loaded: onNode.length,
      eta: "",
      etb: "",
      etd: "",
      cranes: berth ? craneIdsAt(berth) : [],
      hull: m.vessel.hulls[stableHash(name) % m.vessel.hulls.length],
      length: Math.min(vesselLength(node, m), room),
      inScene: true,
      meta: { sourceId: node.metadata.uid, headline: st.headline, tone: st.tone, fill: clamp01(onNode.length / podCap), details, deck },
    };
  });

  const vesselAtBerth = new Map(vessels.filter((v) => v.berth > 0).map((v) => [v.berth, v]));
  const cranes: QuayCrane[] = berths.flatMap((b) => {
    const xs = craneXs(b, perBerth);
    return craneIdsAt(b.n).map((id, k) => ({ id, x: xs[k], berth: b.n }));
  }).map(({ id, x, berth }) => {
    const vessel = vesselAtBerth.get(berth);
    const act = vessel ? toCraneActivity(activity[vessel.name], m.crane.activeWindowMs) : IDLE;
    return {
      id,
      x,
      berth,
      vesselId: vessel?.id,
      mode: "idle",
      movesPerHour: 0,
      movesToday: act.moves,
      model: m.crane.model,
      operator: m.crane.operator,
      reason: vessel ? m.crane.idleReason : m.crane.emptyReason,
      activity: act,
      meta: {
        sourceId: id,
        headline: vessel ? vessel.name : m.crane.emptyReason,
        tone: vessel ? "moss" : "slate",
        fill: 0,
        details: [
          { label: "Serving node", value: vessel?.name ?? "none" },
          { label: "Scheduled since connect", value: String(act.moves) },
        ],
      },
    };
  });

  const nsNames = new Set<string>([...values(state.namespaces.items).map((n) => n.metadata.name), ...podsByNs.keys()]);
  const counts = new Map([...nsNames].map((ns) => [ns, podsByNs.get(ns)?.length ?? 0]));
  const blockGeom = YARD_BLOCKS.slice(0, m.yard.blocks);
  const { slots, overflow } = assignSlots(counts, blockGeom.map((b) => b.id));
  const geomById = new Map(blockGeom.map((b) => [b.id, b]));
  const nsPhase = new Map(values(state.namespaces.items).map((n) => [n.metadata.name, n.status?.phase ?? "Active"]));

  const workloads = collectWorkloads(state);
  const ownership = resolveOwnership(state);
  const shipmentOf = (podUid: string): string => {
    const owner = ownership.owners.get(podUid)?.uid;
    return owner && workloads.has(owner) ? owner : "";
  };

  const blocks: YardBlock[] = [];
  const containers: Container[] = [];
  const containerOfPod = new Map<string, string>();
  const blockOfNs = new Map<string, string>();
  for (const [ns, blockId] of [...slots.entries()].sort((a, b) => naturalCompare(a[1], b[1]))) {
    const g = geomById.get(blockId);
    if (!g) continue;
    blockOfNs.set(ns, blockId);
    const list = podsByNs.get(ns) ?? [];
    const category = m.yard.categoryRules.find((r) => r.pattern.test(ns))?.category ?? m.yard.defaultCategory;
    const fill = clamp01(list.length / m.yard.capacity);
    const byPhase = (phase: PodPhase): number => list.filter((p) => toPodPhase(p.status?.phase) === phase).length;
    blocks.push({
      id: blockId,
      x: g.x,
      z: g.z,
      category,
      fill,
      capacity: m.yard.capacity,
      meta: {
        sourceId: ns,
        headline: ns,
        tone: tone(fill),
        fill,
        details: [
          { label: "Namespace", value: ns },
          { label: "Status", value: nsPhase.get(ns) ?? "Active" },
          { label: "Pods", value: String(list.length) },
          { label: m.pod.phases.Running.label, value: String(byPhase("Running")) },
          { label: m.pod.phases.Pending.label, value: String(byPhase("Pending")) },
          { label: m.pod.phases.Failed.label, value: String(byPhase("Failed")) },
        ],
      },
    });
    list.slice(0, SLOTS_PER_BLOCK).forEach((pod, slot) => {
      const tier = Math.floor(slot / (BLOCK_BAYS * BLOCK_ROWS));
      const rem = slot % (BLOCK_BAYS * BLOCK_ROWS);
      const bay = Math.floor(rem / BLOCK_ROWS);
      const row = rem % BLOCK_ROWS;
      const phase = toPodPhase(pod.status?.phase);
      const style = m.pod.phases[phase];
      const node = pod.spec?.nodeName;
      const ready = (pod.status?.containerStatuses ?? []).filter((c) => c.ready).length;
      const total = pod.spec?.containers?.length ?? pod.status?.containerStatuses?.length ?? 0;
      const id = pod.metadata.uid;
      containerOfPod.set(id, id);
      containers.push({
        index: containers.length,
        id,
        code: pod.metadata.name,
        prefix: "",
        line: style.label,
        blockId,
        bay: (bay + 1) * 2,
        row: row + 1,
        tier: tier + 1,
        position: `${blockId}-${pad2((bay + 1) * 2)}-${pad2(row + 1)}-${tier + 1}`,
        x: g.x - BLOCK_HALF_X + BAY_PITCH * (bay + 0.5),
        y: CONTAINER_H * (tier + 0.5) + 0.02,
        z: g.z - BLOCK_HALF_Z + ROW_PITCH * (row + 0.5),
        color: namespaceColor(ns, m.pod.namespaceColors),
        size: m.pod.size,
        category,
        cargo: images(pod)[0] ?? "",
        weight: 0,
        vesselId: node ? vesselIdOf(node) : "",
        customs: "Cleared",
        shipmentId: shipmentOf(id),
        meta: {
          sourceId: id,
          headline: style.label,
          tone: style.tone,
          fill: total ? ready / total : 0,
          details: [
            { label: "Pod", value: pod.metadata.name },
            { label: "Namespace", value: ns },
            { label: "Phase", value: style.label },
            { label: "Node", value: node ?? "unscheduled" },
            { label: "Ready", value: `${ready} / ${total}` },
            { label: "Restarts", value: String(restarts(pod)) },
            ...images(pod).map((img, i) => ({ label: i === 0 ? "Image" : `Image ${i + 1}`, value: img })),
          ],
        },
      });
    });
  }

  const nodeVessel = new Set(nodes.map(nodeName));
  const targetOf = (e: K8sEvent): Selection | undefined => {
    const o = e.involvedObject;
    if (!o) return undefined;
    if (o.kind === "Node" && o.name && nodeVessel.has(o.name)) return { kind: "vessel", id: vesselIdOf(o.name) };
    if (o.kind === "Pod" && o.uid && containerOfPod.has(o.uid)) return { kind: "container", id: o.uid };
    const ns = o.namespace ?? e.metadata.namespace;
    const block = ns ? blockOfNs.get(ns) : undefined;
    return block ? { kind: "block", id: block } : undefined;
  };
  const alerts: Alert[] = values(state.events.items)
    .filter((e) => e.type === "Warning")
    .sort((a, b) => byName(eventTime(b), eventTime(a)) || byName(a.metadata.uid, b.metadata.uid))
    .slice(0, m.alerts.max)
    .map((e) => {
      const o = e.involvedObject;
      const reason = e.reason ?? "Warning";
      return {
        id: e.metadata.uid,
        severity: m.alerts.severityByReason[reason] ?? m.alerts.defaultSeverity,
        title: `${reason} · ${o?.kind ?? "Object"} ${o?.name ?? ""}`.trim(),
        detail: `${e.message ?? ""}${e.count && e.count > 1 ? ` (×${e.count})` : ""}`,
        time: clock(eventTime(e)),
        target: targetOf(e),
      };
    });

  const waiting = pods.filter((p) => isWaiting(p, m)).length;
  const ready = vessels.filter((v) => v.meta?.headline !== m.vessel.notReady.headline).length;
  const running = pods.filter((p) => toPodPhase(p.status?.phase) === "Running").length;
  const fillAvg = blocks.length ? blocks.reduce((s, b) => s + b.fill, 0) / blocks.length : 0;
  const kpis: KpiReading[] = [
    { id: "nodes", icon: "vessel", label: "Nodes ready", value: `${ready}/${vessels.length}` },
    { id: "running", icon: "crane", label: m.pod.phases.Running.label, value: String(running), unit: "pods" },
    { id: "waiting", icon: "clock", label: "Waiting", value: String(waiting), unit: "pods" },
    { id: "yard", icon: "yard", label: "Yard utilization", value: `${Math.round(fillAvg * 100)}%` },
  ];

  return {
    source: "live",
    berths,
    vessels,
    cranes,
    blocks,
    containers,
    alerts,
    anchorage: waiting ? { label: `${waiting} ${m.anchorage.noun}`, count: waiting, tone: m.anchorage.tone } : null,
    overflow: overflow.length ? { label: m.yard.overflowLabel, groups: overflow.length, items: overflow.reduce((s, ns) => s + (counts.get(ns) ?? 0), 0) } : null,
    kpis,
    shipments: projectShipments(state, ownership, workloads, (uid) => containerOfPod.get(uid), vesselIdOf, m),
    trucks: buildTrucks(state, { vessels, cranes, berths, blockOfNs, vesselIdOf }, m, nowMs),
    logistics: false,
    vocabulary: m.vocabulary,
  };
}
