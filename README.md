# Kausal

Kausal is a local-first Kubernetes visualization tool that explains why resources look the way they do by combining ownership, selector, exposure, ingress, scaling, reference, and `managedFields` data into a single graph.

Kausal is published on GitHub under the MIT License.

## Architecture

- `apps/server/`: Express API in TypeScript. It reads supported Kubernetes resources with a read-only ServiceAccount, derives graph edges, summarizes `managedFields`, and exposes the API.
- `apps/client/`: React app with a three-column layout: resource list, graph canvas, detail panel.
- `deploy/dev/k8s/`: Development-only Kubernetes manifests for a local Kubernetes cluster.
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
- Secret references inferred from workloads
- HorizontalPodAutoscaler

## Derived relationships

- `owns`
- `selects`
- `exposes`
- `scales`
- `references`
- `ingress-routes-to`

## Assumptions

- The primary run mode is inside Kubernetes. The app is intended to run in a local Kubernetes cluster and read the cluster through its ServiceAccount.
- The manifests in `deploy/dev/k8s/` are for development only. They are intentionally local-cluster oriented and not a production deployment baseline.
- Secret contents and Secret metadata are never returned by the API or rendered in the UI. Secret nodes are inferred from workload references instead of being fetched from the Kubernetes API.
- The initial graph layout is deterministic and simple. It is meant for comprehension, not for perfect graph aesthetics.
- Ingress is optional because local Ingress availability depends on the local cluster setup.

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

## Release flow

Pushing a Git tag triggers the GitHub release workflow in `.github/workflows/release.yml`.

The workflow:

- builds the root `Dockerfile`
- pushes the image to `ghcr.io/vquie/kausal` with version aliases
- creates a GitHub release
- generates release notes from the changes since the previous tag

Supported release tags:

- `v1.2.3`
- `1.2.3`

For either form, the workflow publishes:

- `v1.2.3`
- `v1.2`
- `v1`
- `1.2.3`
- `1.2`
- `1`
- `latest`

Example:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Make the image available to the local Kubernetes cluster

Some local Kubernetes setups expose the local Docker image store directly to the cluster. If your environment uses the same image store, no extra import step is needed after `docker build`.

If the Pod cannot pull `kausal:dev`, rebuild and confirm the image exists locally:

```bash
docker images | grep kausal
```

## Deploy to Kubernetes

Apply the manifests:

```bash
kubectl apply -f deploy/dev/k8s/namespace.yaml
kubectl apply -f deploy/dev/k8s/serviceaccount.yaml
kubectl apply -f deploy/dev/k8s/clusterrole.yaml
kubectl apply -f deploy/dev/k8s/clusterrolebinding.yaml
kubectl apply -f deploy/dev/k8s/deployment.yaml
kubectl apply -f deploy/dev/k8s/service.yaml
kubectl apply -f deploy/dev/k8s/networkpolicy.yaml
```

Optional Ingress:

```bash
kubectl apply -f deploy/dev/k8s/ingress.yaml
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
kubectl auth can-i list ingresses.networking.k8s.io --as=system:serviceaccount:kausal:kausal --all-namespaces
kubectl auth can-i list horizontalpodautoscalers.autoscaling --as=system:serviceaccount:kausal:kausal --all-namespaces
```

If `/api/healthz` returns an error, verify:

- The `kausal` ServiceAccount is mounted into the Pod.
- The ClusterRoleBinding points to `kausal/kausal`.
- The local cluster actually exposes the Kubernetes API to in-cluster Pods.
- The image tag in `deploy/dev/k8s/deployment.yaml` matches the image you built locally.
