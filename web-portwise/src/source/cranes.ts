import type { QuayCrane } from "@/data/types";
import { craneStatusAt, sim } from "@/sim/simStore";
import type { CraneStatus } from "@/sim/simStore";

const BOOM_SWING_MS = 4000;

const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Crane state for either source: event-driven cranes follow wall-clock activity, simulated ones follow sim time. */
export function craneStatus(c: QuayCrane, t: number, now: number = Date.now()): CraneStatus {
  const a = c.activity;
  if (!a) return craneStatusAt(c, t);
  const reason = c.reason ?? "Idle";
  if (!a.activeUntil) return { state: "idle", reason, loading: true, boom: 1 };
  const until = a.activeUntil;
  if (now < until) return { state: "active", loading: true, boom: 1 - ease(clamp01((now - a.activeFrom) / BOOM_SWING_MS)) };
  return { state: "idle", reason, loading: true, boom: ease(clamp01((now - until) / BOOM_SWING_MS)) };
}

export const isCraneActive = (c: QuayCrane, t: number): boolean => (c.activity ? craneStatus(c, t).state === "active" : !!sim.craneActive[c.id]);

export const craneMoves = (c: QuayCrane): number => (c.activity ? c.activity.moves : sim.craneMoves[c.id] ?? c.movesToday);
