import type { RoutePoint } from "./types";
import { APRON_Z, GATE_X } from "./layout";
import { AVE_N, AVE_S } from "./facilities";

export const IN_LANE_X = 174;
export const OUT_LANE_X = 179;

export interface ExternalSpec {
  gate: "A" | "B";
  blockX: number;
  rowZ: number;
  load: boolean;
  queue?: number;
  queueX?: number;
}

/** Staging area → port avenue → gate → spine → yard lane → block → back out under the expressway. */
export function externalRoute({ gate, blockX, rowZ, load, queue, queueX = 224 }: ExternalSpec): RoutePoint[] {
  const inZ = gate === "A" ? -3 : -15;
  const outZ = gate === "A" ? -8 : -20;
  const returnZ = rowZ === -49 ? -35 : rowZ - 14;
  const sideX = blockX - 16;
  const startStatus = queue ? "Queued" : "Called from staging";
  const route: RoutePoint[] = [
    { p: [AVE_S + 8, -124], hidden: true, load: !load, status: startStatus },
    { p: [AVE_S, -124] },
    { p: [AVE_S, inZ], status: queue ? "Queued" : "Arriving" },
  ];
  if (queue) route.push({ p: [queueX, inZ], wait: queue, status: "Queued" });
  else route.push({ p: [GATE_X + 34, inZ], status: "Arriving" });
  route.push(
    { p: [GATE_X, inZ], wait: 3, status: "Entering" },
    { p: [IN_LANE_X, inZ], status: "Entering" },
    { p: [IN_LANE_X, rowZ] },
    { p: [blockX, rowZ], wait: 7, load, status: "Handling" },
    { p: [sideX, rowZ], status: "Exiting" },
    { p: [sideX, returnZ] },
    { p: [OUT_LANE_X, returnZ] },
    { p: [OUT_LANE_X, outZ] },
    { p: [GATE_X, outZ], wait: 3, status: "Exiting" },
    { p: [AVE_N, outZ], status: "Departed" },
    { p: [AVE_N, -104], status: "Departed" },
  );
  return route;
}

export interface ItvSpec {
  craneX: number;
  craneLabel: string;
  blockX: number;
  blockZ: number;
  blockLabel: string;
  loading: boolean;
}

/** Quay crane ⇄ yard block shuttle along the apron and yard lanes. */
export function itvRoute({ craneX, craneLabel, blockX, blockZ, loading, blockLabel }: ItvSpec): RoutePoint[] {
  const cx = craneX;
  const bx = blockX;
  const rowZ = blockZ - 7;
  const near = cx < bx ? bx - 16 : bx + 16;
  const far = cx < bx ? bx + 16 : bx - 16;
  if (!loading) {
    return [
      { p: [cx, 15], wait: 7, load: true, status: `Loading at ${craneLabel}` },
      { p: [near, 15], status: "To yard" },
      { p: [near, rowZ] },
      { p: [bx, rowZ], wait: 6, load: false, status: `Grounding at ${blockLabel}` },
      { p: [far, rowZ], status: "Back to crane" },
      { p: [far, 8] },
      { p: [cx, 8] },
    ];
  }
  return [
    { p: [bx, rowZ], wait: 6, load: true, status: `Picking at ${blockLabel}` },
    { p: [far, rowZ], status: `To ${craneLabel}` },
    { p: [far, 8] },
    { p: [cx, 8] },
    { p: [cx, 15], wait: 7, load: false, status: `Delivering to ${craneLabel}` },
    { p: [near, 15], status: "Back to yard" },
    { p: [near, rowZ] },
  ];
}

export interface PullSpec {
  gate: "A" | "B";
  berthX: number;
  waitSec: number;
  status: string;
}

/** Gate → quay apron in front of a berth and back: an external truck pulling an image for a node. */
export function pullRoute({ gate, berthX, waitSec, status }: PullSpec): RoutePoint[] {
  const inZ = gate === "A" ? -3 : -15;
  const outZ = gate === "A" ? -8 : -20;
  const route: RoutePoint[] = [
    { p: [AVE_S + 8, -124], hidden: true, load: false, status: "Called from staging" },
    { p: [AVE_S, -124] },
    { p: [AVE_S, inZ], status: "Arriving" },
    { p: [GATE_X + 34, inZ], status: "Arriving" },
    { p: [GATE_X, inZ], wait: 3, status: "Entering" },
    { p: [IN_LANE_X, inZ], load: true, status: "Entering" },
    { p: [IN_LANE_X, APRON_Z] },
    { p: [berthX, APRON_Z], wait: waitSec, status },
    { p: [OUT_LANE_X, APRON_Z], status: "Exiting" },
    { p: [OUT_LANE_X, outZ] },
    { p: [GATE_X, outZ], wait: 3, status: "Exiting" },
    { p: [AVE_N, outZ], status: "Departed" },
    { p: [AVE_N, -104], status: "Departed" },
  ];
  return route;
}
