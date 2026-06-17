import { buildGraph, focusGraph } from "./graph.js";
import { createKubeClients } from "./kube.js";
import type { GraphResponse, ResourcesResponse } from "./types.js";

interface SnapshotOptions {
  namespace?: string;
  focusId?: string;
  depth?: number;
  limit?: number;
}

interface CacheEntry {
  graph: GraphResponse;
  expiresAt: number;
}

const CACHE_TTL_MS = 10_000;

export class ResourceService {
  private readonly clients = createKubeClients();

  private readonly snapshotCache = new Map<string, CacheEntry>();

  private unwrapItems<T>(result: { items?: T[]; body?: { items?: T[] } }): T[] {
    if (Array.isArray(result.items)) {
      return result.items;
    }
    if (Array.isArray(result.body?.items)) {
      return result.body.items;
    }
    return [];
  }

  private async loadResources(namespace?: string) {
    if (namespace) {
      const [
        deployments,
        replicaSets,
        pods,
        services,
        ingresses,
        configMaps,
        hpas
      ] = await Promise.all([
        this.clients.appsApi.listNamespacedDeployment({ namespace }),
        this.clients.appsApi.listNamespacedReplicaSet({ namespace }),
        this.clients.coreApi.listNamespacedPod({ namespace }),
        this.clients.coreApi.listNamespacedService({ namespace }),
        this.clients.networkingApi.listNamespacedIngress({ namespace }),
        this.clients.coreApi.listNamespacedConfigMap({ namespace }),
        this.clients.autoscalingApi.listNamespacedHorizontalPodAutoscaler({ namespace })
      ]);

      return {
        namespaces: [],
        deployments: this.unwrapItems(deployments),
        replicaSets: this.unwrapItems(replicaSets),
        pods: this.unwrapItems(pods),
        services: this.unwrapItems(services),
        ingresses: this.unwrapItems(ingresses),
        configMaps: this.unwrapItems(configMaps),
        secrets: [],
        hpas: this.unwrapItems(hpas)
      };
    }

    const [namespaces, deployments, replicaSets, pods, services, ingresses, configMaps, hpas] =
      await Promise.all([
        this.clients.coreApi.listNamespace(),
        this.clients.appsApi.listDeploymentForAllNamespaces(),
        this.clients.appsApi.listReplicaSetForAllNamespaces(),
        this.clients.coreApi.listPodForAllNamespaces(),
        this.clients.coreApi.listServiceForAllNamespaces(),
        this.clients.networkingApi.listIngressForAllNamespaces(),
        this.clients.coreApi.listConfigMapForAllNamespaces(),
        this.clients.autoscalingApi.listHorizontalPodAutoscalerForAllNamespaces()
      ]);

    return {
      namespaces: this.unwrapItems(namespaces),
      deployments: this.unwrapItems(deployments),
      replicaSets: this.unwrapItems(replicaSets),
      pods: this.unwrapItems(pods),
      services: this.unwrapItems(services),
      ingresses: this.unwrapItems(ingresses),
      configMaps: this.unwrapItems(configMaps),
      secrets: [],
      hpas: this.unwrapItems(hpas)
    };
  }

  private cacheKey(namespace?: string) {
    return namespace ?? "__all__";
  }

  private async fullSnapshot(namespace?: string): Promise<GraphResponse> {
    const key = this.cacheKey(namespace);
    const cached = this.snapshotCache.get(key);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.graph;
    }

    const graph = buildGraph(await this.loadResources(namespace));
    this.snapshotCache.set(key, {
      graph,
      expiresAt: now + CACHE_TTL_MS
    });
    return graph;
  }

  async snapshot(options: SnapshotOptions = {}) {
    const graph = await this.fullSnapshot(options.namespace);
    return focusGraph(graph, options.focusId, options.depth ?? 1, options.limit ?? 80);
  }

  async getResources(namespace?: string): Promise<ResourcesResponse> {
    const graph = await this.fullSnapshot(namespace);
    return {
      resources: graph.nodes,
      generatedAt: graph.generatedAt,
      warnings: graph.warnings
    };
  }

  async getResource(namespace: string, kind: string, name: string) {
    const normalizedNamespace = namespace === "_cluster" ? undefined : namespace;
    const graph = await this.fullSnapshot(normalizedNamespace);
    return graph.nodes.find(
      (node) => node.kind.toLowerCase() === kind.toLowerCase() && node.name === name && node.namespace === (normalizedNamespace ?? null)
    );
  }
}
