import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphResponse, ResourceNode, ResourcesResponse } from "./types";

type HighlightMode = "all" | "issues" | "managers" | "references";
type CenterViewMode = "graph" | "list";
type InspectorTab = "overview" | "yaml" | "events";
type GraphDepth = "1" | "2";

const metricHelp = {
  namespace: "Limits the explorer to one namespace or shows the whole cluster.",
  highlight: "Emphasizes resources that match the selected signal, such as issues or references.",
  resources: "Total number of resources currently loaded into the explorer.",
  issues: "Resources with noteworthy warnings, missing links, or unusual ownership and manager patterns.",
  managers: "Distinct field managers observed in Kubernetes managedFields for the current result set.",
  lastSync: "How long ago the resource and graph data were fetched from the Kubernetes API."
} as const;

function MetricHelpButton({ help, label }: { help: string; label: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="metric-help-wrap">
      <button
        type="button"
        className="metric-help"
        aria-label={label}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open ? (
        <div className="metric-help__tooltip" role="tooltip">
          {help}
        </div>
      ) : null}
    </span>
  );
}

const edgeMeta: Record<string, { color: string; label: string }> = {
  owns: { color: "#0f766e", label: "Owns" },
  selects: { color: "#2f855a", label: "Selects" },
  exposes: { color: "#b45309", label: "Exposes" },
  scales: { color: "#c2410c", label: "Scales" },
  references: { color: "#ca8a04", label: "References" },
  "ingress-routes-to": { color: "#be185d", label: "Ingress routes to" }
};

const kindMeta: Record<string, { tint: string; accent: string; icon: string }> = {
  Deployment: { tint: "rgba(15, 118, 110, 0.14)", accent: "#0f766e", icon: "DP" },
  ReplicaSet: { tint: "rgba(100, 116, 139, 0.14)", accent: "#64748b", icon: "RS" },
  Pod: { tint: "rgba(34, 197, 94, 0.14)", accent: "#15803d", icon: "PO" },
  Service: { tint: "rgba(249, 115, 22, 0.14)", accent: "#c2410c", icon: "SV" },
  Ingress: { tint: "rgba(190, 24, 93, 0.12)", accent: "#be185d", icon: "IG" },
  ConfigMap: { tint: "rgba(202, 138, 4, 0.14)", accent: "#a16207", icon: "CM" },
  Secret: { tint: "rgba(124, 58, 237, 0.10)", accent: "#7c3aed", icon: "SC" },
  HorizontalPodAutoscaler: { tint: "rgba(220, 38, 38, 0.12)", accent: "#dc2626", icon: "HP" },
  Namespace: { tint: "rgba(71, 85, 105, 0.12)", accent: "#475569", icon: "NS" }
};

function countIssues(node: ResourceNode) {
  return node.insights.length;
}

function summarizeAnnotations(annotations: Record<string, string>) {
  return Object.entries(annotations).slice(0, 6);
}

function formatTimestamp(value?: string) {
  if (!value) {
    return "n/a";
  }
  return new Date(value).toLocaleString();
}

function formatRelativeTime(value: string) {
  const deltaMs = Date.now() - new Date(value).getTime();
  const seconds = Math.max(Math.round(deltaMs / 1000), 0);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function resourceMatchesHighlight(node: ResourceNode, mode: HighlightMode) {
  if (mode === "all") {
    return true;
  }
  if (mode === "issues") {
    return countIssues(node) > 0;
  }
  if (mode === "managers") {
    return node.managers.length > 1;
  }
  if (mode === "references") {
    return node.relations.some((relation) => relation.type === "references");
  }
  return true;
}

function sortNodes(nodes: ResourceNode[]) {
  return [...nodes].sort((left, right) => {
    const issueDelta = countIssues(right) - countIssues(left);
    if (issueDelta !== 0) {
      return issueDelta;
    }
    const kindDelta = left.kind.localeCompare(right.kind);
    if (kindDelta !== 0) {
      return kindDelta;
    }
    return left.name.localeCompare(right.name);
  });
}

type RelationZone = "focus" | "traffic" | "controllers" | "dependents" | "config" | "secondary";

function zoneForRelation(edgeType: string, direction: "incoming" | "outgoing"): RelationZone {
  if (edgeType === "exposes" || edgeType === "ingress-routes-to") {
    return "traffic";
  }
  if (edgeType === "references") {
    return direction === "outgoing" ? "config" : "dependents";
  }
  if (edgeType === "owns" || edgeType === "selects") {
    return direction === "incoming" ? "controllers" : "dependents";
  }
  if (edgeType === "scales") {
    return "secondary";
  }
  return "secondary";
}

function buildFlowLayout(nodes: ResourceNode[], edges: GraphResponse["edges"], selectedId: string | null) {
  const kindOrder = ["Namespace", "Ingress", "Service", "Deployment", "HorizontalPodAutoscaler", "ReplicaSet", "Pod", "ConfigMap", "Secret"];
  const cardWidth = 196;
  const columnGap = 320;
  const rowGap = 184;
  const horizontalLaneGap = 260;

  const adjacency = new Map<string, Set<string>>();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeByPair = new Map<string, GraphResponse["edges"][number]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, new Set());
    }
    if (!adjacency.has(edge.target)) {
      adjacency.set(edge.target, new Set());
    }
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
    edgeByPair.set(`${edge.source}=>${edge.target}`, edge);
    edgeByPair.set(`${edge.target}<=${edge.source}`, edge);
  }

  const distanceById = new Map<string, number>();
  if (selectedId) {
    const queue: Array<{ id: string; distance: number }> = [{ id: selectedId, distance: 0 }];
    distanceById.set(selectedId, 0);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighborId of adjacency.get(current.id) ?? []) {
        if (distanceById.has(neighborId)) {
          continue;
        }
        distanceById.set(neighborId, current.distance + 1);
        queue.push({ id: neighborId, distance: current.distance + 1 });
      }
    }
  }

  const flowNodes: Node[] = [];
  const buckets = new Map<string, ResourceNode[]>();

  if (selectedId && nodeById.has(selectedId)) {
    for (const node of nodes) {
      if (node.id === selectedId) {
        buckets.set("focus:0", [node]);
        continue;
      }
      const distance = distanceById.get(node.id) ?? 2;
      let zone: RelationZone = "secondary";

      const directForward = edgeByPair.get(`${selectedId}=>${node.id}`);
      const directBackward = edgeByPair.get(`${node.id}=>${selectedId}`);
      if (directForward) {
        zone = zoneForRelation(directForward.type, "outgoing");
      } else if (directBackward) {
        zone = zoneForRelation(directBackward.type, "incoming");
      } else {
        const linkedNeighborId = [...(adjacency.get(node.id) ?? [])].find((neighborId) => (distanceById.get(neighborId) ?? 99) === 1);
        if (linkedNeighborId) {
          const viaForward = edgeByPair.get(`${linkedNeighborId}=>${node.id}`);
          const viaBackward = edgeByPair.get(`${node.id}=>${linkedNeighborId}`);
          if (viaForward) {
            zone = zoneForRelation(viaForward.type, "outgoing");
          } else if (viaBackward) {
            zone = zoneForRelation(viaBackward.type, "incoming");
          }
        }
      }

      const bucketKey = `${zone}:${Math.min(distance, 2)}`;
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, []);
      }
      buckets.get(bucketKey)!.push(node);
    }

    const bucketPlacements: Record<string, { x: number; y: number; vertical?: boolean; spacing?: number }> = {
      "focus:0": { x: 0, y: 0 },
      "traffic:1": { x: 0, y: -250, vertical: false, spacing: horizontalLaneGap },
      "traffic:2": { x: columnGap, y: -300, vertical: false, spacing: horizontalLaneGap },
      "controllers:1": { x: -columnGap, y: 0, vertical: true, spacing: rowGap },
      "controllers:2": { x: -(columnGap * 2), y: 0, vertical: true, spacing: rowGap },
      "dependents:1": { x: columnGap, y: 0, vertical: true, spacing: rowGap },
      "dependents:2": { x: columnGap * 2, y: 0, vertical: true, spacing: rowGap },
      "config:1": { x: 0, y: 248, vertical: false, spacing: horizontalLaneGap },
      "config:2": { x: columnGap, y: 320, vertical: false, spacing: horizontalLaneGap },
      "secondary:1": { x: -columnGap, y: 248, vertical: false, spacing: horizontalLaneGap },
      "secondary:2": { x: -(columnGap * 2), y: 320, vertical: false, spacing: horizontalLaneGap }
    };

    for (const [bucketKey, items] of buckets) {
      const placement = bucketPlacements[bucketKey] ?? { x: 0, y: 0, vertical: true };
      const sortedItems = [...items].sort((left, right) => {
        const kindDelta = kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind);
        if (kindDelta !== 0) {
          return kindDelta;
        }
        return left.name.localeCompare(right.name);
      });
      const spacing = placement.spacing ?? (placement.vertical ? rowGap : horizontalLaneGap);
      const totalSpan = Math.max((sortedItems.length - 1) * spacing, 0);

      sortedItems.forEach((item, index) => {
        const offset = index * spacing - totalSpan / 2;
        const meta = kindMeta[item.kind] ?? kindMeta.Namespace;
        const isSelected = item.id === selectedId;
        const distance = distanceById.get(item.id) ?? 0;
        flowNodes.push({
          id: item.id,
          data: {
            name: item.name,
            kind: item.kind,
            namespace: item.namespace ?? "cluster",
            accent: meta.accent,
            tint: meta.tint,
            icon: meta.icon,
            issues: countIssues(item),
            depth: distance === 0 ? "focus" : `hop ${distance}`
          },
          position: {
            x: placement.vertical ? placement.x : placement.x + offset,
            y: placement.vertical ? placement.y + offset : placement.y
          },
          style: {
            width: cardWidth,
            borderRadius: 20,
            border: `1px solid ${isSelected ? meta.accent : "rgba(148, 163, 184, 0.18)"}`,
            background: `linear-gradient(180deg, ${meta.tint}, rgba(255, 252, 246, 0.98))`,
            color: "#1f2937",
            boxShadow: isSelected
              ? `0 0 0 1px ${meta.accent} inset, 0 18px 30px rgba(15, 23, 42, 0.12)`
              : "0 10px 22px rgba(15, 23, 42, 0.08)",
            padding: 0
          }
        });
      });
    }
  } else {
    const sorted = sortNodes(nodes).slice(0, 18);
    sorted.forEach((item, index) => {
      const meta = kindMeta[item.kind] ?? kindMeta.Namespace;
      flowNodes.push({
        id: item.id,
        data: {
          name: item.name,
          kind: item.kind,
          namespace: item.namespace ?? "cluster",
          accent: meta.accent,
          tint: meta.tint,
          icon: meta.icon,
          issues: countIssues(item),
          depth: item.kind
        },
        position: { x: Math.floor(index / 6) * 260, y: (index % 6) * 120 },
        style: {
          width: 196,
          borderRadius: 20,
          border: "1px solid rgba(148, 163, 184, 0.18)",
          background: `linear-gradient(180deg, ${meta.tint}, rgba(255, 252, 246, 0.98))`,
          color: "#1f2937",
          boxShadow: "0 10px 22px rgba(15, 23, 42, 0.08)",
          padding: 0
        }
      });
    });
  }

  const visibleIds = new Set(nodes.map((node) => node.id));
  const positionedNodes = new Map(flowNodes.map((node) => [node.id, node]));
  const flowEdges: Edge[] = edges
    .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
    .map((edge) => {
      const sourceNode = positionedNodes.get(edge.source);
      const targetNode = positionedNodes.get(edge.target);
      const dx = (targetNode?.position.x ?? 0) - (sourceNode?.position.x ?? 0);
      const dy = (targetNode?.position.y ?? 0) - (sourceNode?.position.y ?? 0);

      const sourceHandle =
        Math.abs(dx) >= Math.abs(dy)
          ? dx >= 0
            ? "source-right"
            : "source-left"
          : dy >= 0
            ? "source-bottom"
            : "source-top";
      const targetHandle =
        Math.abs(dx) >= Math.abs(dy)
          ? dx >= 0
            ? "target-left"
            : "target-right"
          : dy >= 0
            ? "target-top"
            : "target-bottom";

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle,
        targetHandle,
        label: "",
        type: "smoothstep",
        animated: false,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edgeMeta[edge.type]?.color ?? "#94a3b8"
        },
        style: {
          stroke: edgeMeta[edge.type]?.color ?? "#94a3b8",
          strokeWidth: edge.type === "owns" ? 3.2 : 2.2,
          strokeDasharray: edge.type === "references" ? "6 6" : undefined,
          opacity: 0.9
        }
      };
    });

  return { nodes: flowNodes, edges: flowEdges };
}

function ResourceFlowNode({ data }: { data: Record<string, string | number> }) {
  return (
    <div className="flow-card">
      <Handle id="target-left" type="target" position={Position.Left} className="flow-handle" />
      <Handle id="target-top" type="target" position={Position.Top} className="flow-handle" />
      <Handle id="target-right" type="target" position={Position.Right} className="flow-handle" />
      <Handle id="target-bottom" type="target" position={Position.Bottom} className="flow-handle" />
      <div className="flow-card__header">
        <div className="flow-card__icon" style={{ backgroundColor: String(data.tint), color: String(data.accent) }}>
          {data.icon}
        </div>
        {Number(data.issues) > 0 ? <div className="flow-card__badge">{Number(data.issues)}</div> : null}
      </div>
      <div className="flow-card__body">
        <strong>{String(data.name)}</strong>
        <span>{String(data.kind)}</span>
      </div>
      <div className="flow-card__meta">
        <small>{String(data.namespace)}</small>
        <small>{String(data.depth)}</small>
      </div>
      <Handle id="source-left" type="source" position={Position.Left} className="flow-handle" />
      <Handle id="source-top" type="source" position={Position.Top} className="flow-handle" />
      <Handle id="source-right" type="source" position={Position.Right} className="flow-handle" />
      <Handle id="source-bottom" type="source" position={Position.Bottom} className="flow-handle" />
    </div>
  );
}

function buildSyntheticYaml(node: ResourceNode) {
  const indent = (value: string, depth = 2) => `${" ".repeat(depth)}${value}`;
  const lines = [
    `apiVersion: ${node.apiVersion}`,
    `kind: ${node.kind}`,
    "metadata:",
    indent(`name: ${node.name}`),
    indent(`namespace: ${node.namespace ?? "cluster-wide"}`),
    indent(`uid: ${node.uid ?? "n/a"}`),
    indent(`createdAt: ${node.createdAt ?? "n/a"}`)
  ];

  if (Object.keys(node.labels).length > 0) {
    lines.push(indent("labels:"));
    for (const [key, value] of Object.entries(node.labels)) {
      lines.push(indent(`${key}: ${value}`, 4));
    }
  }

  if (Object.keys(node.annotations).length > 0) {
    lines.push(indent("annotations:"));
    for (const [key, value] of summarizeAnnotations(node.annotations)) {
      lines.push(indent(`${key}: ${JSON.stringify(value)}`, 4));
    }
  }

  return lines.join("\n");
}

const nodeTypes = {
  resource: ResourceFlowNode
};

export function App() {
  const [resourcesPayload, setResourcesPayload] = useState<ResourcesResponse | null>(null);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [knownNamespaces, setKnownNamespaces] = useState<string[]>(["all"]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingResources, setLoadingResources] = useState(true);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [search, setSearch] = useState("");
  const [namespaceFilter, setNamespaceFilter] = useState("all");
  const [highlightMode, setHighlightMode] = useState<HighlightMode>("issues");
  const [centerViewMode, setCenterViewMode] = useState<CenterViewMode>("graph");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  const [graphDepth, setGraphDepth] = useState<GraphDepth>("2");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [insightsCollapsed, setInsightsCollapsed] = useState(true);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1510px)");
    const syncLayout = () => {
      const compact = mediaQuery.matches;
      setLeftCollapsed(compact);
      setRightCollapsed(compact);
      setInsightsCollapsed(compact);
    };

    syncLayout();
    mediaQuery.addEventListener("change", syncLayout);
    return () => {
      mediaQuery.removeEventListener("change", syncLayout);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoadingResources(true);
      setError(null);
      setGraph(null);
      try {
        const params = new URLSearchParams();
        if (namespaceFilter !== "all") {
          params.set("namespace", namespaceFilter);
        }
        const response = await fetch(`/api/resources?${params.toString()}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load resources");
        }
        setResourcesPayload(payload);
        setKnownNamespaces((current) => {
          const values = new Set(current);
          values.add("all");
          payload.resources.forEach((node: ResourceNode) => values.add(node.namespace ?? "cluster-wide"));
          return Array.from(values).sort((left, right) => {
            if (left === "all") {
              return -1;
            }
            if (right === "all") {
              return 1;
            }
            return left.localeCompare(right);
          });
        });
        setSelectedId((currentSelectedId) => {
          if (currentSelectedId && payload.resources.some((node: ResourceNode) => node.id === currentSelectedId)) {
            return currentSelectedId;
          }
          return payload.resources[0]?.id ?? null;
        });
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : "Unknown error");
      } finally {
        setLoadingResources(false);
      }
    }
    load();
    return () => {
      controller.abort();
    };
  }, [namespaceFilter]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadGraph() {
      if (!resourcesPayload) {
        return;
      }
      setLoadingGraph(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (namespaceFilter !== "all") {
          params.set("namespace", namespaceFilter);
        }
        if (selectedId) {
          params.set("focusId", selectedId);
        }
        params.set("depth", graphDepth);
        params.set("limit", graphDepth === "1" ? "60" : "120");
        const response = await fetch(`/api/graph?${params.toString()}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load graph");
        }
        setGraph(payload);
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : "Unknown error");
      } finally {
        setLoadingGraph(false);
      }
    }
    loadGraph();
    return () => {
      controller.abort();
    };
  }, [graphDepth, namespaceFilter, resourcesPayload, selectedId]);

  const namespaces = useMemo(() => {
    return knownNamespaces;
  }, [knownNamespaces]);

  const namespaceScopedNodes = useMemo(() => {
    if (!resourcesPayload) {
      return [];
    }
    return resourcesPayload.resources.filter((node) => {
      if (namespaceFilter === "all") {
        return true;
      }
      return (node.namespace ?? "cluster-wide") === namespaceFilter;
    });
  }, [namespaceFilter, resourcesPayload]);

  const visibleNodes = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    return sortNodes(
      namespaceScopedNodes.filter((node) => {
        const matchesSearch =
          searchTerm.length === 0 ||
          node.name.toLowerCase().includes(searchTerm) ||
          node.kind.toLowerCase().includes(searchTerm) ||
          (node.namespace ?? "cluster-wide").toLowerCase().includes(searchTerm);
        return matchesSearch && resourceMatchesHighlight(node, highlightMode);
      })
    );
  }, [highlightMode, namespaceScopedNodes, search]);

  useEffect(() => {
    if (visibleNodes.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !visibleNodes.some((node) => node.id === selectedId)) {
      setSelectedId(visibleNodes[0].id);
    }
  }, [selectedId, visibleNodes]);

  const selected = resourcesPayload?.resources.find((node) => node.id === selectedId) ?? null;

  const graphNodes = graph?.nodes ?? [];
  const expandedLegend = graphNodes.length <= 16;

  const filteredEdges = useMemo(() => {
    if (!graph) {
      return [];
    }
    const visibleIds = new Set(graphNodes.map((node) => node.id));
    return graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  }, [graph, graphNodes]);
  const flow = useMemo(() => buildFlowLayout(graphNodes, filteredEdges, selectedId), [filteredEdges, graphNodes, selectedId]);

  const metrics = useMemo(() => {
    const managerNames = new Set<string>();
    namespaceScopedNodes.forEach((node) => node.managers.forEach((manager) => managerNames.add(manager.manager)));
    return {
      resources: namespaceScopedNodes.length,
      issues: namespaceScopedNodes.filter((node) => countIssues(node) > 0).length,
      managers: managerNames.size
    };
  }, [namespaceScopedNodes]);

  const issueCards = useMemo(
    () =>
      namespaceScopedNodes
        .filter((node) => node.insights.length > 0)
        .slice(0, 4)
        .map((node) => ({
          id: node.id,
          title: `${node.kind} ${node.name}`,
          detail: node.insights[0].replace(/^([A-Z][^.]+)\.?$/, "$1"),
          severity: countIssues(node) >= 2 ? "high" : "medium"
        })),
    [namespaceScopedNodes]
  );

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    setSelectedId(node.id);
  };

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="hero-bar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="hero-copy">
            <div className="brand-eyebrow">Cluster topology explorer</div>
            <div className="brand-title">Kausal</div>
            <p>Trace ownership, traffic and config dependencies across your Kubernetes resources.</p>
          </div>
        </div>
      </header>

      {error ? (
        <main className="empty-shell">
          <h2>Cluster data unavailable</h2>
          <p>{error}</p>
          <p>Check ServiceAccount, RBAC, and Kubernetes API reachability.</p>
        </main>
      ) : resourcesPayload ? (
        <>
          <main
            className={`dashboard-grid ${
              leftCollapsed && rightCollapsed
                ? "dashboard-grid--graph-only"
                : leftCollapsed
                  ? "dashboard-grid--no-left"
                  : rightCollapsed
                    ? "dashboard-grid--no-right"
                    : ""
            }`}
          >
            {!leftCollapsed ? (
              <aside className="panel resource-panel">
              <div className="panel-heading">
                <div>
                  <h2>Resources</h2>
                  <p className="panel-subtitle">
                    {visibleNodes.length} shown{visibleNodes.length !== metrics.resources ? ` of ${metrics.resources}` : ""}
                  </p>
                </div>
              </div>
              <div className="search-shell">
                <input
                  aria-label="Search resources"
                  placeholder="Search resources..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <div className="resource-list">
                {visibleNodes.map((node) => {
                  const meta = kindMeta[node.kind] ?? kindMeta.Namespace;
                  const issues = countIssues(node);
                  return (
                    <button
                      key={node.id}
                      className={`resource-card ${selectedId === node.id ? "selected" : ""}`}
                      onClick={() => setSelectedId(node.id)}
                    >
                      <div className="resource-card__icon" style={{ backgroundColor: meta.tint, color: meta.accent }}>
                        {meta.icon}
                      </div>
                      <div className="resource-card__copy">
                        <strong>{node.name}</strong>
                        <span>
                          {node.kind} · {node.namespace ?? "cluster-wide"}
                        </span>
                      </div>
                      {issues > 0 ? <div className="resource-card__badge">{issues}</div> : <div className="resource-card__status" />}
                    </button>
                  );
                })}
              </div>
            </aside>
            ) : null}

            <section className="panel graph-panel">
              <div className="graph-toolbar">
                <section className="metric-row graph-toolbar__metrics">
                  <label className="metric-card metric-card--select">
                    <span className="metric-card__heading">
                      <span>Namespace</span>
                      <MetricHelpButton help={metricHelp.namespace} label="Explain namespace filter" />
                    </span>
                    <select value={namespaceFilter} onChange={(event) => setNamespaceFilter(event.target.value)}>
                      {namespaces.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="metric-card metric-card--select">
                    <span className="metric-card__heading">
                      <span>Highlight</span>
                      <MetricHelpButton help={metricHelp.highlight} label="Explain highlight filter" />
                    </span>
                    <select value={highlightMode} onChange={(event) => setHighlightMode(event.target.value as HighlightMode)}>
                      <option value="all">All resources</option>
                      <option value="issues">All issues</option>
                      <option value="managers">Multi-manager</option>
                      <option value="references">References</option>
                    </select>
                  </label>
                  <div className="metric-card">
                    <span className="metric-card__heading">
                      <span>Resources</span>
                      <MetricHelpButton help={metricHelp.resources} label="Explain resources metric" />
                    </span>
                    <strong>{metrics.resources}</strong>
                  </div>
                  <div className="metric-card metric-card--alert">
                    <span className="metric-card__heading">
                      <span>Issues</span>
                      <MetricHelpButton help={metricHelp.issues} label="Explain issues metric" />
                    </span>
                    <strong>{metrics.issues}</strong>
                  </div>
                  <div className="metric-card">
                    <span className="metric-card__heading">
                      <span>Managers</span>
                      <MetricHelpButton help={metricHelp.managers} label="Explain managers metric" />
                    </span>
                    <strong>{metrics.managers}</strong>
                  </div>
                  <div className="metric-card">
                    <span className="metric-card__heading">
                      <span>Last sync</span>
                      <MetricHelpButton help={metricHelp.lastSync} label="Explain last sync metric" />
                    </span>
                    <strong>{formatRelativeTime((graph ?? resourcesPayload).generatedAt)}</strong>
                  </div>
                </section>
                <div className="graph-toolbar__top">
                  <div className="graph-toolbar__slot graph-toolbar__slot--left">
                    <button
                      type="button"
                      className="panel-peek panel-peek--left"
                      onClick={() => setLeftCollapsed((value) => !value)}
                      aria-label={leftCollapsed ? "Expand resources panel" : "Collapse resources panel"}
                    >
                      <strong aria-hidden="true">{leftCollapsed ? ">" : "<"}</strong>
                      <span className="panel-peek__copy">
                        <b>Resources</b>
                        <small>{leftCollapsed ? "Show panel" : "Hide panel"}</small>
                      </span>
                    </button>
                  </div>
                  <div className="graph-toolbar__cluster">
                    <div className="view-switch">
                      <button
                        type="button"
                        className={centerViewMode === "graph" ? "active" : ""}
                        onClick={() => setCenterViewMode("graph")}
                      >
                        Graph view
                      </button>
                      <button
                        type="button"
                        className={centerViewMode === "list" ? "active" : ""}
                        onClick={() => setCenterViewMode("list")}
                      >
                        List view
                      </button>
                    </div>
                  </div>
                  <div className="graph-toolbar__actions">
                    <label className="graph-scope-select">
                      <span>Scope</span>
                      <select value={graphDepth} onChange={(event) => setGraphDepth(event.target.value as GraphDepth)}>
                        <option value="1">Direct relations</option>
                        <option value="2">Two hops</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="toolbar-chip"
                      onClick={() => setInsightsCollapsed((value) => !value)}
                      >
                        {insightsCollapsed ? "Show insights" : "Hide insights"}
                      </button>
                  </div>
                  <div className="graph-toolbar__slot graph-toolbar__slot--right">
                    <button
                      type="button"
                      className="panel-peek panel-peek--right"
                      onClick={() => setRightCollapsed((value) => !value)}
                      aria-label={rightCollapsed ? "Expand detail panel" : "Collapse detail panel"}
                    >
                      <span className="panel-peek__copy">
                        <b>Details</b>
                        <small>{rightCollapsed ? (selected?.kind ?? "Show panel") : "Hide panel"}</small>
                      </span>
                      <strong aria-hidden="true">{rightCollapsed ? "<" : ">"}</strong>
                    </button>
                  </div>
                </div>
                <div className="graph-toolbar__headline">
                  <div>
                    <span className="graph-toolbar__eyebrow">Focused topology</span>
                    <h2>{selected ? selected.name : "Cluster graph"}</h2>
                  </div>
                  <p>
                    {selected
                      ? `${selected.kind} in ${selected.namespace ?? "cluster-wide"}`
                      : "Inspect relationships between Kubernetes resources."}
                  </p>
                </div>
                <div className="graph-summary">
                  <span>{graphNodes.length} nodes</span>
                  <span>{filteredEdges.length} edges</span>
                  {loadingGraph ? <span>Updating graph...</span> : null}
                  {!expandedLegend ? <span>Dense view simplified</span> : null}
                </div>
                {expandedLegend ? (
                  <div className="edge-legend">
                    {Object.entries(edgeMeta).map(([key, value]) => (
                      <div key={key} className="edge-legend__item">
                        <span style={{ backgroundColor: value.color }} />
                        {value.label}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {visibleNodes.length === 0 ? (
                <div className="empty-shell empty-shell--center">
                  <h3>No resources match this filter</h3>
                  <p>Try a different namespace, highlight mode, or search term.</p>
                </div>
              ) : loadingGraph && !graph ? (
                <div className="empty-shell empty-shell--center">
                  <h3>Loading focused graph</h3>
                </div>
              ) : centerViewMode === "graph" ? (
                <div className="graph-stage">
                  {graph?.truncated ? (
                    <div className="graph-notice">
                      Focused subgraph shown for performance. Increase scope only when needed.
                    </div>
                  ) : null}
                  <ReactFlow
                    key={`${selectedId ?? "none"}-${graphDepth}-${graphNodes.length}-${filteredEdges.length}`}
                    nodes={flow.nodes.map((node) => ({ ...node, type: "resource" }))}
                    edges={flow.edges}
                    nodeTypes={nodeTypes}
                    fitView
                    fitViewOptions={{ padding: 0.22 }}
                    onNodeClick={handleNodeClick}
                    nodesDraggable={false}
                    zoomOnScroll
                    panOnDrag
                    defaultEdgeOptions={{ zIndex: 1 }}
                    proOptions={{ hideAttribution: true }}
                  >
                    <Controls position="top-left" showInteractive={false} fitViewOptions={{ padding: 0.22 }} />
                    <Background color="rgba(51, 65, 85, 0.5)" gap={24} />
                  </ReactFlow>
                </div>
              ) : (
                <div className="relation-list">
                  {graphNodes.map((node) => (
                    <article key={node.id} className="relation-card">
                      <div className="relation-card__top">
                        <div>
                          <strong>{node.name}</strong>
                          <span>
                            {node.kind} · {node.namespace ?? "cluster-wide"}
                          </span>
                        </div>
                        {countIssues(node) > 0 ? <div className="resource-card__badge">{countIssues(node)}</div> : null}
                      </div>
                      <p>{node.insights[0] ?? "No notable insights for this resource."}</p>
                      <div className="relation-tags">
                        {node.relations.slice(0, 4).map((relation) => (
                          <span key={`${node.id}-${relation.type}-${relation.targetId}`}>{edgeMeta[relation.type]?.label ?? relation.type}</span>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {!insightsCollapsed ? (
                <div className="issue-strip">
                  {issueCards.length > 0 ? (
                    issueCards.map((card) => (
                      <button
                        key={card.id}
                        type="button"
                        className={`issue-card issue-card--${card.severity}`}
                        onClick={() => setSelectedId(card.id)}
                      >
                        <div className="issue-card__title">{card.title}</div>
                        <p>{card.detail}</p>
                      </button>
                    ))
                  ) : (
                    <div className="issue-card issue-card--clear">
                      <div className="issue-card__title">No active issues</div>
                      <p>The current namespace filter does not expose resource warnings.</p>
                    </div>
                  )}
                </div>
              ) : null}
            </section>

            {!rightCollapsed ? (
              <aside className="panel detail-panel">
              <div className="detail-header">
                <div className="detail-header__title">
                  <div
                    className="resource-card__icon"
                    style={{
                      backgroundColor: selected ? (kindMeta[selected.kind] ?? kindMeta.Namespace).tint : kindMeta.Namespace.tint,
                      color: selected ? (kindMeta[selected.kind] ?? kindMeta.Namespace).accent : kindMeta.Namespace.accent
                    }}
                  >
                    {selected ? (kindMeta[selected.kind] ?? kindMeta.Namespace).icon : "--"}
                  </div>
                  <div>
                    <h2>{selected?.name ?? "No resource selected"}</h2>
                    <span>
                      {selected ? `${selected.kind} · ${selected.namespace ?? "cluster-wide"}` : "Choose a resource"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="detail-tabs">
                    <button
                      type="button"
                      className={inspectorTab === "overview" ? "active" : ""}
                      onClick={() => setInspectorTab("overview")}
                    >
                      Overview
                    </button>
                    <button
                      type="button"
                      className={inspectorTab === "yaml" ? "active" : ""}
                      onClick={() => setInspectorTab("yaml")}
                    >
                      YAML
                    </button>
                    <button
                      type="button"
                      className={inspectorTab === "events" ? "active" : ""}
                      onClick={() => setInspectorTab("events")}
                    >
                      Events
                    </button>
                  </div>
              {selected ? (
                <div className="detail-content">
                  {inspectorTab === "overview" ? (
                    <>
                      <section>
                        <h3>Identity</h3>
                        <dl className="property-grid">
                          <div>
                            <dt>Name</dt>
                            <dd>{selected.name}</dd>
                          </div>
                          <div>
                            <dt>Namespace</dt>
                            <dd>{selected.namespace ?? "cluster-wide"}</dd>
                          </div>
                          <div>
                            <dt>API Version</dt>
                            <dd>{selected.apiVersion}</dd>
                          </div>
                          <div>
                            <dt>UID</dt>
                            <dd>{selected.uid ?? "n/a"}</dd>
                          </div>
                          <div>
                            <dt>Created</dt>
                            <dd>{formatTimestamp(selected.createdAt)}</dd>
                          </div>
                          <div>
                            <dt>Managers</dt>
                            <dd>{selected.managers.length}</dd>
                          </div>
                        </dl>
                      </section>

                      <section>
                        <h3>Labels</h3>
                        <div className="token-list">
                          {Object.entries(selected.labels).length > 0 ? (
                            Object.entries(selected.labels).map(([key, value]) => <span key={key}>{key}: {value}</span>)
                          ) : (
                            <p>No labels present.</p>
                          )}
                        </div>
                      </section>

                      <section>
                        <h3>Owner References</h3>
                        {selected.ownerReferences.length > 0 ? (
                          <div className="stack-list">
                            {selected.ownerReferences.map((owner) => (
                              <div key={`${owner.kind}-${owner.name}`} className="stack-row">
                                <strong>{owner.kind}</strong>
                                <span>{owner.name}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p>No owner reference (top-level resource).</p>
                        )}
                      </section>

                      <section>
                        <h3>Managed Fields</h3>
                        {selected.managers.length > 0 ? (
                          <div className="stack-list">
                            {selected.managers.map((manager) => (
                              <div key={`${manager.manager}-${manager.time ?? "none"}`} className="stack-row">
                                <strong>{manager.manager}</strong>
                                <span>
                                  {manager.operation ?? "update"} · {manager.time ? formatRelativeTime(manager.time) : "unknown time"} ·{" "}
                                  {manager.fields.length} fields
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p>No managed fields available.</p>
                        )}
                      </section>
                    </>
                  ) : null}

                  {inspectorTab === "yaml" ? (
                    <section>
                      <h3>Snapshot YAML</h3>
                      <pre className="yaml-block">{buildSyntheticYaml(selected)}</pre>
                    </section>
                  ) : null}

                  {inspectorTab === "events" ? (
                    <>
                      <section>
                        <h3>Insights</h3>
                        {selected.insights.length > 0 ? (
                          <div className="stack-list">
                            {selected.insights.map((insight) => (
                              <div key={insight} className="stack-row">
                                <strong>Insight</strong>
                                <span>{insight}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p>No notable events detected in the current snapshot.</p>
                        )}
                      </section>
                      <section>
                        <h3>Relationships</h3>
                        {selected.relations.length > 0 ? (
                          <div className="stack-list">
                            {selected.relations.map((relation) => (
                              <div key={`${relation.type}-${relation.targetId}`} className="stack-row">
                                <strong>{edgeMeta[relation.type]?.label ?? relation.type}</strong>
                                <span>{relation.summary}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p>No derived relationships.</p>
                        )}
                      </section>
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="empty-shell empty-shell--center">
                  <h3>Select a resource</h3>
                  <p>Choose a node from the list or graph to inspect metadata and relationships.</p>
                </div>
              )}
            </aside>
            ) : null}
          </main>
        </>
      ) : (
        <main className="empty-shell">
          <h2>{loadingResources ? "Loading cluster data" : "Waiting for cluster data"}</h2>
        </main>
      )}
    </div>
  );
}
