import type { ConnectionStatus, PortSnapshot } from "../model";
import { ApiError, GoneError, listResource, RELIST_INTERVAL_MS, STREAMED, watchResource } from "./client";
import { K8S_PORT_MAPPING } from "./mapping";
import type { BerthActivity, NodeActivity } from "./project";
import { projectPort } from "./project";
import type { ClusterAction, ClusterState } from "./reducer";
import { clusterReducer, emptyCluster, scheduledNodes } from "./reducer";
import type { ResourceKey } from "./types";
import { RESOURCE_KEYS } from "./types";

const PROJECT_DEBOUNCE_MS = 250;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

let cluster: ClusterState = emptyCluster();
let activity: Record<string, NodeActivity> = {};
let snapshot: PortSnapshot = projectPort(cluster, activity);
let status: ConnectionStatus = { kind: "idle" };
let controller: AbortController | null = null;
let projectTimer: ReturnType<typeof setTimeout> | null = null;
const failures = new Map<ResourceKey, ApiError | Error>();
const listed = new Set<ResourceKey>();

const snapshotListeners = new Set<() => void>();
const statusListeners = new Set<() => void>();

const subscribeTo = (set: Set<() => void>) => (fn: () => void): (() => void) => {
  set.add(fn);
  return () => {
    set.delete(fn);
  };
};

function project(): void {
  projectTimer = null;
  snapshot = projectPort(cluster, activity as BerthActivity, K8S_PORT_MAPPING, Date.now());
  snapshotListeners.forEach((l) => l());
}

function scheduleProject(): void {
  if (projectTimer === null) projectTimer = setTimeout(project, PROJECT_DEBOUNCE_MS);
}

function setStatus(next: ConnectionStatus): void {
  if (next.kind === status.kind && ("message" in next ? next.message : "") === ("message" in status ? status.message : "")) return;
  status = next;
  statusListeners.forEach((l) => l());
}

function refreshStatus(): void {
  if (!controller) return setStatus({ kind: "idle" });
  const failure = [...failures.values()][0];
  if (failure) {
    const unreachable = failure instanceof ApiError && (failure.status === 0 || failure.status >= 502);
    return setStatus(unreachable ? { kind: "disconnected", message: failure.message } : { kind: "error", message: failure.message });
  }
  setStatus(listed.size === RESOURCE_KEYS.length ? { kind: "live" } : { kind: "connecting" });
}

function recordMove(node: string, now: number): void {
  const prev = activity[node];
  const busy = prev && now < prev.lastMoveAt + K8S_PORT_MAPPING.crane.activeWindowMs;
  activity = { ...activity, [node]: { activeFrom: busy ? prev.activeFrom : now, lastMoveAt: now, moves: (prev?.moves ?? 0) + 1 } };
}

function dispatch(action: ClusterAction): void {
  const moved = scheduledNodes(cluster, action);
  const next = clusterReducer(cluster, action);
  if (next === cluster) return;
  cluster = next;
  const now = Date.now();
  moved.filter(Boolean).forEach((node) => recordMove(node, now));
  scheduleProject();
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(id);
      resolve();
    }, { once: true });
  });

const backoff = (attempt: number): number => Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);

async function run(resource: ResourceKey, signal: AbortSignal): Promise<void> {
  let needList = true;
  let attempt = 0;
  while (!signal.aborted) {
    try {
      if (needList) {
        const { items, resourceVersion } = await listResource(resource, signal);
        if (signal.aborted) return;
        const keep = STREAMED.has(resource) ? resourceVersion : (cluster[resource].resourceVersion ?? resourceVersion);
        dispatch({ type: "list", resource, items, resourceVersion: keep } as ClusterAction);
        needList = false;
        listed.add(resource);
      }
      failures.delete(resource);
      refreshStatus();
      if (!STREAMED.has(resource)) {
        attempt = 0;
        await sleep(RELIST_INTERVAL_MS, signal);
        needList = true;
        continue;
      }
      await watchResource(resource, cluster[resource].resourceVersion, signal, (event) => {
        dispatch({ type: "watch", resource, event } as ClusterAction);
        attempt = 0;
      });
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof GoneError) {
        needList = true;
        if (attempt++ > 0) await sleep(backoff(attempt - 1), signal);
        continue;
      }
      failures.set(resource, err instanceof Error ? err : new Error(String(err)));
      refreshStatus();
      await sleep(backoff(attempt++), signal);
    }
  }
}

/** Read-only list then watch of the cluster, projected onto the port model. */
export const liveStore = {
  snapshot: (): PortSnapshot => snapshot,
  status: (): ConnectionStatus => status,
  subscribe: subscribeTo(snapshotListeners),
  subscribeStatus: subscribeTo(statusListeners),
  /** Idempotent: a second start while running is a no-op. Returns the matching stop. */
  start(): () => void {
    if (!controller) {
      controller = new AbortController();
      cluster = emptyCluster();
      activity = {};
      failures.clear();
      listed.clear();
      project();
      refreshStatus();
      const { signal } = controller;
      RESOURCE_KEYS.forEach((r) => void run(r, signal));
    }
    return liveStore.stop;
  },
  stop(): void {
    if (!controller) return;
    controller.abort();
    controller = null;
    if (projectTimer !== null) clearTimeout(projectTimer);
    projectTimer = null;
    refreshStatus();
  },
};
