import { useEffect, useMemo, useState } from "react";
import {
  Background,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphResponse, ResourceNode } from "./types";

type HighlightMode = "all" | "issues" | "managers" | "references";
type CenterViewMode = "graph" | "list";
type InspectorTab = "overview" | "yaml" | "events";

const edgeMeta: Record<string, { color: string; label: string }> = {
  owns: { color: "#3b82f6", label: "Owns" },
  selects: { color: "#4ade80", label: "Selects" },
  exposes: { color: "#9b5de5", label: "Exposes" },
  scales: { color: "#f97316", label: "Scales" },
  references: { color: "#fbbf24", label: "References" },
  "ingress-routes-to": { color: "#d946ef", label: "Ingress routes to" }
};

const kindMeta: Record<string, { tint: string; accent: string; icon: string }> = {
  Deployment: { tint: "rgba(37, 99, 235, 0.18)", accent: "#3b82f6", icon: "DP" },
  ReplicaSet: { tint: "rgba(59, 130, 246, 0.16)", accent: "#60a5fa", icon: "RS" },
  Pod: { tint: "rgba(34, 197, 94, 0.18)", accent: "#4ade80", icon: "PO" },
  Service: { tint: "rgba(139, 92, 246, 0.18)", accent: "#a78bfa", icon: "SV" },
  Ingress: { tint: "rgba(217, 70, 239, 0.18)", accent: "#e879f9", icon: "IG" },
  ConfigMap: { tint: "rgba(250, 204, 21, 0.18)", accent: "#fbbf24", icon: "CM" },
  Secret: { tint: "rgba(100, 116, 139, 0.18)", accent: "#94a3b8", icon: "SC" },
  HorizontalPodAutoscaler: { tint: "rgba(249, 115, 22, 0.18)", accent: "#fb923c", icon: "HP" },
  Namespace: { tint: "rgba(34, 197, 94, 0.12)", accent: "#22c55e", icon: "NS" }
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

function buildFlowLayout(nodes: ResourceNode[], edges: GraphResponse["edges"], selectedId: string | null) {
  const laneOrder = [
    "Ingress",
    "Service",
    "Deployment",
    "HorizontalPodAutoscaler",
    "ReplicaSet",
    "Pod",
    "ConfigMap",
    "Secret",
    "Namespace"
  ];

  const columns = new Map<string, ResourceNode[]>();
  for (const node of nodes) {
    if (!columns.has(node.kind)) {
      columns.set(node.kind, []);
    }
    columns.get(node.kind)!.push(node);
  }

  const flowNodes: Node[] = [];
  laneOrder.forEach((kind, columnIndex) => {
    const items = sortNodes(columns.get(kind) ?? []);
    const totalHeight = Math.max((items.length - 1) * 148, 0);
    items.forEach((item, itemIndex) => {
      const meta = kindMeta[item.kind] ?? kindMeta.Namespace;
      const isSelected = item.id === selectedId;
      flowNodes.push({
        id: item.id,
        data: {
          name: item.name,
          kind: item.kind,
          namespace: item.namespace ?? "cluster",
          accent: meta.accent,
          tint: meta.tint,
          icon: meta.icon,
          issues: countIssues(item)
        },
        position: {
          x: columnIndex * 250,
          y: itemIndex * 148 - totalHeight / 2
        },
        style: {
          width: 198,
          borderRadius: 18,
          border: `1px solid ${isSelected ? meta.accent : "rgba(148, 163, 184, 0.18)"}`,
          background: `linear-gradient(180deg, ${meta.tint}, rgba(9, 14, 24, 0.96))`,
          color: "#eff6ff",
          boxShadow: isSelected
            ? `0 0 0 1px ${meta.accent} inset, 0 18px 40px rgba(2, 6, 23, 0.45)`
            : "0 18px 40px rgba(2, 6, 23, 0.35)",
          padding: 0
        }
      });
    });
  });

  const visibleIds = new Set(nodes.map((node) => node.id));
  const flowEdges: Edge[] = edges
    .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edgeMeta[edge.type]?.label.toLowerCase() ?? edge.type,
      type: "smoothstep",
      animated: edge.type === "scales" || edge.type === "ingress-routes-to",
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: edgeMeta[edge.type]?.color ?? "#94a3b8"
      },
      style: {
        stroke: edgeMeta[edge.type]?.color ?? "#94a3b8",
        strokeWidth: 2
      },
      labelStyle: {
        fill: edgeMeta[edge.type]?.color ?? "#cbd5e1",
        fontSize: 11
      }
    }));

  return { nodes: flowNodes, edges: flowEdges };
}

function ResourceFlowNode({ data }: { data: Record<string, string | number> }) {
  return (
    <div className="flow-card">
      <div className="flow-card__icon" style={{ backgroundColor: String(data.tint), color: String(data.accent) }}>
        {data.icon}
      </div>
      <div className="flow-card__body">
        <strong>{String(data.name)}</strong>
        <span>{String(data.kind)}</span>
      </div>
      {Number(data.issues) > 0 ? <div className="flow-card__badge">{Number(data.issues)}</div> : null}
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
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [namespaceFilter, setNamespaceFilter] = useState("all");
  const [highlightMode, setHighlightMode] = useState<HighlightMode>("issues");
  const [centerViewMode, setCenterViewMode] = useState<CenterViewMode>("graph");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/graph");
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load graph");
        }
        if (active) {
          setGraph(payload);
          setSelectedId(payload.nodes[0]?.id ?? null);
        }
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : "Unknown error");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const namespaces = useMemo(() => {
    const values = new Set<string>();
    graph?.nodes.forEach((node) => values.add(node.namespace ?? "cluster-wide"));
    return ["all", ...Array.from(values).sort((left, right) => left.localeCompare(right))];
  }, [graph]);

  const namespaceScopedNodes = useMemo(() => {
    if (!graph) {
      return [];
    }
    return graph.nodes.filter((node) => {
      if (namespaceFilter === "all") {
        return true;
      }
      return (node.namespace ?? "cluster-wide") === namespaceFilter;
    });
  }, [graph, namespaceFilter]);

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

  const selected = graph?.nodes.find((node) => node.id === selectedId) ?? null;

  const filteredEdges = useMemo(() => {
    if (!graph) {
      return [];
    }
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    return graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  }, [graph, visibleNodes]);

  const flow = useMemo(() => buildFlowLayout(visibleNodes, filteredEdges, selectedId), [filteredEdges, selectedId, visibleNodes]);

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
          detail: node.insights[0],
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
          <div>
            <div className="brand-title">Kausal</div>
            <p>Visualize why your Kubernetes resources look the way they do.</p>
          </div>
        </div>
        <div className="hero-actions">
          <button type="button" className="icon-button" aria-label="Help">
            ?
          </button>
          <button type="button" className="icon-button" aria-label="Theme">
            *
          </button>
        </div>
      </header>

      {error ? (
        <main className="empty-shell">
          <h2>Cluster data unavailable</h2>
          <p>{error}</p>
          <p>Check ServiceAccount, RBAC, and Kubernetes API reachability.</p>
        </main>
      ) : graph ? (
        <>
          <section className="metric-row">
            <label className="metric-card metric-card--select">
              <span>Namespace</span>
              <select value={namespaceFilter} onChange={(event) => setNamespaceFilter(event.target.value)}>
                {namespaces.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="metric-card metric-card--select">
              <span>Highlight</span>
              <select value={highlightMode} onChange={(event) => setHighlightMode(event.target.value as HighlightMode)}>
                <option value="all">All resources</option>
                <option value="issues">All issues</option>
                <option value="managers">Multi-manager</option>
                <option value="references">References</option>
              </select>
            </label>
            <div className="metric-card">
              <span>Resources</span>
              <strong>{metrics.resources}</strong>
            </div>
            <div className="metric-card metric-card--alert">
              <span>Issues</span>
              <strong>{metrics.issues}</strong>
            </div>
            <div className="metric-card">
              <span>Managers</span>
              <strong>{metrics.managers}</strong>
            </div>
            <div className="metric-card">
              <span>Last sync</span>
              <strong>{formatRelativeTime(graph.generatedAt)}</strong>
            </div>
          </section>

          <main className="dashboard-grid">
            <aside className="panel resource-panel">
              <div className="panel-heading">
                <h2>Resources</h2>
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

            <section className="panel graph-panel">
              <div className="graph-toolbar">
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
                <div className="edge-legend">
                  {Object.entries(edgeMeta).map(([key, value]) => (
                    <div key={key} className="edge-legend__item">
                      <span style={{ backgroundColor: value.color }} />
                      {value.label}
                    </div>
                  ))}
                </div>
              </div>

              {visibleNodes.length === 0 ? (
                <div className="empty-shell empty-shell--center">
                  <h3>No resources match this filter</h3>
                  <p>Try a different namespace, highlight mode, or search term.</p>
                </div>
              ) : centerViewMode === "graph" ? (
                <div className="graph-stage">
                  <ReactFlow
                    nodes={flow.nodes.map((node) => ({ ...node, type: "resource" }))}
                    edges={flow.edges}
                    nodeTypes={nodeTypes}
                    fitView
                    onNodeClick={handleNodeClick}
                    nodesDraggable={false}
                    defaultEdgeOptions={{ zIndex: 1 }}
                    proOptions={{ hideAttribution: true }}
                  >
                    <MiniMap pannable zoomable nodeColor={(node) => String(node.data?.accent ?? "#334155")} />
                    <Background color="rgba(51, 65, 85, 0.5)" gap={24} />
                  </ReactFlow>
                </div>
              ) : (
                <div className="relation-list">
                  {visibleNodes.map((node) => (
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
            </section>

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
          </main>
        </>
      ) : (
        <main className="empty-shell">
          <h2>Waiting for cluster data</h2>
        </main>
      )}
    </div>
  );
}
