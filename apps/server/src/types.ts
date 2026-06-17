export type ResourceKind =
  | "Namespace"
  | "Deployment"
  | "ReplicaSet"
  | "Pod"
  | "Service"
  | "Ingress"
  | "ConfigMap"
  | "Secret"
  | "HorizontalPodAutoscaler";

export type EdgeType =
  | "owns"
  | "selects"
  | "exposes"
  | "scales"
  | "references"
  | "ingress-routes-to";

export interface ManagedFieldSummary {
  manager: string;
  operation?: string;
  time?: string;
  fields: string[];
}

export interface ResourceNode {
  id: string;
  kind: ResourceKind;
  apiVersion: string;
  name: string;
  namespace: string | null;
  uid?: string;
  createdAt?: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  ownerReferences: Array<{
    apiVersion?: string;
    kind?: string;
    name?: string;
    uid?: string;
    controller?: boolean;
  }>;
  managers: ManagedFieldSummary[];
  relations: Array<{
    type: EdgeType;
    targetId: string;
    summary: string;
  }>;
  insights: string[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  details?: string;
}

export interface GraphResponse {
  nodes: ResourceNode[];
  edges: GraphEdge[];
  generatedAt: string;
  warnings: string[];
  truncated?: boolean;
}

export interface ResourcesResponse {
  resources: ResourceNode[];
  generatedAt: string;
  warnings: string[];
}
