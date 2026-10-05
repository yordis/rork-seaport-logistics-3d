const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const chunks = (s: string): string[] => s.match(/\d+|\D+/g) ?? [];

/** Orders digit runs by value, so ids like "A2" sort before "A10". */
export function naturalCompare(a: string, b: string): number {
  const x = chunks(a);
  const y = chunks(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const numeric = /^\d/.test(x[i]) && /^\d/.test(y[i]);
    const c = numeric ? Number(x[i]) - Number(y[i]) : byName(x[i], y[i]);
    if (c !== 0) return c;
  }
  return x.length - y.length || byName(a, b);
}

/** One berth per name, numbered from 1 in sorted order, so the same set always lands on the same berths regardless of arrival order. */
export function assignBerths(names: Iterable<string>): ReadonlyMap<string, number> {
  return new Map([...new Set(names)].sort(byName).map((n, i) => [n, i + 1]));
}

export interface SlotAssignment {
  slots: ReadonlyMap<string, string>;
  overflow: readonly string[];
}

/**
 * The busiest groups (ties broken by name) win a slot; winners are then laid out by name so a group keeps
 * its slot while the winning set is unchanged.
 */
export function assignSlots(counts: ReadonlyMap<string, number>, slotIds: readonly string[]): SlotAssignment {
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || byName(a[0], b[0])).map(([name]) => name);
  const winners = ranked.slice(0, slotIds.length).sort(byName);
  return {
    slots: new Map(winners.map((n, i) => [n, slotIds[i]])),
    overflow: ranked.slice(slotIds.length).sort(byName),
  };
}

/** FNV-1a, for picking stable per-name styling. */
export function stableHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
