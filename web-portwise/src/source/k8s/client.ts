import type { ListResponse, ResourceKey, ResourceObjects, WatchEvent } from "./types";

export const API_BASE: string = (import.meta.env.VITE_K8S_API_BASE as string | undefined) || "/k8s";

const PATHS: Record<ResourceKey, { path: string; query?: string }> = {
  nodes: { path: "/api/v1/nodes" },
  pods: { path: "/api/v1/pods" },
  namespaces: { path: "/api/v1/namespaces" },
  services: { path: "/api/v1/services" },
  events: { path: "/api/v1/events", query: "fieldSelector=type%3DWarning" },
  deployments: { path: "/apis/apps/v1/deployments" },
  statefulsets: { path: "/apis/apps/v1/statefulsets" },
  daemonsets: { path: "/apis/apps/v1/daemonsets" },
  replicasets: { path: "/apis/apps/v1/replicasets" },
  jobs: { path: "/apis/batch/v1/jobs" },
};

const PAGE_SIZE = 500;

/** Browsers cap HTTP/1.1 at six connections per host, so only high-churn resources hold a watch open; the rest relist on an interval. */
export const STREAMED: ReadonlySet<ResourceKey> = new Set<ResourceKey>(["pods", "events", "deployments"]);
export const RELIST_INTERVAL_MS = 10_000;

export class GoneError extends Error {
  constructor() {
    super("resourceVersion too old");
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function url(resource: ResourceKey, params: Record<string, string>): string {
  const { path, query } = PATHS[resource];
  const qs = [query, new URLSearchParams(params).toString()].filter(Boolean).join("&");
  return `${API_BASE}${path}${qs ? `?${qs}` : ""}`;
}

async function get(href: string, signal: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(href, { method: "GET", headers: { Accept: "application/json" }, signal });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new ApiError(`Cannot reach the cluster API at ${API_BASE}. Start kubectl proxy (bun run k8s:proxy).`, 0);
  }
  if (res.status === 410) throw new GoneError();
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    throw new ApiError(`Cluster API at ${API_BASE} is unavailable (HTTP ${res.status}). Start kubectl proxy (bun run k8s:proxy).`, res.status);
  }
  if (!res.ok) throw new ApiError(`Cluster API returned HTTP ${res.status} for ${resourceOf(href)}`, res.status);
  return res;
}

const resourceOf = (href: string): string => href.split("?")[0].replace(API_BASE, "");

export interface ListResult<K extends ResourceKey> {
  items: ResourceObjects[K][];
  resourceVersion: string | null;
}

/** Lists every page, returning the items and the resourceVersion a watch should resume from. */
export async function listResource<K extends ResourceKey>(resource: K, signal: AbortSignal): Promise<ListResult<K>> {
  const items: ResourceObjects[K][] = [];
  let cont = "";
  let resourceVersion: string | null = null;
  do {
    const res = await get(url(resource, { limit: String(PAGE_SIZE), ...(cont ? { continue: cont } : {}) }), signal);
    const body = (await res.json()) as ListResponse<ResourceObjects[K]>;
    items.push(...(body.items ?? []));
    resourceVersion = body.metadata?.resourceVersion ?? resourceVersion;
    cont = body.metadata?.continue ?? "";
  } while (cont);
  return { items, resourceVersion };
}

interface ErrorStatus {
  code?: number;
  message?: string;
}

/** Streams NDJSON watch events until the server closes the stream. Throws GoneError on 410. */
export async function watchResource<K extends ResourceKey>(
  resource: K,
  resourceVersion: string | null,
  signal: AbortSignal,
  onEvent: (event: WatchEvent<ResourceObjects[K]>) => void,
): Promise<void> {
  const params: Record<string, string> = { watch: "1", allowWatchBookmarks: "true" };
  if (resourceVersion) params.resourceVersion = resourceVersion;
  const res = await get(url(resource, params), signal);
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) dispatchLine(line, onEvent);
        nl = buffer.indexOf("\n");
      }
    }
    if (buffer.trim()) dispatchLine(buffer.trim(), onEvent);
  } finally {
    reader.releaseLock();
  }
}

function dispatchLine<T>(line: string, onEvent: (event: WatchEvent<T>) => void): void {
  const event = JSON.parse(line) as WatchEvent<T>;
  if (event.type === "ERROR") {
    const status = event.object as unknown as ErrorStatus;
    if (status?.code === 410) throw new GoneError();
    throw new ApiError(status?.message ?? "Watch error", status?.code ?? 0);
  }
  onEvent(event);
}
