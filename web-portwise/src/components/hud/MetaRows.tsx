import type { EntityMeta } from "@/data/types";
import { DefRow } from "./primitives";

/** Key/value readout a data source attaches to an entity. */
export function MetaRows({ meta, className }: { meta: EntityMeta; className?: string }) {
  return (
    <dl className={className}>
      {meta.details.map((d, i) => (
        <DefRow key={`${d.label}-${i}`} label={d.label}>
          <span className="block truncate" title={d.value}>
            {d.value}
          </span>
        </DefRow>
      ))}
    </dl>
  );
}
