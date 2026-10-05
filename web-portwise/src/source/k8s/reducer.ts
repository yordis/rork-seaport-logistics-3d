import type { K8sPod, ObjectMeta, ResourceKey, ResourceObjects, Uid, WatchEvent } from "./types";
import { RESOURCE_KEYS, asUid } from "./types";

export interface ResourceTable<T> {
  items: Readonly<Record<Uid, T>>;
  /** Last resourceVersion seen from a list, event or bookmark; where the next watch resumes. */
  resourceVersion: string | null;
  listed: boolean;
  /** resourceVersion each deleted uid was removed at, so a late duplicate cannot resurrect it. */
  tombstones: Readonly<Record<Uid, string>>;
}

export type ClusterState = { readonly [K in ResourceKey]: ResourceTable<ResourceObjects[K]> };

type ListAction = { [K in ResourceKey]: { type: "list"; resource: K; items: ResourceObjects[K][]; resourceVersion: string | null } }[ResourceKey];
type WatchAction = { [K in ResourceKey]: { type: "watch"; resource: K; event: WatchEvent<ResourceObjects[K]> } }[ResourceKey];

export type ClusterAction = ListAction | WatchAction | { type: "reset" };

const MAX_TOMBSTONES = 4096;

const emptyTable = <T,>(): ResourceTable<T> => ({ items: {}, resourceVersion: null, listed: false, tombstones: {} });

export const emptyCluster = (): ClusterState =>
  Object.fromEntries(RESOURCE_KEYS.map((k) => [k, emptyTable()])) as unknown as ClusterState;

const isNumeric = (v: string | undefined | null): v is string => !!v && /^\d+$/.test(v);

/** resourceVersions are opaque, but etcd-backed servers issue increasing integers; only compare when both look like that. */
export function compareVersions(a: string | undefined | null, b: string | undefined | null): number | null {
  if (!isNumeric(a) || !isNumeric(b)) return null;
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

const laterVersion = (current: string | null, next: string | undefined): string | null => {
  if (!next) return current;
  const c = compareVersions(next, current);
  return c === null || c > 0 ? next : current;
};

interface Keyed {
  metadata: ObjectMeta;
}

const sameItems = <T extends Keyed>(prev: Record<Uid, T>, next: T[]): boolean =>
  Object.keys(prev).length === next.length && next.every((o) => prev[asUid(o.metadata.uid)]?.metadata.resourceVersion === o.metadata.resourceVersion);

function applyList<T extends Keyed>(prev: ResourceTable<T>, items: T[], resourceVersion: string | null): ResourceTable<T> {
  if (prev.listed && sameItems(prev.items, items)) {
    return prev.resourceVersion === resourceVersion ? prev : { ...prev, resourceVersion };
  }
  const sorted = [...items].sort((a, b) => (a.metadata.uid < b.metadata.uid ? -1 : a.metadata.uid > b.metadata.uid ? 1 : 0));
  return { items: Object.fromEntries(sorted.map((o) => [o.metadata.uid, o])) as Record<Uid, T>, resourceVersion, listed: true, tombstones: {} };
}

function applyEvent<T extends Keyed>(table: ResourceTable<T>, event: WatchEvent<T>): ResourceTable<T> {
  const meta = event.object?.metadata;
  if (event.type === "ERROR" || !meta) return table;
  if (event.type === "BOOKMARK") {
    const rv = laterVersion(table.resourceVersion, meta.resourceVersion);
    return rv === table.resourceVersion ? table : { ...table, resourceVersion: rv };
  }
  const uid = asUid(meta.uid);
  const existing = table.items[uid];
  const rv = meta.resourceVersion;
  const vsExisting = existing ? compareVersions(rv, existing.metadata.resourceVersion) : null;
  if (vsExisting !== null && vsExisting < 0) return table;
  const resourceVersion = laterVersion(table.resourceVersion, rv);

  if (event.type === "DELETED") {
    if (!existing && table.tombstones[uid] !== undefined) return table;
    const items = { ...table.items };
    delete items[uid];
    const tombstones = { ...table.tombstones, [uid]: rv ?? "" };
    const keys = Object.keys(tombstones) as Uid[];
    if (keys.length > MAX_TOMBSTONES) delete tombstones[keys[0]];
    return { ...table, items, tombstones, resourceVersion };
  }

  if (existing && rv !== undefined && rv === existing.metadata.resourceVersion) return table;
  const tomb = table.tombstones[uid];
  if (!existing && tomb !== undefined) {
    const vsTomb = compareVersions(rv, tomb);
    if (vsTomb === null || vsTomb <= 0) return table;
  }
  return { ...table, items: { ...table.items, [uid]: event.object }, resourceVersion };
}

/** Pure, idempotent cluster state: applying the same list or watch event twice yields the same state. */
export function clusterReducer(state: ClusterState, action: ClusterAction): ClusterState {
  switch (action.type) {
    case "reset":
      return emptyCluster();
    case "list": {
      const prev = state[action.resource] as ResourceTable<Keyed>;
      const next = applyList(prev, action.items as Keyed[], action.resourceVersion);
      return next === prev ? state : { ...state, [action.resource]: next };
    }
    case "watch": {
      const prev = state[action.resource] as ResourceTable<Keyed>;
      const next = applyEvent(prev, action.event as WatchEvent<Keyed>);
      return next === prev ? state : { ...state, [action.resource]: next };
    }
  }
}

const isScheduled = (pod: K8sPod | undefined): boolean =>
  !!pod?.spec?.nodeName && (pod.status?.conditions?.find((c) => c.type === "PodScheduled")?.status ?? "True") === "True";

/** Nodes that just received a pod: a new pod that already has a node, or a PodScheduled transition to True. */
export function scheduledNodes(prev: ClusterState, action: ClusterAction): string[] {
  if (action.type !== "watch" || action.resource !== "pods") return [];
  const { type, object } = action.event;
  if ((type !== "ADDED" && type !== "MODIFIED") || !object?.metadata) return [];
  const before = prev.pods.items[asUid(object.metadata.uid)];
  if (!isScheduled(object) || isScheduled(before)) return [];
  return [object.spec?.nodeName ?? ""];
}
