export interface ManagedFieldSummary {
  manager: string;
  operation?: string;
  time?: string;
  fields: string[];
}

export interface ResourceNode {
  id: string;
  kind: string;
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
    type: string;
    targetId: string;
    summary: string;
  }>;
  insights: string[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
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
