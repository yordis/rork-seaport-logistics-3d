export type Severity = "danger" | "warning" | "info" | "success";

export type StatusTone = "signal" | "moss" | "amber" | "brick" | "harbor" | "slate";

export interface DetailRow {
  label: string;
  value: string;
}

/** Source-provided readout for an entity: when present, the HUD shows it instead of simulated figures. */
export interface EntityMeta {
  sourceId: string;
  headline: string;
  tone: StatusTone;
  /** 0..1, how full the entity is (deck load, block occupancy). */
  fill: number;
  details: DetailRow[];
}

export type VesselStatus = "discharging" | "loading" | "arriving" | "scheduled";

/** A berth along the quay: its 1-based number, centre on x and usable length. */
export interface Berth {
  n: number;
  x: number;
  length: number;
}

export interface Vessel {
  id: string;
  name: string;
  short: string;
  imo: string;
  line: string;
  flag: string;
  voyage: string;
  from: string;
  to: string;
  berth: number;
  status: VesselStatus;
  dischargeTotal: number;
  discharged: number;
  loadTotal: number;
  loaded: number;
  eta: string;
  etb: string;
  etd: string;
  cranes: string[];
  hull: string;
  length: number;
  /** Rendered in the 3D scene */
  inScene: boolean;
  delayMin?: number;
  /** Position in the anchorage queue for vessels without a berth (berth 0). */
  anchorSlot?: number;
  meta?: EntityMeta;
}

export interface BerthBooking {
  berth: number;
  label: string;
  vesselId?: string;
  start: number;
  end: number;
  kind: "done" | "active" | "planned" | "late" | "maintenance";
  plannedStart?: number;
}

export type CraneMode = "discharge" | "load" | "paused" | "idle";

export interface QuayCrane {
  id: string;
  x: number;
  berth: number;
  vesselId?: string;
  mode: CraneMode;
  movesPerHour: number;
  movesToday: number;
  model: string;
  operator: string;
  reason?: string;
  /** Event-driven work instead of a scripted shift: the crane runs while moves keep arriving. */
  activity?: CraneActivity;
  meta?: EntityMeta;
}

export interface CraneActivity {
  /** Epoch ms of the first move in the current burst of work. */
  activeFrom: number;
  /** Epoch ms the crane stands down unless another move arrives, 0 when none was seen. */
  activeUntil: number;
  moves: number;
}

export type BlockCategory = "import" | "export" | "reefer";

export interface YardBlock {
  id: string;
  x: number;
  z: number;
  category: BlockCategory;
  fill: number;
  capacity: number;
  meta?: EntityMeta;
}

export interface Alert {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  time: string;
  target?: Selection;
}

export interface RoutePoint {
  p: [number, number];
  wait?: number;
  /** Container visible on chassis from this point on */
  load?: boolean;
  status?: string;
  hidden?: boolean;
}

export interface Truck {
  id: string;
  plate: string;
  carrier: string;
  kind: "itv" | "external" | "drayage";
  /** Drayage trucks: short description of the trip, e.g. "Terminal → Seastar CFS". */
  trip?: string;
  facilityId?: string;
  cab: string;
  gate?: "Gate A" | "Gate B";
  driver: string;
  containerColor: string;
  route: RoutePoint[];
  speed: number;
  offset: number;
  shipmentId?: string;
  baseWait?: number;
}

export type SelectionKind = "vessel" | "crane" | "truck" | "block" | "container" | "shipment" | "facility";

export interface Selection {
  kind: SelectionKind;
  id: string;
}

export interface Container {
  index: number;
  id: string;
  code: string;
  prefix: string;
  line: string;
  blockId: string;
  bay: number;
  row: number;
  tier: number;
  position: string;
  x: number;
  y: number;
  z: number;
  color: string;
  size: string;
  category: BlockCategory;
  cargo: string;
  weight: number;
  vesselId: string;
  customs: "Cleared" | "Inspection hold" | "Declaring";
  shipmentId: string;
  meta?: EntityMeta;
}

export interface ShipmentStep {
  label: string;
  time: string;
}

/** A shipment that cannot progress until something outside the terminal is fixed. */
export interface ShipmentHold {
  severity: Severity;
  reason: string;
}

export interface Shipment {
  id: string;
  /** Display name when the id is not meant for people. */
  label?: string;
  direction: "import" | "export";
  containerIds: string[];
  vesselId: string;
  destination: string;
  consignee: string;
  cargo: string;
  sizeLabel: string;
  steps: ShipmentStep[];
  current: number;
  truckId?: string;
  hold?: ShipmentHold;
  meta?: EntityMeta;
}
