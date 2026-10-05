import { cn } from "@/lib/utils";
import type { ConnectionStatus, SourceKind } from "@/source/model";
import { dataSource, useConnectionStatus, useDataSource } from "@/source/store";

const OPTIONS: Array<{ kind: SourceKind; label: string; short: string }> = [
  { kind: "simulation", label: "Simulation", short: "Sim" },
  { kind: "live", label: "Live cluster", short: "Live" },
];

const STATUS: Record<ConnectionStatus["kind"], { dot: string; label: string }> = {
  idle: { dot: "bg-slate", label: "Idle" },
  connecting: { dot: "bg-amber pw-blink", label: "Connecting" },
  live: { dot: "bg-moss", label: "Connected" },
  error: { dot: "bg-brick", label: "Error" },
  disconnected: { dot: "bg-brick", label: "Disconnected" },
};

const describe = (status: ConnectionStatus): string => {
  const s = STATUS[status.kind].label;
  return "message" in status ? `${s}: ${status.message}` : `Live cluster: ${s.toLowerCase()}`;
};

/** Switches the port between the built-in simulation and a live Kubernetes cluster; the live segment carries the connection state. */
export function SourceToggle() {
  const source = useDataSource();
  const status = useConnectionStatus();
  return (
    <div role="radiogroup" aria-label="Data source" className="flex shrink-0 items-center gap-0.5 rounded-full border border-hairline bg-canvas/60 p-0.5">
      {OPTIONS.map((o) => {
        const live = o.kind === "live" && source === "live";
        const title = live ? describe(status) : o.label;
        return (
          <button
            key={o.kind}
            type="button"
            role="radio"
            aria-checked={source === o.kind}
            aria-label={title}
            title={title}
            onClick={() => dataSource.set(o.kind)}
            className={cn(
              "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold transition-colors",
              source === o.kind ? "bg-ink text-paper" : "text-ink/75 hover:bg-sand hover:text-ink",
            )}
          >
            {live ? <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", STATUS[status.kind].dot)} /> : null}
            <span className="min-[1800px]:hidden">{o.short}</span>
            <span className="hidden min-[1800px]:inline">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
