import { Link } from "react-router-dom";
import { Wind, X } from "lucide-react";
import type { QuayCrane, Vessel } from "@/data/types";
import { sim, simT, useSimTick } from "@/sim/simStore";
import { craneMoves, craneStatus } from "@/source/cranes";
import { findCrane, findVessel, usePortSnapshot } from "@/source/store";
import { MetaRows } from "./MetaRows";
import { usePort } from "@/state/PortProvider";
import { CraneGlyph, DefRow, IconButton, Panel, PanelHeader, ProgressBar, StatusChip } from "./primitives";

export function CraneCard({ id }: { id: string }) {
  useSimTick();
  const { closeOverride } = usePort();
  const port = usePortSnapshot();
  const crane = findCrane(id, port);
  if (!crane) return null;
  const vessel = findVessel(crane.vesselId, port);
  const st = craneStatus(crane, simT());
  const active = st.state === "active";
  const loading = vessel?.status === "loading";
  const live = vessel ? sim.vessels[vessel.id] : undefined;
  const progress = vessel && live ? (loading ? live.loaded / vessel.loadTotal : live.discharged / vessel.dischargeTotal) : 0;
  const rate = crane.movesPerHour || 28;

  return (
    <Panel className="w-full p-4" aria-label={`Crane ${crane.id}`}>
      <PanelHeader
        eyebrow={`Quay crane · Berth ${crane.berth}`}
        title={<span className="font-mono">{crane.id}</span>}
        icon={<CraneGlyph className="h-6 w-6" />}
        right={
          <IconButton label="Close" onClick={closeOverride}>
            <X className="h-4 w-4" />
          </IconButton>
        }
      />
      <p className="mt-1 pl-[52px] text-[12.5px] text-slate">
        {crane.model} · {crane.operator}
      </p>
      <div className="mt-3 pl-[52px]">
        {crane.meta ? (
          <StatusChip tone={active ? "moss" : "amber"} pulse={active}>
            {active ? "Scheduling pods" : st.reason ?? "Idle"}
          </StatusChip>
        ) : st.state === "paused" ? (
          <StatusChip tone="brick" pulse>
            {st.reason}
          </StatusChip>
        ) : active ? (
          <StatusChip tone="moss">{loading ? "Loading" : "Discharging"}</StatusChip>
        ) : (
          <StatusChip tone="amber">{st.reason ?? "Idle"}</StatusChip>
        )}
      </div>

      {crane.meta ? (
        <>
          <div className="mt-4 rounded-[10px] bg-sand/70 p-3">
            <p className="eyebrow">Pods scheduled since connect</p>
            <p className="mt-1 font-mono text-[22px] font-bold text-ink tnum">{craneMoves(crane)}</p>
          </div>
          <MetaRows meta={crane.meta} className="mt-3" />
        </>
      ) : (
        <CraneSimDetails crane={crane} vessel={vessel} active={active} loading={loading} progress={progress} rate={rate} paused={st.state === "paused"} />
      )}
    </Panel>
  );
}

function CraneSimDetails({ crane, vessel, active, loading, progress, rate, paused }: { crane: QuayCrane; vessel?: Vessel; active: boolean; loading: boolean; progress: number; rate: number; paused: boolean }) {
  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-[10px] bg-sand/70 p-3">
          <p className="eyebrow">Productivity</p>
          <p className="mt-1 font-mono text-[22px] font-bold text-ink tnum">
            {active ? rate : 0}
            <span className="ml-1 font-sans text-[12px] font-medium text-slate">moves/h</span>
          </p>
        </div>
        <div className="rounded-[10px] bg-sand/70 p-3">
          <p className="eyebrow">Moves today</p>
          <p className="mt-1 font-mono text-[22px] font-bold text-ink tnum">{craneMoves(crane)}</p>
        </div>
      </div>

      {vessel ? (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-[13px]">
            <span className="font-semibold text-ink">{loading ? "Loading progress" : "Discharge progress"}</span>
            <span className="font-mono font-semibold text-ink tnum">{Math.round(progress * 100)}%</span>
          </div>
          <ProgressBar value={progress} live={active} />
        </div>
      ) : null}

      <dl className="mt-3">
        <DefRow label="Serving vessel" mono={false}>
          {vessel ? (
            <Link to={`/vessels/${vessel.id}`} className="text-harbor underline-offset-2 hover:underline">
              {vessel.name}
            </Link>
          ) : (
            "—"
          )}
        </DefRow>
        <DefRow label="Outreach">52 m · 22 rows</DefRow>
        <DefRow label="Lift capacity">{crane.model.includes("70t") ? "70 t" : crane.model.includes("60t") ? "60 t" : "65 t"}</DefRow>
        <DefRow
          label={
            <span className="inline-flex items-center gap-1.5">
              <Wind className="h-3.5 w-3.5" /> Wind at boom
            </span>
          }
        >
          <span className={paused ? "text-brick" : ""}>{paused ? "14 m/s" : "11 m/s"}</span>
        </DefRow>
      </dl>
    </>
  );
}
