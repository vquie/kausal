import * as k8s from "@kubernetes/client-node";

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
