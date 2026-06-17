IMAGE ?= kausal:dev
NAMESPACE ?= kausal
APP ?= kausal
PORT ?= 8080
KUBE_CONTEXT ?=
KUBECTL := kubectl $(if $(KUBE_CONTEXT),--context $(KUBE_CONTEXT),)

.PHONY: install build dev-server dev-client docker-build \
	k8s-apply k8s-apply-ingress k8s-rollout port-forward \
	logs health rbac-check

install:
	npm install

build:
	npm run build

dev-server:
	npm run dev:server

dev-client:
	npm run dev:client

docker-build:
	docker build -t $(IMAGE) .

k8s-apply:
	$(KUBECTL) apply -f deploy/dev/k8s/namespace.yaml
	$(KUBECTL) apply -f deploy/dev/k8s/serviceaccount.yaml
	$(KUBECTL) apply -f deploy/dev/k8s/clusterrole.yaml
	$(KUBECTL) apply -f deploy/dev/k8s/clusterrolebinding.yaml
	$(KUBECTL) apply -f deploy/dev/k8s/deployment.yaml
	$(KUBECTL) apply -f deploy/dev/k8s/service.yaml
	$(KUBECTL) apply -f deploy/dev/k8s/networkpolicy.yaml

k8s-apply-ingress:
	$(KUBECTL) apply -f deploy/dev/k8s/ingress.yaml

k8s-rollout:
	$(KUBECTL) -n $(NAMESPACE) rollout status deployment/$(APP)

port-forward:
	$(KUBECTL) -n $(NAMESPACE) port-forward svc/$(APP) $(PORT):8080

logs:
	$(KUBECTL) -n $(NAMESPACE) logs deployment/$(APP)

health:
	curl http://localhost:$(PORT)/api/healthz

rbac-check:
	$(KUBECTL) auth can-i list pods --as=system:serviceaccount:$(NAMESPACE):$(APP) --all-namespaces
	$(KUBECTL) auth can-i list deployments.apps --as=system:serviceaccount:$(NAMESPACE):$(APP) --all-namespaces
	$(KUBECTL) auth can-i list secrets --as=system:serviceaccount:$(NAMESPACE):$(APP) --all-namespaces
	$(KUBECTL) auth can-i list ingresses.networking.k8s.io --as=system:serviceaccount:$(NAMESPACE):$(APP) --all-namespaces
	$(KUBECTL) auth can-i list horizontalpodautoscalers.autoscaling --as=system:serviceaccount:$(NAMESPACE):$(APP) --all-namespaces
