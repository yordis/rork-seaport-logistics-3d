import { useEffect, useSyncExternalStore } from "react";
import type { Container, QuayCrane, Shipment, Vessel, YardBlock } from "@/data/types";
import { shipmentById } from "@/data/containers";
import { timeControl } from "@/sim/simStore";
import type { ConnectionStatus, PortSnapshot, SourceKind } from "./model";
import { SIM_SNAPSHOT } from "./simulation";
import { liveStore } from "./k8s/liveStore";

const STORAGE_KEY = "portwise.source";

const readInitial = (): SourceKind => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "live" ? "live" : "simulation";
  } catch {
    return "simulation";
  }
};

let kind: SourceKind = typeof window === "undefined" ? "simulation" : readInitial();
const listeners = new Set<() => void>();

/** Which data drives the port: the built-in simulation or the live cluster. Persisted per browser. */
export const dataSource = {
  get: (): SourceKind => kind,
  set: (value: SourceKind): void => {
    if (value === kind) return;
    kind = value;
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // storage unavailable, keep the in-memory value
    }
    if (value === "live") timeControl.goLive();
    listeners.forEach((l) => l());
  },
  toggle: (): void => dataSource.set(kind === "live" ? "simulation" : "live"),
  subscribe: (fn: () => void): (() => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export const useDataSource = (): SourceKind => useSyncExternalStore(dataSource.subscribe, dataSource.get, () => "simulation");

export const isLive = (): boolean => kind === "live";

export const currentPort = (): PortSnapshot => (kind === "live" ? liveStore.snapshot() : SIM_SNAPSHOT);

const subscribePort = (fn: () => void): (() => void) => {
  const a = dataSource.subscribe(fn);
  const b = liveStore.subscribe(fn);
  return () => {
    a();
    b();
  };
};

/** The port model of the active source. Stable between changes, so it is safe as a memo dependency. */
export const usePortSnapshot = (): PortSnapshot => useSyncExternalStore(subscribePort, currentPort, () => SIM_SNAPSHOT);

export const useConnectionStatus = (): ConnectionStatus => useSyncExternalStore(liveStore.subscribeStatus, liveStore.status, liveStore.status);

/** Runs the cluster watch while the live source is selected. Mount once, near the app root. */
export function useLiveConnection(): void {
  const source = useDataSource();
  useEffect(() => {
    if (source !== "live") return;
    timeControl.goLive();
    return liveStore.start();
  }, [source]);
}

interface PortIndex {
  vessels: Map<string, Vessel>;
  cranes: Map<string, QuayCrane>;
  blocks: Map<string, YardBlock>;
  containers: Map<string, Container>;
  byBlock: Map<string, Container[]>;
  byVessel: Map<string, Container[]>;
  shipments: Map<string, Shipment>;
}

const indexes = new WeakMap<PortSnapshot, PortIndex>();

const groupBy = (items: Container[], key: (c: Container) => string): Map<string, Container[]> => {
  const out = new Map<string, Container[]>();
  for (const c of items) {
    const k = key(c);
    if (!k) continue;
    const list = out.get(k);
    if (list) list.push(c);
    else out.set(k, [c]);
  }
  return out;
};

function indexOf(port: PortSnapshot): PortIndex {
  let idx = indexes.get(port);
  if (!idx) {
    idx = {
      vessels: new Map(port.vessels.map((v) => [v.id, v])),
      cranes: new Map(port.cranes.map((c) => [c.id, c])),
      blocks: new Map(port.blocks.map((b) => [b.id, b])),
      containers: new Map(port.containers.map((c) => [c.id, c])),
      byBlock: groupBy(port.containers, (c) => c.blockId),
      byVessel: groupBy(port.containers, (c) => c.vesselId),
      shipments: new Map((port.shipments ?? []).map((s) => [s.id, s])),
    };
    indexes.set(port, idx);
  }
  return idx;
}

export const findVessel = (id: string | undefined, port: PortSnapshot = currentPort()): Vessel | undefined => (id ? indexOf(port).vessels.get(id) : undefined);
export const findCrane = (id: string | undefined, port: PortSnapshot = currentPort()): QuayCrane | undefined => (id ? indexOf(port).cranes.get(id) : undefined);
export const findBlock = (id: string | undefined, port: PortSnapshot = currentPort()): YardBlock | undefined => (id ? indexOf(port).blocks.get(id) : undefined);
export const findContainer = (id: string | undefined, port: PortSnapshot = currentPort()): Container | undefined => (id ? indexOf(port).containers.get(id) : undefined);
export const containersIn = (blockId: string, port: PortSnapshot = currentPort()): Container[] => indexOf(port).byBlock.get(blockId) ?? [];
/** Shipments the source tracks, or the built-in catalogue when it has none of its own. */
export const findShipment = (id: string | undefined, port: PortSnapshot = currentPort()): Shipment | undefined =>
  !id ? undefined : port.shipments ? indexOf(port).shipments.get(id) : shipmentById(id);
export const containersOn = (vesselId: string, port: PortSnapshot = currentPort()): Container[] => indexOf(port).byVessel.get(vesselId) ?? [];
