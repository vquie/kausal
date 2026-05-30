import * as k8s from "@kubernetes/client-node";
import { buildGraph } from "./graph.js";
import { createKubeClients, listSecretMetadata } from "./kube.js";

export class ResourceService {
  private readonly clients = createKubeClients();

  private unwrapItems<T>(result: { items?: T[]; body?: { items?: T[] } }): T[] {
    if (Array.isArray(result.items)) {
      return result.items;
    }
    if (Array.isArray(result.body?.items)) {
      return result.body.items;
    }
    return [];
  }

  async snapshot() {
    const [namespaces, deployments, replicaSets, pods, services, ingresses, configMaps, secrets, hpas] =
      await Promise.all([
        this.clients.coreApi.listNamespace(),
        this.clients.appsApi.listDeploymentForAllNamespaces(),
        this.clients.appsApi.listReplicaSetForAllNamespaces(),
        this.clients.coreApi.listPodForAllNamespaces(),
        this.clients.coreApi.listServiceForAllNamespaces(),
        this.clients.networkingApi.listIngressForAllNamespaces(),
        this.clients.coreApi.listConfigMapForAllNamespaces(),
        listSecretMetadata(this.clients.kc),
        this.clients.autoscalingApi.listHorizontalPodAutoscalerForAllNamespaces()
      ]);

    return buildGraph({
      namespaces: this.unwrapItems(namespaces),
      deployments: this.unwrapItems(deployments),
      replicaSets: this.unwrapItems(replicaSets),
      pods: this.unwrapItems(pods),
      services: this.unwrapItems(services),
      ingresses: this.unwrapItems(ingresses),
      configMaps: this.unwrapItems(configMaps),
      secrets,
      hpas: this.unwrapItems(hpas)
    });
  }

  async getResources() {
    const graph = await this.snapshot();
    return {
      resources: graph.nodes,
      generatedAt: graph.generatedAt,
      warnings: graph.warnings
    };
  }

  async getResource(namespace: string, kind: string, name: string) {
    const graph = await this.snapshot();
    const normalizedNamespace = namespace === "_cluster" ? null : namespace;
    return graph.nodes.find(
      (node) => node.kind.toLowerCase() === kind.toLowerCase() && node.name === name && node.namespace === normalizedNamespace
    );
  }
}
