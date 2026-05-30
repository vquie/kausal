IMAGE ?= kausal:dev
NAMESPACE ?= kausal
APP ?= kausal
PORT ?= 8080

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
	kubectl apply -f k8s/namespace.yaml
	kubectl apply -f k8s/serviceaccount.yaml
	kubectl apply -f k8s/clusterrole.yaml
	kubectl apply -f k8s/clusterrolebinding.yaml
	kubectl apply -f k8s/deployment.yaml
	kubectl apply -f k8s/service.yaml

k8s-apply-ingress:
	kubectl apply -f k8s/ingress.yaml

k8s-rollout:
	kubectl -n $(NAMESPACE) rollout status deployment/$(APP)

port-forward:
	kubectl -n $(NAMESPACE) port-forward svc/$(APP) $(PORT):8080

logs:
	kubectl -n $(NAMESPACE) logs deployment/$(APP)

health:
	curl http://localhost:$(PORT)/api/healthz

rbac-check:
	kubectl auth can-i list pods --as=system:serviceaccount:$(NAMESPACE):$(APP) --all-namespaces
	kubectl auth can-i list deployments.apps --as=system:serviceaccount:$(NAMESPACE):$(APP) --all-namespaces
	kubectl auth can-i list secrets --as=system:serviceaccount:$(NAMESPACE):$(APP) --all-namespaces
	kubectl auth can-i list ingresses.networking.k8s.io --as=system:serviceaccount:$(NAMESPACE):$(APP) --all-namespaces
	kubectl auth can-i list horizontalpodautoscalers.autoscaling --as=system:serviceaccount:$(NAMESPACE):$(APP) --all-namespaces
