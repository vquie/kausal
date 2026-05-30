import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphResponse, ResourceNode } from "./types";

const edgeColors: Record<string, string> = {
  owns: "#f59e0b",
  selects: "#06b6d4",
  exposes: "#22c55e",
  scales: "#ef4444",
  references: "#a855f7",
  "ingress-routes-to": "#fb7185"
};

function summarizeAnnotations(annotations: Record<string, string>) {
  return Object.entries(annotations).slice(0, 8);
}

function nodeColor(kind: string) {
  switch (kind) {
    case "Deployment":
      return "#0f766e";
    case "ReplicaSet":
      return "#2563eb";
    case "Pod":
      return "#7c3aed";
    case "Service":
      return "#16a34a";
    case "Ingress":
      return "#db2777";
    case "ConfigMap":
      return "#ca8a04";
    case "Secret":
      return "#dc2626";
    case "HorizontalPodAutoscaler":
      return "#ea580c";
    default:
      return "#475569";
  }
}

function buildFlowLayout(graph: GraphResponse): { nodes: Node[]; edges: Edge[] } {
  const laneOrder = [
    "Namespace",
    "Deployment",
    "ReplicaSet",
    "Pod",
    "Service",
    "Ingress",
    "ConfigMap",
    "Secret",
    "HorizontalPodAutoscaler"
  ];

  const groups = new Map<string, ResourceNode[]>();
  for (const node of graph.nodes) {
    const key = node.namespace ?? "_cluster";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(node);
  }

  const flowNodes: Node[] = [];
  let groupIndex = 0;

  for (const [namespace, items] of groups) {
    const sorted = [...items].sort((a, b) => {
      const laneDelta = laneOrder.indexOf(a.kind) - laneOrder.indexOf(b.kind);
      return laneDelta !== 0 ? laneDelta : a.name.localeCompare(b.name);
    });

    sorted.forEach((item, index) => {
      const lane = Math.max(laneOrder.indexOf(item.kind), 0);
      flowNodes.push({
        id: item.id,
        data: {
          label: `${item.kind}\n${item.name}\n${namespace === "_cluster" ? "cluster" : namespace}`
        },
        position: {
          x: lane * 240,
          y: groupIndex * 320 + index * 110
        },
        style: {
          width: 200,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.18)",
          background: `linear-gradient(160deg, ${nodeColor(item.kind)}, #0f172a)`,
          color: "white",
          fontSize: 12,
          whiteSpace: "pre-line",
          padding: 14,
          boxShadow: "0 14px 30px rgba(15,23,42,0.25)"
        }
      });
    });
    groupIndex += 1;
  }

  const flowEdges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.type,
    type: "smoothstep",
    animated: edge.type === "scales" || edge.type === "ingress-routes-to",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: edgeColors[edge.type] ?? "#94a3b8"
    },
    style: {
      stroke: edgeColors[edge.type] ?? "#94a3b8",
      strokeWidth: 2
    },
    labelStyle: {
      fill: "#cbd5e1",
      fontSize: 11
    }
  }));

  return { nodes: flowNodes, edges: flowEdges };
}

export function App() {
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  const flow = useMemo(() => (graph ? buildFlowLayout(graph) : { nodes: [], edges: [] }), [graph]);
  const selected = graph?.nodes.find((node) => node.id === selectedId) ?? null;
  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    setSelectedId(node.id);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Kausal</p>
          <h1>Why does this Kubernetes resource look like this?</h1>
        </div>
        <div className="status-pill">{loading ? "Loading cluster state" : graph ? `Snapshot ${new Date(graph.generatedAt).toLocaleString()}` : "Disconnected"}</div>
      </header>

      {error ? (
        <main className="error-state">
          <h2>Cluster data unavailable</h2>
          <p>{error}</p>
          <p>Check ServiceAccount, RBAC, and Kubernetes API reachability.</p>
        </main>
      ) : graph ? (
        <main className="layout">
          <aside className="sidebar">
            <div className="panel-header">
              <h2>Resources</h2>
              <span>{graph.nodes.length}</span>
            </div>
            <div className="resource-list">
              {graph.nodes.map((node) => (
                <button
                  key={node.id}
                  className={`resource-card ${selectedId === node.id ? "selected" : ""}`}
                  onClick={() => setSelectedId(node.id)}
                >
                  <span className="resource-kind">{node.kind}</span>
                  <strong>{node.name}</strong>
                  <small>{node.namespace ?? "cluster-wide"}</small>
                </button>
              ))}
            </div>
          </aside>

          <section className="graph-panel">
            <div className="panel-header">
              <h2>Relationship Graph</h2>
              <span>{graph.edges.length} edges</span>
            </div>
            {graph.nodes.length === 0 ? (
              <div className="empty-state">
                <h3>No supported resources found</h3>
                <p>Create a Deployment or Service in the cluster and refresh the page.</p>
              </div>
            ) : (
              <ReactFlow
                nodes={flow.nodes}
                edges={flow.edges}
                fitView
                onNodeClick={handleNodeClick}
                defaultEdgeOptions={{ zIndex: 1 }}
              >
                <MiniMap pannable zoomable />
                <Controls />
                <Background color="#1e293b" gap={20} />
              </ReactFlow>
            )}
          </section>

          <aside className="detail-panel">
            <div className="panel-header">
              <h2>Details</h2>
              <span>{selected?.kind ?? "Nothing selected"}</span>
            </div>
            {selected ? (
              <div className="detail-content">
                <section>
                  <h3>Identity</h3>
                  <p>{selected.kind}</p>
                  <p>{selected.namespace ?? "cluster-wide"} / {selected.name}</p>
                  <p>{selected.apiVersion}</p>
                </section>

                <section>
                  <h3>Hints</h3>
                  {selected.insights.length > 0 ? (
                    <ul>
                      {selected.insights.map((insight) => (
                        <li key={insight}>{insight}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No special hints detected.</p>
                  )}
                </section>

                <section>
                  <h3>Relations</h3>
                  {selected.relations.length > 0 ? (
                    <ul>
                      {selected.relations.map((relation) => (
                        <li key={`${relation.type}-${relation.targetId}`}>{relation.type}: {relation.summary}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No derived relations.</p>
                  )}
                </section>

                <section>
                  <h3>Owner References</h3>
                  {selected.ownerReferences.length > 0 ? (
                    <ul>
                      {selected.ownerReferences.map((owner) => (
                        <li key={`${owner.kind}-${owner.name}`}>{owner.kind}/{owner.name}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>None</p>
                  )}
                </section>

                <section>
                  <h3>Labels</h3>
                  {Object.keys(selected.labels).length > 0 ? (
                    <ul>
                      {Object.entries(selected.labels).map(([key, value]) => (
                        <li key={key}><code>{key}</code>={value}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No labels</p>
                  )}
                </section>

                <section>
                  <h3>Annotations</h3>
                  {summarizeAnnotations(selected.annotations).length > 0 ? (
                    <ul>
                      {summarizeAnnotations(selected.annotations).map(([key, value]) => (
                        <li key={key}><code>{key}</code>={value.slice(0, 120)}{value.length > 120 ? "..." : ""}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No annotations</p>
                  )}
                </section>

                <section>
                  <h3>Managed Fields</h3>
                  {selected.managers.length > 0 ? (
                    <ul>
                      {selected.managers.map((manager) => (
                        <li key={`${manager.manager}-${manager.time ?? "none"}`}>
                          <strong>{manager.manager}</strong> {manager.operation ? `(${manager.operation})` : ""}
                          {manager.time ? ` at ${new Date(manager.time).toLocaleString()}` : ""}
                          {manager.fields.length > 0 ? ` -> ${manager.fields.slice(0, 6).join(", ")}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No managedFields available.</p>
                  )}
                </section>
              </div>
            ) : (
              <div className="empty-state">
                <h3>Select a resource</h3>
                <p>Choose a node from the list or graph to inspect labels, relations and field managers.</p>
              </div>
            )}
          </aside>
        </main>
      ) : (
        <main className="empty-state">
          <h2>Waiting for cluster data</h2>
        </main>
      )}
    </div>
  );
}
