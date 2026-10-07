import type { Berth, QuayCrane, Truck, Vessel } from "@/data/types";
import { blockById } from "@/data/port";
import { COLORS, CONTAINER_COLORS } from "@/data/layout";
import { itvRoute, pullRoute } from "@/data/routes";
import { epochToSimT } from "@/sim/simStore";
import { stableHash } from "../assign";
import type { K8sPortMapping } from "./mapping";
import { eventTime } from "./project";
import type { ClusterState } from "./reducer";
import type { K8sPod } from "./types";

export interface TripBasis {
  vessels: Vessel[];
  cranes: QuayCrane[];
  berths: Berth[];
  blockOfNs: ReadonlyMap<string, string>;
  vesselIdOf: (nodeName: string) => string;
}

interface TripCandidate {
  atMs: number;
  build: () => Truck;
}

export interface ImageRef {
  registry: string;
  plate: string;
}

export const SHUTTLE_ID_PREFIX = "shuttle:";

/** Splits an image ref into the registry host (if any) and the rest, tag kept, digest dropped. */
export function parseImageRef(image: string, defaultRegistry: string): ImageRef {
  const stripped = image.replace(/@sha256:[0-9a-f]+$/, "");
  const slash = stripped.indexOf("/");
  if (slash < 0) return { registry: defaultRegistry, plate: stripped };
  const head = stripped.slice(0, slash);
  const isHost = head.includes(".") || head.includes(":") || head === "localhost";
  return isHost ? { registry: head, plate: stripped.slice(slash + 1) } : { registry: defaultRegistry, plate: stripped };
}

const CAB_COLORS: readonly string[] = [COLORS.white, COLORS.steelDark, CONTAINER_COLORS.navy, CONTAINER_COLORS.moss, COLORS.amber];
const BOX_COLORS: readonly string[] = Object.values(CONTAINER_COLORS);

const cabColorFor = (id: string): string => CAB_COLORS[stableHash(id) % CAB_COLORS.length];
const containerColorFor = (id: string): string => BOX_COLORS[stableHash(`${id}:box`) % BOX_COLORS.length];
const gateFor = (id: string): "A" | "B" => (stableHash(id) % 2 === 0 ? "A" : "B");

const extractImage = (message: string | undefined): string | undefined => (message ? /"([^"]+)"/.exec(message)?.[1] : undefined);

const keyOf = (podUid: string, image: string): string => `${podUid}:${image}`;

interface BerthSpot {
  vessel: Vessel;
  berthX: number;
}

function berthSpotOf(basis: TripBasis, nodeName: string): BerthSpot | undefined {
  const vessel = basis.vessels.find((v) => v.name === nodeName);
  if (!vessel || vessel.berth <= 0) return undefined;
  const berthX = basis.berths[vessel.berth - 1]?.x;
  return berthX === undefined ? undefined : { vessel, berthX };
}

interface PodImageEvent {
  atMs: number;
  podUid: string;
  image: string;
  uid: string;
}

interface PullMatch {
  podUid: string;
  image: string;
  atMs: number;
  uid: string;
  waitSec: number;
  cached: boolean;
}

/** Pairs each Pulling event with the earliest Pulled event at or after it; a Pulled with no Pulling means the image was already on the node. */
function matchPulls(state: ClusterState, m: K8sPortMapping): PullMatch[] {
  const pullingByKey = new Map<string, PodImageEvent>();
  const pulledByKey = new Map<string, PodImageEvent[]>();
  for (const e of Object.values(state.events.items)) {
    const involved = e.involvedObject;
    if (involved?.kind !== "Pod" || !involved.uid) continue;
    const image = extractImage(e.message);
    if (!image) continue;
    const atMs = Date.parse(eventTime(e));
    if (Number.isNaN(atMs)) continue;
    const key = keyOf(involved.uid, image);
    const entry: PodImageEvent = { atMs, podUid: involved.uid, image, uid: e.metadata.uid };
    if (e.reason === "Pulling") {
      const cur = pullingByKey.get(key);
      if (!cur || atMs > cur.atMs) pullingByKey.set(key, entry);
    } else if (e.reason === "Pulled") {
      pulledByKey.set(key, [...(pulledByKey.get(key) ?? []), entry]);
    }
  }
  const out: PullMatch[] = [];
  for (const [key, pulling] of pullingByKey) {
    const pulled = (pulledByKey.get(key) ?? []).filter((p) => p.atMs >= pulling.atMs).sort((a, b) => a.atMs - b.atMs)[0];
    const waitSec = pulled ? (pulled.atMs - pulling.atMs) / 1000 : m.trucks.pull.waitCapSec;
    out.push({ podUid: pulling.podUid, image: pulling.image, atMs: pulling.atMs, uid: pulling.uid, waitSec, cached: false });
  }
  for (const [key, pulls] of pulledByKey) {
    if (pullingByKey.has(key)) continue;
    const latest = [...pulls].sort((a, b) => b.atMs - a.atMs)[0];
    out.push({ podUid: latest.podUid, image: latest.image, atMs: latest.atMs, uid: latest.uid, waitSec: m.trucks.pull.cachedWaitSec, cached: true });
  }
  return out;
}

function pullTrips(state: ClusterState, basis: TripBasis, m: K8sPortMapping): TripCandidate[] {
  return matchPulls(state, m).flatMap((match): TripCandidate[] => {
    const pod = state.pods.items[match.podUid as never] as K8sPod | undefined;
    const node = pod?.spec?.nodeName;
    const spot = node ? berthSpotOf(basis, node) : undefined;
    if (!spot) return [];
    const gate = gateFor(match.podUid);
    const { registry, plate } = parseImageRef(match.image, m.trucks.pull.defaultRegistry);
    const id = match.uid;
    return [
      {
        atMs: match.atMs,
        build: (): Truck => ({
          id,
          plate,
          carrier: registry,
          kind: "external",
          cab: cabColorFor(id),
          gate: gate === "A" ? "Gate A" : "Gate B",
          driver: "",
          containerColor: containerColorFor(id),
          route: pullRoute({ gate, berthX: spot.berthX, waitSec: match.waitSec, status: match.cached ? m.trucks.pull.cachedStatus : m.trucks.pull.status }),
          speed: m.trucks.pull.speed,
          offset: -epochToSimT(match.atMs),
          once: true,
          trip: `${match.cached ? m.trucks.pull.cachedLabel : m.trucks.pull.label} · ${registry}`,
        }),
      },
    ];
  });
}

interface ScheduleMatch {
  atMs: number;
  uid: string;
  ns: string;
  podName: string;
  node: string;
}

const SCHEDULED_NODE_RE = /to (\S+)\.?\s*$/;

/** A pod's target node is parsed from the Scheduled event's message, falling back to its current node. */
function matchScheduled(state: ClusterState): ScheduleMatch[] {
  const out: ScheduleMatch[] = [];
  for (const e of Object.values(state.events.items)) {
    if (e.reason !== "Scheduled") continue;
    const involved = e.involvedObject;
    if (involved?.kind !== "Pod" || !involved.name) continue;
    const atMs = Date.parse(eventTime(e));
    if (Number.isNaN(atMs)) continue;
    const fromMessage = SCHEDULED_NODE_RE.exec(e.message ?? "")?.[1];
    const pod = involved.uid ? (state.pods.items[involved.uid as never] as K8sPod | undefined) : undefined;
    const node = fromMessage ?? pod?.spec?.nodeName;
    if (!node) continue;
    out.push({ atMs, uid: e.metadata.uid, ns: involved.namespace ?? "", podName: involved.name, node });
  }
  return out;
}

interface CraneSpot {
  craneId: string;
  crane: QuayCrane;
}

function craneSpotOf(basis: TripBasis, vessel: Vessel): CraneSpot | undefined {
  const craneId = vessel.cranes[0];
  const crane = craneId ? basis.cranes.find((c) => c.id === craneId) : undefined;
  return craneId && crane ? { craneId, crane } : undefined;
}

/** Namespaces with a yard block shuttle from it; the rest arrive through the gate like outside traffic. */
function scheduleTrips(state: ClusterState, basis: TripBasis, m: K8sPortMapping): TripCandidate[] {
  return matchScheduled(state).flatMap((match): TripCandidate[] => {
    const spot = berthSpotOf(basis, match.node);
    if (!spot) return [];
    const blockId = basis.blockOfNs.get(match.ns);
    const block = blockId ? blockById(blockId) : undefined;
    const craneSpot = craneSpotOf(basis, spot.vessel);
    const id = match.uid;
    const route =
      blockId && block && craneSpot
        ? itvRoute({ craneX: craneSpot.crane.x, craneLabel: craneSpot.craneId, blockX: block.x, blockZ: block.z, blockLabel: blockId, loading: true })
        : pullRoute({ gate: gateFor(id), berthX: spot.berthX, waitSec: m.trucks.schedule.handoverSec, status: m.trucks.schedule.status });
    return [
      {
        atMs: match.atMs,
        build: (): Truck => ({
          id,
          plate: match.podName,
          carrier: m.trucks.schedule.carrier,
          kind: "itv",
          cab: m.trucks.schedule.cab,
          driver: "",
          containerColor: containerColorFor(id),
          route,
          speed: m.trucks.schedule.speed,
          offset: -epochToSimT(match.atMs),
          once: true,
          trip: `${match.ns}/${match.podName} → ${match.node}`,
        }),
      },
    ];
  });
}

interface ShuttleLane {
  node: string;
  ns: string;
  pods: number;
}

/** Looping tractors between a namespace's block and each node running its pods, busiest lanes first. */
function shuttleTrips(state: ClusterState, basis: TripBasis, m: K8sPortMapping): Truck[] {
  const lanes = new Map<string, ShuttleLane>();
  for (const pod of Object.values(state.pods.items) as K8sPod[]) {
    const node = pod.spec?.nodeName;
    const ns = pod.metadata.namespace;
    if (!node || !ns || !basis.blockOfNs.has(ns)) continue;
    const key = `${node}/${ns}`;
    const lane = lanes.get(key) ?? { node, ns, pods: 0 };
    lane.pods += 1;
    lanes.set(key, lane);
  }
  return [...lanes.values()]
    .sort((a, b) => b.pods - a.pods || a.ns.localeCompare(b.ns) || a.node.localeCompare(b.node))
    .slice(0, m.trucks.shuttle.max)
    .flatMap((lane): Truck[] => {
      const spot = berthSpotOf(basis, lane.node);
      const craneSpot = spot ? craneSpotOf(basis, spot.vessel) : undefined;
      const blockId = basis.blockOfNs.get(lane.ns);
      const block = blockId ? blockById(blockId) : undefined;
      if (!spot || !craneSpot || !blockId || !block) return [];
      const id = `${SHUTTLE_ID_PREFIX}${lane.node}/${lane.ns}`;
      return [
        {
          id,
          plate: lane.ns,
          carrier: m.trucks.shuttle.carrier,
          kind: "itv",
          cab: m.trucks.shuttle.cab,
          driver: "",
          containerColor: containerColorFor(id),
          route: itvRoute({
            craneX: craneSpot.crane.x,
            craneLabel: craneSpot.craneId,
            blockX: block.x,
            blockZ: block.z,
            blockLabel: blockId,
            loading: stableHash(id) % 2 === 0,
          }),
          speed: m.trucks.shuttle.speed,
          offset: stableHash(`${id}:offset`) % m.trucks.shuttle.spreadSec,
          ambient: true,
          trip: `${lane.ns} ⇄ ${lane.node} · ${lane.pods} ${m.vocabulary.container.toLowerCase()}${lane.pods === 1 ? "" : "s"}`,
        },
      ];
    });
}

/** Trucks driven by the cluster: image pulls and scheduling moves play once from their event time, shuttles loop over live pod placement. */
export function buildTrucks(state: ClusterState, basis: TripBasis, m: K8sPortMapping, nowMs: number): Truck[] {
  const candidates = [...pullTrips(state, basis, m), ...scheduleTrips(state, basis, m)];
  const fromEvents = candidates
    .filter((c) => nowMs - c.atMs <= m.trucks.window)
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, m.trucks.maxTrucks)
    .map((c) => c.build());
  return [...fromEvents, ...shuttleTrips(state, basis, m)];
}
