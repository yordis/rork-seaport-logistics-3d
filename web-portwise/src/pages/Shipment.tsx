import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowRight, Check, ChevronDown, Container as ContainerIcon, MapPin } from "lucide-react";
import { HudLayout } from "@/components/hud/HudLayout";
import { MetaRows } from "@/components/hud/MetaRows";
import { Panel, StatusChip } from "@/components/hud/primitives";
import { truckStatusTone } from "@/components/hud/TruckCard";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GATE_TRUCK_IDS, truckById } from "@/data/port";
import { FEATURED_SHIPMENT_IDS, shipmentById } from "@/data/containers";
import type { Shipment as ShipmentT } from "@/data/types";
import type { PortSnapshot } from "@/source/model";
import { findContainer, findShipment, findVessel, useConnectionStatus, usePortSnapshot } from "@/source/store";
import { cn } from "@/lib/utils";
import { sim, simElapsedMin, useSimTick } from "@/sim/simStore";
import { usePort } from "@/state/PortProvider";

function GateTable() {
  useSimTick();
  const { open, selection } = usePort();
  return (
    <Panel className="w-full p-4" aria-label="Gate traffic">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-bold text-ink">Gate traffic</h2>
        <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-moss">
          <span className="h-1.5 w-1.5 rounded-full bg-moss pw-blink" />
          Live
        </span>
      </div>
      <table className="mt-2 w-full text-left text-[12.5px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-wider text-slate">
            <th className="py-1.5 font-semibold">Plate</th>
            <th className="py-1.5 font-semibold">Haulier</th>
            <th className="py-1.5 font-semibold">Gate</th>
            <th className="whitespace-nowrap py-1.5 font-semibold">Status</th>
            <th className="py-1.5 text-right font-semibold">Time</th>
          </tr>
        </thead>
        <tbody>
          {GATE_TRUCK_IDS.map((id) => {
            const t = truckById(id);
            if (!t) return null;
            const status = sim.truckStatus[id] ?? "—";
            const minutes = Math.max(0, Math.round((t.baseWait ?? 1) + simElapsedMin()));
            const active = selection?.kind === "truck" && selection.id === id;
            return (
              <tr
                key={id}
                tabIndex={0}
                onClick={() => open({ kind: "truck", id })}
                onKeyDown={(e) => e.key === "Enter" && open({ kind: "truck", id })}
                className={cn("cursor-pointer border-t border-hairline/70 transition-colors hover:bg-sand/60", active && "bg-signal-soft/60")}
              >
                <td className="whitespace-nowrap py-2 pr-2 font-mono font-bold text-ink">{t.plate}</td>
                <td className="max-w-[84px] truncate py-2 pr-2 text-ink">{t.carrier}</td>
                <td className="py-2 text-slate">{t.gate?.replace("Gate ", "")}</td>
                <td className="py-2">
                  <StatusChip tone={truckStatusTone(status)} dot={false}>
                    {status}
                  </StatusChip>
                </td>
                <td className="py-2 text-right font-mono text-slate tnum">{minutes}′</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

const SIM_DEFAULT_SHIPMENT = "SHP-20931";

const isActive = (s: ShipmentT): boolean => !!s.hold || s.current < s.steps.length;

const norm = (v: string): string => v.toLowerCase();

/** Groups the source's shipments for the picker: active or held first, then one group per destination, keeping source order. */
function pickerGroups(list: ShipmentT[], query: string): Array<{ heading: string; items: ShipmentT[] }> {
  const q = norm(query.trim());
  const hits = q ? list.filter((s) => norm(s.label ?? s.id).includes(q) || norm(s.destination).includes(q)) : list;
  const active = hits.filter(isActive);
  const byDestination = new Map<string, ShipmentT[]>();
  hits.filter((s) => !isActive(s)).forEach((s) => byDestination.set(s.destination, [...(byDestination.get(s.destination) ?? []), s]));
  return [...(active.length ? [{ heading: "In progress", items: active }] : []), ...Array.from(byDestination, ([heading, items]) => ({ heading, items }))];
}

function ShipmentPicker({ port, s }: { port: PortSnapshot; s: ShipmentT }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const groups = useMemo(() => pickerGroups(port.shipments ?? [], query), [port.shipments, query]);
  const pick = (id: string) => {
    setOpen(false);
    setQuery("");
    navigate(`/shipments/${id}`);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex min-w-0 items-center gap-1.5 rounded-md font-mono text-[17px] font-bold text-ink hover:text-signal" title={s.label}>
        <span className="truncate">{s.label ?? s.id}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-24px))] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Filter by name or namespace" value={query} onValueChange={setQuery} />
          <CommandList className="scroll-thin max-h-[min(360px,50dvh)] overscroll-contain">
            <CommandEmpty>No matches for “{query}”.</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.heading} heading={g.heading}>
                {g.items.map((item) => (
                  <CommandItem key={item.id} value={item.id} onSelect={() => pick(item.id)} className={cn("flex items-center gap-2", item.id === s.id && "bg-signal-soft/60")}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12.5px] font-semibold text-ink">{item.label ?? item.id}</span>
                      <span className="block truncate text-[11.5px] text-slate">
                        {isActive(item) ? `${item.destination} · ${item.sizeLabel}` : item.sizeLabel}
                      </span>
                    </span>
                    {item.meta && isActive(item) ? (
                      <StatusChip tone={item.meta.tone} pulse className="max-w-[120px] shrink-0">
                        <span className="truncate">{item.meta.headline}</span>
                      </StatusChip>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ShipmentFacts({ s, port }: { s: ShipmentT; port: PortSnapshot }) {
  if (!s.meta) return null;
  return (
    <Panel className="w-full shrink-0 p-4" aria-label={`${port.vocabulary.shipment} ${s.label ?? s.id}`}>
      <p className="eyebrow">{s.consignee}</p>
      <h2 className="mt-0.5 break-all font-mono text-[15px] font-bold text-ink">{s.label ?? s.id}</h2>
      {s.hold ? (
        <p className="mt-2 flex items-center gap-2 rounded-[10px] bg-brick-soft px-3 py-2 text-[12.5px] font-semibold text-brick">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          On hold · {s.hold.reason}
        </p>
      ) : null}
      <MetaRows meta={s.meta} className="mt-2" />
    </Panel>
  );
}

function Journey({ s, port }: { s: ShipmentT; port: PortSnapshot }) {
  const navigate = useNavigate();
  const vessel = findVessel(s.vesselId);
  const container = findContainer(s.containerIds[0]);
  const done = s.current >= s.steps.length && !s.hold;
  const tracked = !!s.meta;
  return (
    <Panel className="flex flex-col gap-4 px-4 py-4 lg:flex-row lg:items-stretch lg:px-6" aria-label={port.vocabulary.journey}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-[17px] font-bold text-ink">{port.vocabulary.journey}</h1>
          <p className="text-[12.5px] text-slate">
            {port.shipments ? (
              <span className="font-mono text-[11.5px] tnum">
                {port.shipments.filter(isActive).length} active · {port.shipments.length} total
              </span>
            ) : (
              <>{s.direction === "import" ? "Import" : "Export"} · live progress through the terminal</>
            )}
          </p>
        </div>
        <div className="scroll-thin sm:overflow-x-auto">
          {/* Phones: vertical stepper. Wider: horizontal 6-step track. */}
          <ol
            className="relative mt-4 grid grid-cols-1 gap-3 sm:mt-5 sm:min-w-[620px] sm:grid-cols-[repeat(var(--steps),minmax(0,1fr))] sm:gap-0"
            style={{ "--steps": s.steps.length } as React.CSSProperties}
          >
            {s.steps.map((step, i) => {
              const state = i < s.current ? "done" : i === s.current ? "current" : "todo";
              return (
                <li key={step.label} className="relative flex items-center gap-3 sm:flex-col sm:gap-0 sm:text-center">
                  {i < s.steps.length - 1 ? (
                    <span
                      className={cn("absolute left-[16.5px] top-[18px] h-[calc(100%+12px)] w-[3px] sm:left-1/2 sm:top-[17px] sm:h-[3px] sm:w-full", i < s.current ? "bg-ink" : "bg-hairline")}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span
                    className={cn(
                      "relative z-10 grid h-9 w-9 place-items-center rounded-full border-[3px] font-mono text-[13px] font-bold",
                      state === "done" && "border-ink bg-ink text-paper",
                      state === "current" && "pw-pulse border-signal bg-paper text-signal",
                      state === "todo" && "border-hairline bg-paper text-slate",
                    )}
                    aria-current={state === "current" ? "step" : undefined}
                  >
                    {state === "done" ? <Check className="h-4 w-4" strokeWidth={3} /> : state === "current" ? <span className="h-3 w-3 rounded-full bg-signal" /> : i + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2 sm:flex-col sm:items-center sm:gap-0">
                    <span className={cn("text-[13.5px] font-semibold sm:mt-2", state === "todo" ? "text-slate" : "text-ink")}>{step.label}</span>
                    <span className={cn("font-mono text-[12px] tnum", state === "current" ? "text-signal" : "text-slate")}>{step.time}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <div className="shrink-0 border-t border-hairline pt-4 lg:w-[320px] lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <div className="flex items-center justify-between gap-2">
          {port.shipments ? (
            <ShipmentPicker port={port} s={s} />
          ) : (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-md font-mono text-[20px] font-bold text-ink hover:text-signal">
              #{s.id}
              <ChevronDown className="h-4 w-4 text-slate" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {FEATURED_SHIPMENT_IDS.map((id) => (
                <DropdownMenuItem key={id} onSelect={() => navigate(`/shipments/${id}`)} className="flex justify-between">
                  <span className="font-mono font-semibold">#{id}</span>
                  <span className="truncate pl-2 text-xs text-slate">{shipmentById(id)?.destination}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          )}
          {s.meta ? (
            <StatusChip tone={s.meta.tone} pulse={!done} className="max-w-[150px] shrink-0">
              <span className="truncate">{s.meta.headline}</span>
            </StatusChip>
          ) : (
            <StatusChip tone={done ? "moss" : "signal"} pulse={!done}>
              {done ? "Completed" : "In progress"}
            </StatusChip>
          )}
        </div>
        <p className="mt-2 flex items-start gap-2 text-[13px] text-ink">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-harbor" />
          {tracked ? "Namespace" : s.direction === "import" ? "Deliver to" : "Bound for"}: {s.destination}
        </p>
        <p className="mt-1 pl-6 text-[12px] text-slate">{s.consignee}</p>
        <div className="mt-3 flex items-center gap-3 border-t border-hairline pt-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-sand text-ink">
            <ContainerIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 text-[12.5px]">
            <p className="font-semibold text-ink">{s.sizeLabel}</p>
            <p className="truncate text-slate">
              {[s.cargo, vessel?.short].filter(Boolean).join(" · ")}
            </p>
          </div>
          {container ? (
            <Link to={`/yard/${container.blockId}?c=${container.id}`} className="flex items-center gap-1 text-[12px] font-semibold text-harbor hover:underline">
              {container.position} <ArrowRight className="h-3 w-3" />
            </Link>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function WaitingForShipments() {
  const { vocabulary } = usePortSnapshot();
  return (
    <HudLayout
      bottom={
        <Panel className="w-full px-5 py-4" aria-label={vocabulary.shipments}>
          <h1 className="text-[16px] font-bold text-ink">{vocabulary.shipments}</h1>
          <p className="mt-1 text-[13px] text-slate">Waiting for workloads from the data source.</p>
        </Panel>
      }
    />
  );
}

/** Where /shipments lands: the source's first shipment, or the featured simulated one. */
export function ShipmentsIndex() {
  const port = usePortSnapshot();
  if (!port.shipments) return <Navigate to={`/shipments/${SIM_DEFAULT_SHIPMENT}`} replace />;
  const first = port.shipments[0];
  return first ? <Navigate to={`/shipments/${first.id}`} replace /> : <WaitingForShipments />;
}

export default function Shipment() {
  const { id = "" } = useParams();
  const port = usePortSnapshot();
  const status = useConnectionStatus();
  const s = findShipment(id, port);
  const { setPageSelection, setView } = usePort();

  useEffect(() => {
    setView("gate");
    if (s) setPageSelection({ kind: "shipment", id: s.id });
  }, [s, setPageSelection, setView]);

  if (!s) {
    if (!port.shipments) return <Navigate to={`/shipments/${SIM_DEFAULT_SHIPMENT}`} replace />;
    if (status.kind !== "live") return <WaitingForShipments />;
    return <Navigate to="/shipments" replace />;
  }
  const right = port.shipments ? <ShipmentFacts s={s} port={port} /> : <GateTable />;
  return <HudLayout right={right} bottom={<Journey s={s} port={port} />} sheetOrder={["bottom", "right"]} />;
}
