declare const uidBrand: unique symbol;

/** Kubernetes `metadata.uid`: the identity every reducer entry is keyed by. */
export type Uid = string & { readonly [uidBrand]: true };

export const asUid = (value: string): Uid => value as Uid;

export type PodPhase = "Pending" | "Running" | "Succeeded" | "Failed" | "Unknown";

export const POD_PHASES: readonly PodPhase[] = ["Running", "Pending", "Failed", "Succeeded", "Unknown"];

export const toPodPhase = (value: string | undefined): PodPhase => (POD_PHASES as readonly string[]).includes(value ?? "") ? (value as PodPhase) : "Unknown";

export type ConditionStatus = "True" | "False" | "Unknown";

export interface OwnerReference {
  kind: string;
  name: string;
  uid: string;
  controller?: boolean;
}

export interface ObjectMeta {
  uid: string;
  name: string;
  namespace?: string;
  resourceVersion?: string;
  creationTimestamp?: string;
  generation?: number;
  labels?: Record<string, string>;
  ownerReferences?: OwnerReference[];
}

export interface Condition {
  type: string;
  status: ConditionStatus;
  lastTransitionTime?: string;
  reason?: string;
  message?: string;
}

export interface K8sNode {
  kind?: "Node";
  metadata: ObjectMeta;
  spec?: { unschedulable?: boolean };
  status?: {
    allocatable?: Record<string, string>;
    capacity?: Record<string, string>;
    conditions?: Condition[];
    nodeInfo?: { kubeletVersion?: string; osImage?: string; architecture?: string };
  };
}

export interface ContainerStatus {
  name: string;
  image?: string;
  restartCount?: number;
  ready?: boolean;
  state?: { waiting?: { reason?: string }; terminated?: { reason?: string; exitCode?: number } };
}

export interface K8sPod {
  kind?: "Pod";
  metadata: ObjectMeta;
  spec?: { nodeName?: string; containers?: Array<{ name: string; image?: string }> };
  status?: {
    phase?: string;
    conditions?: Condition[];
    containerStatuses?: ContainerStatus[];
    initContainerStatuses?: ContainerStatus[];
    startTime?: string;
  };
}

export interface K8sNamespace {
  kind?: "Namespace";
  metadata: ObjectMeta;
  status?: { phase?: string };
}

export interface K8sService {
  kind?: "Service";
  metadata: ObjectMeta;
  spec?: { type?: string; clusterIP?: string; ports?: Array<{ port: number; protocol?: string; name?: string }> };
}

export interface K8sEvent {
  kind?: "Event";
  metadata: ObjectMeta;
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  lastTimestamp?: string | null;
  eventTime?: string | null;
  firstTimestamp?: string | null;
  involvedObject?: { kind?: string; name?: string; namespace?: string; uid?: string };
}

interface PodTemplate {
  spec?: { containers?: Array<{ name: string; image?: string }> };
}

export interface ReplicaStatus {
  replicas?: number;
  readyReplicas?: number;
  updatedReplicas?: number;
  availableReplicas?: number;
  observedGeneration?: number;
  conditions?: Condition[];
}

export interface K8sDeployment {
  kind?: "Deployment";
  metadata: ObjectMeta;
  spec?: { replicas?: number; template?: PodTemplate };
  status?: ReplicaStatus;
}

export interface K8sStatefulSet {
  kind?: "StatefulSet";
  metadata: ObjectMeta;
  spec?: { replicas?: number; template?: PodTemplate };
  status?: ReplicaStatus;
}

export interface K8sReplicaSet {
  kind?: "ReplicaSet";
  metadata: ObjectMeta;
  spec?: { replicas?: number; template?: PodTemplate };
  status?: ReplicaStatus;
}

export interface K8sDaemonSet {
  kind?: "DaemonSet";
  metadata: ObjectMeta;
  spec?: { template?: PodTemplate };
  status?: {
    desiredNumberScheduled?: number;
    numberReady?: number;
    updatedNumberScheduled?: number;
    numberAvailable?: number;
    observedGeneration?: number;
    conditions?: Condition[];
  };
}

export interface K8sJob {
  kind?: "Job";
  metadata: ObjectMeta;
  spec?: { completions?: number; parallelism?: number; template?: PodTemplate };
  status?: { active?: number; succeeded?: number; failed?: number; startTime?: string; completionTime?: string; conditions?: Condition[] };
}

export interface ResourceObjects {
  nodes: K8sNode;
  pods: K8sPod;
  namespaces: K8sNamespace;
  services: K8sService;
  events: K8sEvent;
  deployments: K8sDeployment;
  statefulsets: K8sStatefulSet;
  daemonsets: K8sDaemonSet;
  replicasets: K8sReplicaSet;
  jobs: K8sJob;
}

export type ResourceKey = keyof ResourceObjects;

export const RESOURCE_KEYS: readonly ResourceKey[] = ["nodes", "pods", "namespaces", "services", "events", "deployments", "statefulsets", "daemonsets", "replicasets", "jobs"];

export type WatchEventType = "ADDED" | "MODIFIED" | "DELETED" | "BOOKMARK" | "ERROR";

export interface WatchEvent<T> {
  type: WatchEventType;
  object: T;
}

export interface ListResponse<T> {
  items: T[];
  metadata: { resourceVersion?: string; continue?: string };
}
