# Development Kubernetes manifests

This directory contains development-only Kubernetes manifests for running Kausal in a local Kubernetes cluster.

These files are intentionally not a production baseline:

- RBAC is reduced, but still optimized for local cluster introspection.
- Access is expected through `kubectl port-forward` during development.
- The optional ingress is for local development convenience only.
- Secret nodes are inferred from workload references and are not fetched from the Kubernetes API.

Apply the development manifests in this order:

```bash
kubectl apply -f deploy/dev/k8s/namespace.yaml
kubectl apply -f deploy/dev/k8s/serviceaccount.yaml
kubectl apply -f deploy/dev/k8s/clusterrole.yaml
kubectl apply -f deploy/dev/k8s/clusterrolebinding.yaml
kubectl apply -f deploy/dev/k8s/deployment.yaml
kubectl apply -f deploy/dev/k8s/service.yaml
kubectl apply -f deploy/dev/k8s/networkpolicy.yaml
```

Optional ingress:

```bash
kubectl apply -f deploy/dev/k8s/ingress.yaml
```
