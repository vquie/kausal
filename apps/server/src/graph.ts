import type {
  V1ConfigMap,
  V1Deployment,
  V1Ingress,
  V1Namespace,
  V1Pod,
  V1PodSpec,
  V1ReplicaSet,
  V1Service,
  V2HorizontalPodAutoscaler
} from "@kubernetes/client-node";
import type { GraphEdge, GraphResponse, ManagedFieldSummary, ResourceNode } from "./types.js";

type AnyKubeResource =
  | V1Namespace
  | V1Deployment
  | V1ReplicaSet
  | V1Pod
  | V1Service
  | V1Ingress
  | V1ConfigMap
  | V2HorizontalPodAutoscaler;

interface BuildInput {
  namespaces: V1Namespace[];
  deployments: V1Deployment[];
  replicaSets: V1ReplicaSet[];
  pods: V1Pod[];
  services: V1Service[];
  ingresses: V1Ingress[];
  configMaps: V1ConfigMap[];
  secrets: ResourceNode[];
  hpas: V2HorizontalPodAutoscaler[];
}

function toResourceId(kind: string, namespace: string | null | undefined, name: string) {
  return `${kind}:${namespace ?? "_cluster"}:${name}`;
}

function normalizeLabels(value: Record<string, string> | undefined | null) {
  return value ?? {};
}

function normalizeAnnotations(value: Record<string, string> | undefined | null) {
  return value ?? {};
}

function ownerReferences(
  value:
    | Array<{
        apiVersion?: string;
        kind?: string;
        name?: string;
        uid?: string;
        controller?: boolean;
      }>
    | undefined
) {
  return (value ?? []).map((ref) => ({
    apiVersion: ref.apiVersion,
    kind: ref.kind,
    name: ref.name,
    uid: ref.uid,
    controller: ref.controller
  }));
}

function collectFieldPaths(node: unknown, path = ""): string[] {
  if (!node || typeof node !== "object") {
    return [];
  }

  const object = node as Record<string, unknown>;
  const results: string[] = [];

  for (const [key, value] of Object.entries(object)) {
    if (!key.startsWith("f:") && !key.startsWith("k:") && !key.startsWith("v:")) {
      continue;
    }

    const label = key.startsWith("f:") ? key.slice(2) : key;
    const nextPath = path ? `${path}.${label}` : label;

    if (value && typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0) {
      results.push(...collectFieldPaths(value, nextPath));
    } else {
      results.push(nextPath);
    }
  }

  return results;
}

function summarizeManagedFields(value: Array<Record<string, unknown>> | undefined): ManagedFieldSummary[] {
  return (value ?? []).map((field) => {
    const fields = collectFieldPaths(field.fieldsV1).slice(0, 40);
    return {
      manager: String(field.manager ?? "unknown"),
      operation: field.operation ? String(field.operation) : undefined,
      time: field.time ? String(field.time) : undefined,
      fields
    };
  });
}

function matchesSelector(
  selector: Record<string, string> | undefined,
  labels: Record<string, string>
) {
  if (!selector || Object.keys(selector).length === 0) {
    return false;
  }

  return Object.entries(selector).every(([key, value]) => labels[key] === value);
}

function podTemplateRefs(resource: V1Deployment | V1ReplicaSet | V1Pod): Array<{ kind: "ConfigMap" | "Secret"; name: string }> {
  let podSpec: V1PodSpec | undefined;

  if (resource.kind === "Pod") {
    podSpec = (resource as V1Pod).spec;
  } else {
    podSpec = (resource as V1Deployment | V1ReplicaSet).spec?.template?.spec;
  }

  if (!podSpec) {
    return [];
  }

  const refs = new Map<string, { kind: "ConfigMap" | "Secret"; name: string }>();

  for (const volume of podSpec.volumes ?? []) {
    if (volume.configMap?.name) {
      refs.set(`ConfigMap:${volume.configMap.name}`, { kind: "ConfigMap", name: volume.configMap.name });
    }
    if (volume.secret?.secretName) {
      refs.set(`Secret:${volume.secret.secretName}`, { kind: "Secret", name: volume.secret.secretName });
    }
  }

  const containers = [...(podSpec.containers ?? []), ...(podSpec.initContainers ?? [])];
  for (const container of containers) {
    for (const env of container.env ?? []) {
      if (env.valueFrom?.configMapKeyRef?.name) {
        refs.set(`ConfigMap:${env.valueFrom.configMapKeyRef.name}`, {
          kind: "ConfigMap",
          name: env.valueFrom.configMapKeyRef.name
        });
      }
      if (env.valueFrom?.secretKeyRef?.name) {
        refs.set(`Secret:${env.valueFrom.secretKeyRef.name}`, {
          kind: "Secret",
          name: env.valueFrom.secretKeyRef.name
        });
      }
    }
    for (const envFrom of container.envFrom ?? []) {
      if (envFrom.configMapRef?.name) {
        refs.set(`ConfigMap:${envFrom.configMapRef.name}`, { kind: "ConfigMap", name: envFrom.configMapRef.name });
      }
      if (envFrom.secretRef?.name) {
        refs.set(`Secret:${envFrom.secretRef.name}`, { kind: "Secret", name: envFrom.secretRef.name });
      }
    }
  }

  return [...refs.values()];
}

function syntheticSecretNodes(input: Omit<BuildInput, "secrets">): ResourceNode[] {
  const refs = new Map<string, ResourceNode>();
  const workloads = [...input.deployments, ...input.replicaSets, ...input.pods];

  for (const workload of workloads) {
    const namespace = workload.metadata?.namespace ?? null;
    for (const ref of podTemplateRefs(workload)) {
      if (ref.kind !== "Secret") {
        continue;
      }

      const id = toResourceId("Secret", namespace, ref.name);
      if (refs.has(id)) {
        continue;
      }

      refs.set(id, {
        id,
        kind: "Secret",
        apiVersion: "v1",
        name: ref.name,
        namespace,
        labels: {},
        annotations: {},
        ownerReferences: [],
        managers: [],
        relations: [],
        insights: ["Secret metadata is not fetched in the dev deployment; this node is inferred from workload references."]
      });
    }
  }

  return [...refs.values()];
}

function toNode(resource: AnyKubeResource, kind: ResourceNode["kind"], namespaceOverride?: string | null): ResourceNode {
  const metadata = (resource.metadata ?? {}) as {
    namespace?: string;
    name?: string;
    uid?: string;
    creationTimestamp?: string | Date;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: Array<{
      apiVersion?: string;
      kind?: string;
      name?: string;
      uid?: string;
      controller?: boolean;
    }>;
    managedFields?: Array<Record<string, unknown>>;
  };
  const namespace = namespaceOverride ?? metadata.namespace ?? null;
  const name = metadata.name ?? "unknown";
  return {
    id: toResourceId(kind, namespace, name),
    kind,
    apiVersion: resource.apiVersion ?? "unknown",
    name,
    namespace,
    uid: metadata.uid,
    createdAt: metadata.creationTimestamp ? new Date(metadata.creationTimestamp).toISOString() : undefined,
    labels: normalizeLabels(metadata.labels),
    annotations: normalizeAnnotations(metadata.annotations),
    ownerReferences: ownerReferences(metadata.ownerReferences),
    managers: summarizeManagedFields(metadata.managedFields),
    relations: [],
    insights: []
  };
}

function addRelation(nodeMap: Map<string, ResourceNode>, source: string, type: GraphEdge["type"], target: string, details?: string) {
  const node = nodeMap.get(source);
  if (!node) {
    return;
  }
  const summary = details ?? `${type} ${target}`;
  if (!node.relations.some((relation) => relation.type === type && relation.targetId === target)) {
    node.relations.push({ type, targetId: target, summary });
  }
}

export function buildGraph(input: BuildInput): GraphResponse {
  const secrets = input.secrets.length > 0 ? input.secrets : syntheticSecretNodes(input);
  const nodes: ResourceNode[] = [
    ...input.namespaces.map((item) => toNode(item, "Namespace", null)),
    ...input.deployments.map((item) => toNode(item, "Deployment")),
    ...input.replicaSets.map((item) => toNode(item, "ReplicaSet")),
    ...input.pods.map((item) => toNode(item, "Pod")),
    ...input.services.map((item) => toNode(item, "Service")),
    ...input.ingresses.map((item) => toNode(item, "Ingress")),
    ...input.configMaps.map((item) => toNode(item, "ConfigMap")),
    ...secrets,
    ...input.hpas.map((item) => toNode(item, "HorizontalPodAutoscaler"))
  ];

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  function pushEdge(source: string, target: string, type: GraphEdge["type"], details?: string) {
    const id = `${type}:${source}:${target}`;
    if (edges.some((edge) => edge.id === id)) {
      return;
    }
    edges.push({ id, source, target, type, details });
    addRelation(nodeMap, source, type, target, details);
  }

  for (const node of nodes) {
    if (node.ownerReferences.length > 0) {
      for (const owner of node.ownerReferences) {
        if (!owner.kind || !owner.name) {
          continue;
        }
        const target = toResourceId(owner.kind, node.namespace, owner.name);
        pushEdge(target, node.id, "owns", owner.controller ? "controller ownerReference" : "ownerReference");
      }
    }

    if (node.managers.length > 1) {
      node.insights.push(`Multiple managers observed: ${node.managers.map((item) => item.manager).join(", ")}`);
    }
    if (node.managers.length >= 4) {
      node.insights.push("Many different field managers touched this resource.");
    }
  }

  for (const deployment of input.deployments) {
    const source = toResourceId("Deployment", deployment.metadata?.namespace, deployment.metadata?.name ?? "unknown");
    const selector = deployment.spec?.selector?.matchLabels;
    const matchingPods = input.pods.filter((pod) => matchesSelector(selector, normalizeLabels(pod.metadata?.labels)));
    if (matchingPods.length === 0) {
      nodeMap.get(source)?.insights.push("Deployment has no matching Pods.");
    }
    for (const pod of matchingPods) {
      pushEdge(source, toResourceId("Pod", pod.metadata?.namespace, pod.metadata?.name ?? "unknown"), "selects", "pod template selector");
    }

    for (const ref of podTemplateRefs(deployment)) {
      pushEdge(source, toResourceId(ref.kind, deployment.metadata?.namespace, ref.name), "references", "pod template reference");
    }
  }

  for (const replicaSet of input.replicaSets) {
    const source = toResourceId("ReplicaSet", replicaSet.metadata?.namespace, replicaSet.metadata?.name ?? "unknown");
    const selector = replicaSet.spec?.selector?.matchLabels;
    for (const pod of input.pods.filter((item) => matchesSelector(selector, normalizeLabels(item.metadata?.labels)))) {
      pushEdge(source, toResourceId("Pod", pod.metadata?.namespace, pod.metadata?.name ?? "unknown"), "selects", "replicaset selector");
    }
    for (const ref of podTemplateRefs(replicaSet)) {
      pushEdge(source, toResourceId(ref.kind, replicaSet.metadata?.namespace, ref.name), "references", "pod template reference");
    }
  }

  for (const pod of input.pods) {
    const source = toResourceId("Pod", pod.metadata?.namespace, pod.metadata?.name ?? "unknown");
    for (const ref of podTemplateRefs(pod)) {
      pushEdge(source, toResourceId(ref.kind, pod.metadata?.namespace, ref.name), "references", "pod reference");
    }
  }

  for (const service of input.services) {
    const source = toResourceId("Service", service.metadata?.namespace, service.metadata?.name ?? "unknown");
    const selector = service.spec?.selector;
    const matchingPods = input.pods.filter(
      (pod) => pod.metadata?.namespace === service.metadata?.namespace && matchesSelector(selector, normalizeLabels(pod.metadata?.labels))
    );
    if (selector && Object.keys(selector).length > 0 && matchingPods.length === 0) {
      nodeMap.get(source)?.insights.push("Service selector matches no Pods.");
    }
    for (const pod of matchingPods) {
      pushEdge(source, toResourceId("Pod", pod.metadata?.namespace, pod.metadata?.name ?? "unknown"), "exposes", "service selector");
    }
  }

  for (const ingress of input.ingresses) {
    const source = toResourceId("Ingress", ingress.metadata?.namespace, ingress.metadata?.name ?? "unknown");
    let foundService = false;
    for (const rule of ingress.spec?.rules ?? []) {
      for (const path of rule.http?.paths ?? []) {
        const serviceName = path.backend.service?.name;
        if (!serviceName) {
          continue;
        }
        foundService = true;
        pushEdge(source, toResourceId("Service", ingress.metadata?.namespace, serviceName), "ingress-routes-to", rule.host ?? path.path ?? "ingress backend");
      }
    }
    for (const backend of ingress.spec?.defaultBackend?.service?.name ? [ingress.spec.defaultBackend.service.name] : []) {
      foundService = true;
      pushEdge(source, toResourceId("Service", ingress.metadata?.namespace, backend), "ingress-routes-to", "default backend");
    }
    if (!foundService) {
      nodeMap.get(source)?.insights.push("Ingress has no resolvable Service backend.");
    }
  }

  for (const hpa of input.hpas) {
    const source = toResourceId("HorizontalPodAutoscaler", hpa.metadata?.namespace, hpa.metadata?.name ?? "unknown");
    const ref = hpa.spec?.scaleTargetRef;
    if (ref?.kind && ref.name) {
      const target = toResourceId(ref.kind, hpa.metadata?.namespace, ref.name);
      pushEdge(source, target, "scales", "scaleTargetRef");
      nodeMap.get(source)?.insights.push(`HPA scales ${ref.kind}/${ref.name}.`);
      nodeMap.get(target)?.insights.push(`Scaled by HPA ${hpa.metadata?.name ?? "unknown"}.`);
    }
  }

  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!sourceNode || !targetNode) {
      warnings.push(`Edge ${edge.id} points to a missing node.`);
      continue;
    }
    if (edge.type === "owns") {
      targetNode.insights.push(`Controlled by ${sourceNode.kind} ${sourceNode.name}.`);
    }
    if (edge.type === "exposes") {
      targetNode.insights.push(`Exposed by Service ${sourceNode.name}.`);
    }
    if (edge.type === "ingress-routes-to") {
      targetNode.insights.push(`Ingress ${sourceNode.name} routes traffic here.`);
    }
    if (edge.type === "references") {
      sourceNode.insights.push(`References ${targetNode.kind} ${targetNode.name}.`);
    }
  }

  return {
    nodes,
    edges,
    generatedAt: new Date().toISOString(),
    warnings
  };
}

function nodePriority(node: ResourceNode, edgesByNode: Map<string, number>) {
  return node.insights.length * 10 + (edgesByNode.get(node.id) ?? 0);
}

export function focusGraph(graph: GraphResponse, focusId?: string, depth = 1, limit = 80): GraphResponse {
  if (graph.nodes.length <= limit && !focusId) {
    return graph;
  }

  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, Set<string>>();
  const edgesByNode = new Map<string, number>();

  for (const edge of graph.edges) {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, new Set());
    }
    if (!adjacency.has(edge.target)) {
      adjacency.set(edge.target, new Set());
    }
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
    edgesByNode.set(edge.source, (edgesByNode.get(edge.source) ?? 0) + 1);
    edgesByNode.set(edge.target, (edgesByNode.get(edge.target) ?? 0) + 1);
  }

  const selectedIds = new Set<string>();

  if (focusId && nodeMap.has(focusId)) {
    const queue: Array<{ id: string; level: number }> = [{ id: focusId, level: 0 }];
    selectedIds.add(focusId);

    while (queue.length > 0 && selectedIds.size < limit) {
      const current = queue.shift()!;
      if (current.level >= depth) {
        continue;
      }

      const neighbors = [...(adjacency.get(current.id) ?? [])].sort((left, right) => {
        const leftNode = nodeMap.get(left);
        const rightNode = nodeMap.get(right);
        return (rightNode ? nodePriority(rightNode, edgesByNode) : 0) - (leftNode ? nodePriority(leftNode, edgesByNode) : 0);
      });

      for (const neighborId of neighbors) {
        if (selectedIds.size >= limit) {
          break;
        }
        if (selectedIds.has(neighborId)) {
          continue;
        }
        selectedIds.add(neighborId);
        queue.push({ id: neighborId, level: current.level + 1 });
      }
    }
  }

  if (selectedIds.size === 0) {
    for (const node of [...graph.nodes].sort((left, right) => nodePriority(right, edgesByNode) - nodePriority(left, edgesByNode))) {
      selectedIds.add(node.id);
      if (selectedIds.size >= limit) {
        break;
      }
    }
  }

  const nodes = graph.nodes.filter((node) => selectedIds.has(node.id));
  const edges = graph.edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target));

  return {
    ...graph,
    nodes,
    edges,
    truncated: nodes.length < graph.nodes.length
  };
}
