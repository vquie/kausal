import fs from "node:fs";
import https from "node:https";
import { URL } from "node:url";
import * as k8s from "@kubernetes/client-node";

const IN_CLUSTER_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";
const IN_CLUSTER_CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
const IN_CLUSTER_NAMESPACE_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/namespace";

export interface SecretMetadataItem {
  apiVersion: string;
  kind: string;
  metadata: {
    name?: string;
    namespace?: string;
    uid?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: Array<{
      apiVersion?: string;
      kind?: string;
      name?: string;
      uid?: string;
      controller?: boolean;
    }>;
    managedFields?: unknown[];
  };
}

interface PartialListResponse {
  apiVersion?: string;
  kind?: string;
  items?: SecretMetadataItem[];
}

export function createKubeClients() {
  const kc = new k8s.KubeConfig();
  try {
    kc.loadFromCluster();
  } catch {
    kc.loadFromDefault();
  }

  return {
    kc,
    appsApi: kc.makeApiClient(k8s.AppsV1Api),
    coreApi: kc.makeApiClient(k8s.CoreV1Api),
    networkingApi: kc.makeApiClient(k8s.NetworkingV1Api),
    autoscalingApi: kc.makeApiClient(k8s.AutoscalingV2Api)
  };
}

function readIfExists(path: string) {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function buildRequestOptions(kc: k8s.KubeConfig, path: string) {
  const cluster = kc.getCurrentCluster();
  const user = kc.getCurrentUser();
  if (!cluster) {
    throw new Error("No Kubernetes cluster configured.");
  }

  const baseUrl = new URL(cluster.server);
  const isInCluster = Boolean(process.env.KUBERNETES_SERVICE_HOST) && fs.existsSync(IN_CLUSTER_TOKEN_PATH);
  const token =
    (isInCluster ? readIfExists(IN_CLUSTER_TOKEN_PATH)?.trim() : undefined) ??
    user?.token ??
    process.env.KAUSAL_K8S_BEARER_TOKEN;

  const clusterCa = cluster.caData?.length ? Buffer.from(cluster.caData, "base64").toString("utf8") : undefined;
  const ca = (isInCluster ? readIfExists(IN_CLUSTER_CA_PATH) : undefined) ?? clusterCa;

  return {
    hostname: baseUrl.hostname,
    port: Number(baseUrl.port || 443),
    protocol: baseUrl.protocol,
    path,
    headers: {
      Accept: "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1,application/json",
      Authorization: token ? `Bearer ${token}` : undefined
    },
    ca,
    rejectUnauthorized: true
  };
}

function httpsGetJson<T>(options: ReturnType<typeof buildRequestOptions>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: options.protocol,
        hostname: options.hostname,
        port: options.port,
        path: options.path,
        method: "GET",
        ca: options.ca,
        rejectUnauthorized: options.rejectUnauthorized,
        headers: Object.fromEntries(Object.entries(options.headers).filter(([, value]) => Boolean(value)))
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Secret metadata request failed with status ${res.statusCode}: ${body}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

export async function listSecretMetadata(kc: k8s.KubeConfig, namespace?: string): Promise<SecretMetadataItem[]> {
  const path = namespace ? `/api/v1/namespaces/${namespace}/secrets` : "/api/v1/secrets";
  const options = buildRequestOptions(kc, path);
  const response = await httpsGetJson<PartialListResponse>(options);
  return response.items ?? [];
}
