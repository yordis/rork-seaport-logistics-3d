import type { Berth } from "./types";

/** World layout constants. Water lies at z > QUAY_Z, land at z < QUAY_Z. +x points right on screen. */
export const QUAY_Z = 20;
export const WATER_Y = -1.4;
export const LAND_RAIL_Z = 12;
export const SEA_RAIL_Z = 18;
export const CRANE_LANE_Z = 15;
export const APRON_Z = 8;
export const SHIP_Z = 25.2;

export const BERTH_SPACING = 50;
export const berthX = (berth: number): number => -175 + (berth - 1) * BERTH_SPACING;

/** Quay extent along x. */
export const QUAY_MIN_X = -212;
export const QUAY_MAX_X = 212;
export const QUAY_MARGIN = 12;

/** Berths from the western end of the quay at the standard length, compressed only when they would not fit. */
export function layoutBerths(count: number): Berth[] {
  const n = Math.max(0, Math.floor(count));
  const length = Math.min(BERTH_SPACING, (QUAY_MAX_X - QUAY_MIN_X - 2 * QUAY_MARGIN) / Math.max(1, n));
  return Array.from({ length: n }, (_, i) => ({ n: i + 1, x: QUAY_MIN_X + QUAY_MARGIN + length * (i + 0.5), length }));
}

/** The stretch of quay the berths occupy, including the end margins. */
export function quayExtent(berths: readonly Berth[]): [number, number] {
  if (!berths.length) return [QUAY_MIN_X, QUAY_MIN_X];
  const first = berths[0];
  const last = berths[berths.length - 1];
  return [Math.max(QUAY_MIN_X, first.x - first.length / 2 - QUAY_MARGIN), Math.min(QUAY_MAX_X, last.x + last.length / 2 + QUAY_MARGIN)];
}

/** Crane positions spread across a berth, centred on it. */
export const craneXs = (berth: Berth, perBerth: number): number[] =>
  Array.from({ length: perBerth }, (_, k) => berth.x + (k - (perBerth - 1) / 2) * (berth.length / Math.max(2, perBerth + 1)));

/** Shifts a shot authored for the full quay so it stays centred on the berths in use. */
export const quayShotX = (authoredX: number, berths: readonly Berth[]): number => {
  const [lo, hi] = quayExtent(berths);
  return berths.length ? authoredX + (lo + hi) / 2 - (QUAY_MIN_X + QUAY_MAX_X) / 2 : authoredX;
};

export const CONTAINER_L = 3.0;
export const CONTAINER_W = 1.3;
export const CONTAINER_H = 1.3;

export const BLOCK_BAYS = 8;
export const BLOCK_ROWS = 6;
export const BLOCK_TIERS = 4;
export const BAY_PITCH = 3.2;
export const ROW_PITCH = 1.45;
export const BLOCK_HALF_X = (BLOCK_BAYS * BAY_PITCH) / 2;
export const BLOCK_HALF_Z = (BLOCK_ROWS * ROW_PITCH) / 2;

/** Ten block columns, 32 m apart; vertical roads run between them at x = -160 + 32k. */
export const BLOCK_COL_X = Array.from({ length: 10 }, (_, i) => -144 + i * 32);
export const BLOCK_ROW_Z: Record<string, number> = { A: 0, B: -14, C: -28, D: -42 };
export const ROW_ROADS_Z = [-7, -21, -35, -49];
export const COL_ROADS_X = Array.from({ length: 11 }, (_, k) => -160 + k * 32);

/** Main north–south spine linking the gate plaza to every yard lane. */
export const SPINE_X = 176;
export const GATE_X = 200;
/** Gate plaza road runs east to the far kerb of the port avenue (see facilities.ts AVE_X). */
export const ROAD_END_X = 326;

export const COLORS = {
  ink: "#12233F",
  paper: "#FFFDF8",
  canvas: "#F3EFE6",
  land: "#EAE4D6",
  pavement: "#D9D3C6",
  road: "#C9C2B3",
  pad: "#E3DCCD",
  quay: "#D4CDBE",
  quayWall: "#BDB5A4",
  signal: "#F2622E",
  moss: "#2F8F6B",
  amber: "#E8A317",
  brick: "#C8423B",
  slate: "#6B7280",
  steelDark: "#2B3442",
  white: "#F6F3EC",
  tree: "#6E9B6B",
  treeDark: "#4E7A5A",
} as const;

export const CONTAINER_COLORS = {
  orange: "#F2622E",
  navy: "#1E3A66",
  brick: "#B5463A",
  moss: "#4E7A5A",
  sand: "#D9B26A",
  steel: "#4F6D8F",
  reefer: "#EDEBE4",
} as const;

/** Western Anchorage moorings for ships waiting without a berth, filled in queue order. */
export const ANCHOR_ORIGIN: [number, number] = [470, 226];
const ANCHOR_COLS = 4;
const ANCHOR_PITCH: [number, number] = [34, 18];

export const anchorPosition = (slot: number): [number, number] => [
  ANCHOR_ORIGIN[0] + (slot % ANCHOR_COLS) * ANCHOR_PITCH[0],
  ANCHOR_ORIGIN[1] + Math.floor(slot / ANCHOR_COLS) * ANCHOR_PITCH[1],
];
