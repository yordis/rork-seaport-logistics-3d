import { ALERTS, BERTHS, QUAY_CRANES, VESSELS, YARD_BLOCKS } from "@/data/port";
import { CONTAINERS } from "@/data/containers";
import type { PortSnapshot } from "./model";

export const SIM_SNAPSHOT: PortSnapshot = {
  source: "simulation",
  berths: BERTHS,
  vessels: VESSELS,
  cranes: QUAY_CRANES,
  blocks: YARD_BLOCKS,
  containers: CONTAINERS,
  alerts: ALERTS,
  anchorage: null,
  overflow: null,
  kpis: null,
  shipments: null,
  logistics: true,
  vocabulary: {
    vessel: "Vessel",
    container: "Container",
    shipment: "Shipment",
    shipments: "Shipments",
    journey: "Shipment journey",
    search: "Search vessels, containers, trucks, shipments…",
  },
};
