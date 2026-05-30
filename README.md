# Kausal MVP

Kausal is a local-first Kubernetes visualization MVP that explains why resources look the way they do by combining ownership, selector, exposure, ingress, scaling, reference, and `managedFields` data into a single graph.

## Architecture

- `server/`: Express API in TypeScript. It reads supported Kubernetes resources with a read-only ServiceAccount, derives graph edges, summarizes `managedFields`, and exposes the MVP API.
- `client/`: React app with a three-column layout: resource list, graph canvas, detail panel.
- `k8s/`: Plain Kubernetes manifests for OrbStack or another local cluster.
- `Dockerfile`: Multi-stage Node build that serves the built React app from the backend container.

The backend supports:

- `GET /api/healthz`
- `GET /api/resources`
- `GET /api/graph`
- `GET /api/resource/:namespace/:kind/:name`

## Supported resources

- Namespace
- Deployment
- ReplicaSet
- Pod
- Service
- Ingress
- ConfigMap
- Secret metadata only
- HorizontalPodAutoscaler

## Derived relationships

- `owns`
- `selects`
- `exposes`
- `scales`
- `references`
- `ingress-routes-to`

## Assumptions

- The primary run mode is inside Kubernetes. The app is intended to run in OrbStack Kubernetes and read the cluster through its ServiceAccount.
- Secret contents are never returned by the API or rendered in the UI. The backend fetches Secret metadata via the Kubernetes metadata-only representation.
- The initial graph layout is deterministic and simple. It is meant for comprehension, not for perfect graph aesthetics.
- Ingress is optional because local Ingress availability depends on the OrbStack setup.

## Local development

Install dependencies:

```bash
npm install
```

Run the backend:

```bash
npm run dev:server
```

Run the frontend:

```bash
npm run dev:client
```

The Vite frontend proxies `/api` to `http://localhost:8080`.

## Build the image

From the repository root:

```bash
docker build -t kausal:dev .
```

## Make the image available to OrbStack Kubernetes

OrbStack usually exposes the local Docker image store directly to its Kubernetes cluster. If your local OrbStack setup uses the same image store, no extra import step is needed after `docker build`.

If the Pod cannot pull `kausal:dev`, rebuild and confirm the image exists locally:

```bash
docker images | grep kausal
```

## Deploy to Kubernetes

Apply the manifests:

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/serviceaccount.yaml
kubectl apply -f k8s/clusterrole.yaml
kubectl apply -f k8s/clusterrolebinding.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

Optional Ingress:

```bash
kubectl apply -f k8s/ingress.yaml
```

Check rollout:

```bash
kubectl -n kausal rollout status deployment/kausal
kubectl -n kausal get pods
```

## Access the app

Use port-forwarding:

```bash
kubectl -n kausal port-forward svc/kausal 8080:8080
```

Then open:

```text
http://localhost:8080
```

## Troubleshooting

Check logs:

```bash
kubectl -n kausal logs deployment/kausal
```

Check health:

```bash
kubectl -n kausal port-forward svc/kausal 8080:8080
curl http://localhost:8080/api/healthz
```

Check RBAC:

```bash
kubectl auth can-i list pods --as=system:serviceaccount:kausal:kausal --all-namespaces
kubectl auth can-i list deployments.apps --as=system:serviceaccount:kausal:kausal --all-namespaces
kubectl auth can-i list secrets --as=system:serviceaccount:kausal:kausal --all-namespaces
kubectl auth can-i list ingresses.networking.k8s.io --as=system:serviceaccount:kausal:kausal --all-namespaces
kubectl auth can-i list horizontalpodautoscalers.autoscaling --as=system:serviceaccount:kausal:kausal --all-namespaces
```

If `/api/healthz` returns an error, verify:

- The `kausal` ServiceAccount is mounted into the Pod.
- The ClusterRoleBinding points to `kausal/kausal`.
- The local cluster actually exposes the Kubernetes API to in-cluster Pods.
- The image tag in [k8s/deployment.yaml](/Users/vitaliquiering/Documents/Kausal/k8s/deployment.yaml:1) matches the image you built locally.
