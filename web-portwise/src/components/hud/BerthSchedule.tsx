import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { BERTH_COUNT, BERTH_SCHEDULE, vesselById } from "@/data/port";
import type { BerthBooking } from "@/data/types";
import { cn } from "@/lib/utils";
import { fmtClock, sim, simNowHours, simNowSec, useSimTick } from "@/sim/simStore";
import { usePort } from "@/state/PortProvider";
import { usePortSnapshot } from "@/source/store";
import { craneStatus } from "@/source/cranes";
import type { Tone } from "./primitives";
import { Panel, ProgressBar, StatusChip } from "./primitives";

const HOURS = Array.from({ length: 13 }, (_, i) => i * 2);
const pct = (h: number): string => `${(Math.max(0, Math.min(24, h)) / 24) * 100}%`;

const BAR: Record<BerthBooking["kind"], string> = {
  active: "bg-signal text-white",
  done: "bg-moss/25 text-moss",
  planned: "bg-harbor-soft text-harbor border border-harbor/25",
  late: "bg-harbor text-white",
  maintenance: "pw-hatch bg-sand text-slate border border-hairline",
};

function Bar({ b, now, highlight }: { b: BerthBooking; now: number; highlight: boolean }) {
  const { open, setHovered } = usePort();
  const isLoading = b.vesselId ? vesselById(b.vesselId)?.status === "loading" : false;
  const call = b.vesselId ? sim.calls[b.vesselId] : undefined;
  const sailed = call?.phase === "sailed" || call?.phase === "outbound";
  const leaving = call?.phase === "unberthing";
  const tone = sailed ? BAR.done : b.kind === "active" && isLoading ? "bg-moss text-white" : BAR[b.kind];
  const progress = b.kind === "active" && !sailed ? Math.max(0, Math.min(1, (now - b.start) / (b.end - b.start))) : 0;
  const arrived = b.vesselId === "orient-lotus" && sim.arrivalBerthed;
  const onClick = () => {
    if (b.vesselId) open({ kind: "vessel", id: b.vesselId });
    else toast(b.kind === "maintenance" ? `Berth ${b.berth}: ${b.label}` : b.kind === "done" ? `${b.label} has sailed from Berth ${b.berth}` : `${b.label} · Berth ${b.berth} · other carrier`);
  };
  return (
    <>
      {b.plannedStart !== undefined ? (
        <div className="absolute inset-y-[3px] rounded-[5px] border border-dashed border-harbor/50" style={{ left: pct(b.plannedStart), width: `calc(${pct(b.end - b.plannedStart)})` }} aria-hidden="true" />
      ) : null}
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => b.vesselId && setHovered({ kind: "vessel", id: b.vesselId })}
        onMouseLeave={() => setHovered(null)}
        title={`${b.label} · ${fmtClock(b.start * 3600)}–${fmtClock(b.end * 3600)}`}
        className={cn(
          "absolute inset-y-[3px] flex items-center overflow-hidden rounded-[5px] px-2 text-left text-[11px] font-bold uppercase tracking-wide transition-[filter,box-shadow] hover:brightness-105",
          tone,
          highlight && "ring-2 ring-ink/80 ring-offset-1 ring-offset-paper",
          arrived && "bg-signal",
        )}
        style={{ left: pct(b.start), width: `calc(${pct(b.end - b.start)} - 2px)` }}
      >
        {progress > 0 ? <span className="absolute inset-y-0 left-0 bg-black/15" style={{ width: `${progress * 100}%` }} aria-hidden="true" /> : null}
        <span className="relative truncate">
          {b.label}
          {sailed ? " · sailed" : leaving ? " · unberthing" : ""}
        </span>
      </button>
    </>
  );
}

interface BerthScheduleProps {
  focusBerth?: number;
  title?: string;
}

export function BerthSchedule(props: BerthScheduleProps) {
  const port = usePortSnapshot();
  return port.source === "live" ? <BerthBoard focusBerth={props.focusBerth} /> : <SimBerthSchedule {...props} />;
}

const BOARD_MAX_COLS = 6;

/** Fewest rows of at most six, balanced so the last row is never left mostly empty. */
const boardColumns = (count: number): number => (count <= 0 ? 1 : Math.ceil(count / Math.ceil(count / BOARD_MAX_COLS)));

/** Berths as they stand right now, for sources without a schedule. */
function BerthBoard({ focusBerth }: { focusBerth?: number }) {
  useSimTick();
  const port = usePortSnapshot();
  const { open, setHovered, selection } = usePort();
  const anchored = port.vessels.filter((v) => v.berth === 0);
  return (
    <Panel className="pointer-events-auto px-3.5 pb-3 pt-3 sm:px-4 lg:px-5" aria-label="Berths">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-[16px] font-bold text-ink">Berths now</h2>
        <p className="text-[12.5px] text-slate">
          {port.vessels.length - anchored.length} alongside · {anchored.length} at anchor
          {port.anchorage ? ` · ${port.anchorage.label}` : ""}
        </p>
        <Link to="/vessels" className="ml-auto flex items-center gap-1 text-[12.5px] font-semibold text-harbor hover:underline">
          All vessels <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {port.berths.length ? null : <p className="mt-2 text-[12.5px] text-slate">No berths yet. Waiting for nodes from the data source.</p>}
      <ul
        className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-[repeat(var(--cols),minmax(0,1fr))]"
        style={{ "--cols": boardColumns(port.berths.length) } as React.CSSProperties}
      >
        {port.berths.map(({ n: berth }) => {
          const v = port.vessels.find((x) => x.berth === berth);
          const crane = port.cranes.find((c) => c.berth === berth);
          const working = crane ? craneStatus(crane, 0).state === "active" : false;
          const selected = !!v && selection?.kind === "vessel" && selection.id === v.id;
          return (
            <li key={berth}>
              <button
                type="button"
                disabled={!v}
                onClick={() => v && open({ kind: "vessel", id: v.id })}
                onMouseEnter={() => v && setHovered({ kind: "vessel", id: v.id })}
                onMouseLeave={() => setHovered(null)}
                className={cn(
                  "flex w-full flex-col gap-1.5 rounded-[10px] border border-hairline px-3 py-2 text-left transition-colors hover:bg-sand/70 disabled:pointer-events-none",
                  (focusBerth === berth || selected) && "border-signal bg-signal-soft/50",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="text-[11.5px] font-semibold text-slate">Berth {berth}</span>
                  {v?.meta ? (
                    <StatusChip tone={v.meta.tone as Tone} className="ml-auto">
                      {working ? "Scheduling" : v.meta.headline}
                    </StatusChip>
                  ) : (
                    <span className="ml-auto text-[11.5px] text-slate">Empty</span>
                  )}
                </span>
                <span className="truncate font-mono text-[12.5px] font-semibold text-ink">{v?.name ?? "No vessel"}</span>
                {v?.meta ? <ProgressBar value={v.meta.fill} tone={v.meta.tone as Tone} live={working} height="h-1.5" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function SimBerthSchedule({ focusBerth, title = "Today's berth plan" }: BerthScheduleProps) {
  useSimTick();
  const now = simNowHours();
  const { selection } = usePort();
  const scrollRef = useRef<HTMLDivElement>(null);

  // On narrow screens the 24 h chart scrolls sideways: open it centred on the now-line.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const label = 56;
    el.scrollLeft = label + ((el.scrollWidth - label) * simNowHours()) / 24 - el.clientWidth / 2;
  }, []);

  return (
    <Panel className="pointer-events-auto px-3.5 pb-3 pt-3 sm:px-4 lg:px-5" aria-label="Berth plan">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-[16px] font-bold text-ink">{title}</h2>
        <p className="text-[12.5px] text-slate">Sunday, October 4, 2026</p>
        <div className="ml-auto flex items-center gap-4 text-[11.5px] text-slate">
          <span className="hidden items-center gap-1.5 md:flex"><i className="h-2 w-3 rounded-sm bg-signal" />Discharging</span>
          <span className="hidden items-center gap-1.5 md:flex"><i className="h-2 w-3 rounded-sm bg-moss" />Loading</span>
          <span className="hidden items-center gap-1.5 md:flex"><i className="h-2 w-3 rounded-sm bg-harbor" />Arriving</span>
          <span className="hidden items-center gap-1.5 md:flex"><i className="h-2 w-3 rounded-sm border border-harbor/30 bg-harbor-soft" />Planned</span>
          <Link to="/vessels" className="flex items-center gap-1 text-[12.5px] font-semibold text-harbor hover:underline">
            All vessels <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
      <div ref={scrollRef} className="scroll-thin mt-2 overflow-x-auto overscroll-x-contain pt-1">
        <div className="relative min-w-[820px]">
          <div className="relative ml-14 h-6">
            {HOURS.map((h) => (
              <span key={h} className="absolute top-1 -translate-x-1/2 font-mono text-[10.5px] text-slate tnum" style={{ left: pct(h) }}>
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          <div className="relative">
            {Array.from({ length: BERTH_COUNT }, (_, i) => i + 1).map((berth) => (
              <div key={berth} className={cn("flex h-[22px] items-stretch border-t border-hairline/70", focusBerth === berth && "bg-signal-soft/50")}>
                <div className={cn("sticky left-0 z-20 flex w-14 shrink-0 items-center bg-paper text-[12px] font-semibold", focusBerth === berth ? "text-[#B8441A]" : "text-ink")}>Berth {berth}</div>
                <div className="relative flex-1">
                  {HOURS.map((h) => (
                    <span key={h} className="absolute inset-y-0 w-px bg-hairline/60" style={{ left: pct(h) }} aria-hidden="true" />
                  ))}
                  {BERTH_SCHEDULE.filter((b) => b.berth === berth).map((b) => (
                    <Bar key={`${b.label}-${b.start}`} b={b} now={now} highlight={!!b.vesselId && selection?.kind === "vessel" && selection.id === b.vesselId} />
                  ))}
                </div>
              </div>
            ))}
            <div className="pointer-events-none absolute -top-1 bottom-0 left-14 right-0" aria-hidden="true">
              <div className="absolute bottom-0 top-0 w-[2px] -translate-x-1/2 bg-signal" style={{ left: pct(now) }}>
                <span className="absolute -top-6 left-1/2 -translate-x-1/2 rounded-full bg-signal px-2 py-0.5 font-mono text-[11px] font-bold text-white tnum shadow-panel">
                  {fmtClock(simNowSec())}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
