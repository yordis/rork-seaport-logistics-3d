import { useMemo, useState } from "react";
import { Boxes, Container as ContainerIcon, Package, Ship, Truck } from "lucide-react";
import { FACILITIES } from "@/data/facilities";
import { FacilityIcon } from "./FacilityIcon";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { TRUCKS } from "@/data/port";
import { FEATURED_SHIPMENT_IDS, shipmentById } from "@/data/containers";
import { findShipment, usePortSnapshot } from "@/source/store";
import type { Selection } from "@/data/types";
import { usePort } from "@/state/PortProvider";
import { CraneGlyph } from "./primitives";

const norm = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[\s.\-#]/g, "");

export function SearchDialog() {
  const { searchOpen, setSearchOpen, open } = usePort();
  const [q, setQ] = useState<string>("");
  const nq = norm(q);
  const port = usePortSnapshot();

  const results = useMemo(() => {
    const has = (s: string) => nq.length === 0 || norm(s).includes(nq);
    const containers =
      nq.length >= 2
        ? port.containers.filter((c) => norm(c.id).includes(nq) || norm(c.code).includes(nq) || norm(c.position).includes(nq)).slice(0, 8)
        : port.containers.filter((c) => c.shipmentId === "SHP-20931");
    const shipmentIds = new Set<string>();
    if (port.shipments) {
      port.shipments.filter((s) => has(s.id) || has(s.label ?? "") || has(s.destination)).slice(0, 8).forEach((s) => shipmentIds.add(s.id));
    } else {
      FEATURED_SHIPMENT_IDS.filter((id) => has(id)).forEach((id) => shipmentIds.add(id));
      const m = /(\d{5})/.exec(q);
      if (m && shipmentById(`SHP-${m[1]}`)) shipmentIds.add(`SHP-${m[1]}`);
    }
    return {
      vessels: port.vessels.filter((v) => has(v.name) || has(v.imo) || has(v.line)),
      cranes: port.cranes.filter((c) => has(c.id)),
      trucks: TRUCKS.filter((t) => has(t.plate) || has(t.carrier)),
      blocks: port.blocks.filter((b) => has(`block ${b.id}`) || has(b.id) || (!!b.meta && has(b.meta.headline))),
      facilities: nq.length >= 2 && port.logistics ? FACILITIES.filter((f) => has(f.name) || has(f.short) || has(f.operator) || has(f.group)) : [],
      containers,
      shipments: Array.from(shipmentIds),
    };
  }, [nq, q, port]);

  const go = (sel: Selection) => {
    setSearchOpen(false);
    setQ("");
    open(sel);
  };

  return (
    <CommandDialog open={searchOpen} onOpenChange={setSearchOpen} shouldFilter={false}>
      <CommandInput placeholder={port.vocabulary.search} value={q} onValueChange={setQ} />
      <CommandList className="max-h-[min(420px,calc(100dvh-140px))] overscroll-contain">
        <CommandEmpty>No results for “{q}”.</CommandEmpty>
        {results.vessels.length ? (
          <CommandGroup heading={`${port.vocabulary.vessel}s`}>
            {results.vessels.map((v) => (
              <CommandItem key={v.id} value={`vessel-${v.id}`} onSelect={() => go({ kind: "vessel", id: v.id })}>
                <Ship className="mr-2 h-4 w-4 text-slate" />
                <span className="font-semibold">{v.name}</span>
                <span className="ml-auto text-xs text-slate">{v.meta ? `${v.berth ? `Berth ${v.berth}` : "Anchorage"} · ${v.meta.headline}` : `Berth ${v.berth} · ETA ${v.eta}`}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {results.facilities.length ? (
          <CommandGroup heading="Logistics sites">
            {results.facilities.map((f) => (
              <CommandItem key={f.id} value={`facility-${f.id}`} onSelect={() => go({ kind: "facility", id: f.id })}>
                <FacilityIcon kind={f.kind} className="mr-2 h-4 w-4 text-slate" />
                <span className="font-semibold">{f.name}</span>
                <span className="ml-auto text-xs text-slate">{f.group}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {results.containers.length ? (
          <CommandGroup heading={`${port.vocabulary.container}s`}>
            {results.containers.map((c) => (
              <CommandItem key={c.id} value={`container-${c.id}`} onSelect={() => go({ kind: "container", id: c.id })}>
                <ContainerIcon className="mr-2 h-4 w-4 text-slate" />
                <span className="font-mono font-semibold">{c.code}</span>
                <span className="ml-auto font-mono text-xs text-slate">{c.position}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {results.shipments.length ? (
          <CommandGroup heading={port.vocabulary.shipments}>
            {results.shipments.map((id) => {
              const s = findShipment(id, port);
              return (
                <CommandItem key={id} value={`shipment-${id}`} onSelect={() => go({ kind: "shipment", id })}>
                  <Package className="mr-2 h-4 w-4 text-slate" />
                  <span className="truncate font-mono font-semibold">{s?.label ?? `#${id}`}</span>
                  <span className="ml-auto truncate text-xs text-slate">{s?.destination}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
        {results.trucks.length ? (
          <CommandGroup heading="Trucks">
            {results.trucks.map((t) => (
              <CommandItem key={t.id} value={`truck-${t.id}`} onSelect={() => go({ kind: "truck", id: t.id })}>
                <Truck className="mr-2 h-4 w-4 text-slate" />
                <span className="font-mono font-semibold">{t.plate}</span>
                <span className="ml-auto text-xs text-slate">{t.carrier}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {results.cranes.length ? (
          <CommandGroup heading="Quay cranes">
            {results.cranes.map((c) => (
              <CommandItem key={c.id} value={`crane-${c.id}`} onSelect={() => go({ kind: "crane", id: c.id })}>
                <CraneGlyph className="mr-2 h-4 w-4 text-slate" />
                <span className="font-mono font-semibold">{c.id}</span>
                <span className="ml-auto text-xs text-slate">Berth {c.berth}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {results.blocks.length ? (
          <CommandGroup heading="Yard blocks">
            {results.blocks.map((b) => (
              <CommandItem key={b.id} value={`block-${b.id}`} onSelect={() => go({ kind: "block", id: b.id })}>
                <Boxes className="mr-2 h-4 w-4 text-slate" />
                <span className="font-semibold">Block {b.id}{b.meta ? ` · ${b.meta.headline}` : ""}</span>
                <span className="ml-auto font-mono text-xs text-slate">{Math.round(b.fill * 100)}%</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
