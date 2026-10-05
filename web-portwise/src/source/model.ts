import type { Alert, Berth, Container, QuayCrane, Shipment, StatusTone, Vessel, YardBlock } from "@/data/types";

export type SourceKind = "simulation" | "live";

export type KpiIcon = "vessel" | "crane" | "clock" | "yard";

export interface KpiReading {
  id: string;
  icon: KpiIcon;
  label: string;
  value: string;
  unit?: string;
}

/** Work waiting outside the port, drawn as a marker at the anchorage. */
export interface AnchorageQueue {
  label: string;
  count: number;
  tone: StatusTone;
}

/** Groups that did not fit into a yard block. */
export interface YardOverflow {
  label: string;
  groups: number;
  items: number;
}

/** Everything the port UI renders, independent of where the data came from. */
export interface PortSnapshot {
  source: SourceKind;
  /** Berths along the quay, in order; the source decides how many exist. */
  berths: Berth[];
  vessels: Vessel[];
  cranes: QuayCrane[];
  blocks: YardBlock[];
  containers: Container[];
  alerts: Alert[];
  anchorage: AnchorageQueue | null;
  overflow: YardOverflow | null;
  kpis: KpiReading[] | null;
  /** Shipments the source tracks itself; null when the built-in shipment catalogue applies. */
  shipments: Shipment[] | null;
  /** Whether the logistics district (facilities, drayage) is backed by this source. */
  logistics: boolean;
}

export type ConnectionStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "live" }
  | { kind: "error"; message: string }
  | { kind: "disconnected"; message: string };
