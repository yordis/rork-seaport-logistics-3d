import type { BlockCategory, Severity, StatusTone, VesselStatus } from "@/data/types";
import { CONTAINER_COLORS } from "@/data/layout";
import type { PortVocabulary } from "../model";
import type { PodPhase } from "./types";

export interface PhaseStyle {
  label: string;
  color: string;
  tone: StatusTone;
}

export interface NodeStateStyle {
  headline: string;
  tone: StatusTone;
  status: VesselStatus;
}

/** Observable rollout milestones a shipment step can be tied to. */
export type RolloutSignal = "rolloutStarted" | "podScheduled" | "podInitialized" | "containersReady" | "settled";

export interface ShipmentStepRule {
  label: string;
  signal: RolloutSignal;
}

export type WorkloadResource = "deployments" | "statefulsets" | "daemonsets" | "replicasets" | "jobs";

export interface CategoryRule {
  pattern: RegExp;
  category: BlockCategory;
}

/**
 * The single place that decides how a Kubernetes cluster reads as a port. Everything here is data:
 * the projector applies it, the 3D scene and HUD only ever see the resulting port model.
 */
export const K8S_PORT_MAPPING = {
  ids: { vessel: "node-", crane: "QC-" },
  berths: {
    /** Share of a berth's length a hull may take, so compressed berths keep a gap between ships. */
    vesselShare: 0.88,
    cranesPerBerth: 1,
  },
  vessel: {
    line: "Cluster node",
    /** Allocatable CPU (cores) sets the hull length; nodes without it fall back to pod capacity. */
    cpuRange: { min: 2, max: 32 },
    podsRange: { min: 10, max: 250 },
    length: { min: 28, max: 44 },
    hulls: ["#1E3A66", "#2F5D4E", "#B5463A", "#2C6FB0", "#4F6D8F", "#8A3B34"],
    ready: { headline: "Ready", tone: "moss", status: "loading" } satisfies NodeStateStyle,
    cordoned: { headline: "Cordoned", tone: "amber", status: "loading" } satisfies NodeStateStyle,
    notReady: { headline: "Not ready", tone: "brick", status: "scheduled" } satisfies NodeStateStyle,
    roleLabelPrefix: "node-role.kubernetes.io/",
  },
  pod: {
    phases: {
      Running: { label: "Running", color: CONTAINER_COLORS.moss, tone: "moss" },
      Pending: { label: "Pending", color: CONTAINER_COLORS.sand, tone: "amber" },
      Failed: { label: "Failed", color: CONTAINER_COLORS.brick, tone: "brick" },
      Succeeded: { label: "Succeeded", color: CONTAINER_COLORS.steel, tone: "harbor" },
      Unknown: { label: "Unknown", color: "#8C8A84", tone: "slate" },
    } satisfies Record<PodPhase, PhaseStyle>,
    /** Pods in these phases, or with no node yet, wait at the anchorage. */
    waitingPhases: ["Pending"] as readonly PodPhase[],
    size: "Pod",
  },
  yard: {
    blocks: 40,
    /** Pods a block holds at 100% fill. */
    capacity: 48,
    defaultCategory: "import" as BlockCategory,
    categoryRules: [{ pattern: /^kube-|-system$/, category: "reefer" }] satisfies CategoryRule[],
    overflowLabel: "Other namespaces",
  },
  anchorage: { noun: "pods waiting", tone: "amber" as StatusTone },
  crane: {
    /** A crane keeps working for about two lift cycles after the latest scheduling move. */
    activeWindowMs: 26_000,
    model: "Scheduler",
    operator: "kube-scheduler",
    idleReason: "No recent scheduling",
    emptyReason: "Berth empty",
  },
  shipments: {
    /** Workload kinds that become shipments, with the label prefix and consignee each one reads as. */
    kinds: {
      deployments: { label: "deployment", consignee: "Deployment", settledStep: "Rolled out", activeHeadline: "Rolling out" },
      statefulsets: { label: "statefulset", consignee: "StatefulSet", settledStep: "Rolled out", activeHeadline: "Rolling out" },
      daemonsets: { label: "daemonset", consignee: "DaemonSet", settledStep: "Rolled out", activeHeadline: "Rolling out" },
      replicasets: { label: "replicaset", consignee: "ReplicaSet", settledStep: "Rolled out", activeHeadline: "Rolling out" },
      jobs: { label: "job", consignee: "Job", settledStep: "Completed", activeHeadline: "Running" },
    } satisfies Record<WorkloadResource, { label: string; consignee: string; settledStep: string; activeHeadline: string }>,
    /** Steps in order; a step is reached once its signal has been observed. */
    steps: [
      { label: "Created", signal: "rolloutStarted" },
      { label: "Scheduled", signal: "podScheduled" },
      { label: "Initialized", signal: "podInitialized" },
      { label: "Containers ready", signal: "containersReady" },
      { label: "Rolled out", signal: "settled" },
    ] satisfies ShipmentStepRule[],
    /** Pod conditions whose earliest True transition marks each pod-level signal. */
    podConditions: { podScheduled: "PodScheduled", podInitialized: "Initialized", containersReady: "ContainersReady" } as Record<Exclude<RolloutSignal, "rolloutStarted" | "settled">, string>,
    /** Container waiting reasons that put a shipment on hold. */
    holdWaitingReasons: ["CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "CreateContainerConfigError", "InvalidImageName"] as readonly string[],
    stalledCondition: { type: "Progressing", status: "False", fallbackReason: "Rollout stalled" },
    failedCondition: { type: "Failed", status: "True", fallbackReason: "Job failed" },
    completeCondition: { type: "Complete", status: "True" },
    holdSeverity: "danger" as Severity,
    direction: { inProgress: "export", settled: "import" } as const,
    states: {
      inProgress: { tone: "signal" as StatusTone },
      settled: { tone: "moss" as StatusTone },
      held: { tone: "brick" as StatusTone },
    },
  },
  vocabulary: {
    vessel: "Node",
    container: "Pod",
    shipment: "Workload",
    shipments: "Rollouts",
    journey: "Rollout progress",
    search: "Search nodes, pods, workloads…",
  } satisfies PortVocabulary,
  alerts: {
    max: 25,
    defaultSeverity: "warning" as Severity,
    severityByReason: { FailedScheduling: "danger", BackOff: "danger", OOMKilling: "danger", NodeNotReady: "danger", Evicted: "danger" } as Record<string, Severity>,
  },
} as const;

export type K8sPortMapping = typeof K8S_PORT_MAPPING;
