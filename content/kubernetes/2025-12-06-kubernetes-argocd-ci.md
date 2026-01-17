---
title: "[Kubernetes CI/CD] ArgoCD + CI with Github Actions and Kind"
description: "Github Actions 및 Kind를 통한 쿠버네티스 ArgoCD CI(Continuous integration) 구성하기"
slug: "2025-12-06-kubernetes-argocd-ci"
author: yulmwu
date: 2025-12-06T09:52:15.245Z
updated_at: 2026-01-15T00:55:27.229Z
categories: ["Kubernetes"]
tags: ["CI/CD", "argocd", "kubernetes"]
series:
  name: Kubernetes
  slug: kubernetes
thumbnail: ../../thumbnails/kubernetes/kubernetes-argocd-ci.png
linked_posts:
  previous: 2025-12-06-kubernetes-gitops-argocd
  next: 
is_private: false
---

# 0. Overview

ArgoCD에 대해선 아래의 포스팅을 참고하길 바라며, 따로 설명하진 않는다. 간략히 요약하자면 Git을 기반 하는 GitOps의 쿠버네티스 CD 도구이다.

https://velog.io/@yulmwu/kubernetes-gitops-argocd

![](https://velog.velcdn.com/images/yulmwu/post/7248b32c-9fa4-4d97-801f-e6db7e49794f/image.png)

이 포스팅에선 실제로 운영하는 클러스터에 배포하는 CD(ArgoCD가 그걸 대신 해주는 것이다)가 아닌 배포 전 Helm 차트 등에 문제가 있는지, Sync가 잘 되는지, 그리고 애플리케이션이 잘 동작하는지 Health Check 등을 수행하는 **CI(Continuous integration)**를 구축해보겠다. 

그렇게 되면 전 포스팅과 더불어 대략적인 GitOps CI/CD 파이프라인을 구축하게 되는 것이다. 이 포스팅에선 Kustomize가 아닌 Helm Chart를 예제로 사용한다.

## 0-1. Architecture Diagram

![](https://velog.velcdn.com/images/yulmwu/post/e4a5fc35-f91c-4875-a1c4-009f9c0a1cb6/image.png)

아키텍처에 있는 흐름을 해석하면 크게 아래와 같다.

1. main 브랜치에 Push 되었거나, PR(Pull Requests)이 생성되었을 경우 CI 워크플로우가 트리거된다. _(이때 프로덕션 클러스터의 ArgoCD가 바라보는 소스 레포지토리와 겹치면 안되므로, CI 전용 별도의 레포지토리로 분리하는 등의 방법이 있다. 이 경우 CI가 성공적으로 끝났다면 ArgoCD가 바라보는 소스 레포지토리에 PR을 날리고 Merge하면 된다.)_
2. 임시적인 CI 전용 쿠버네티스 클러스터(**Kind**)를 만든다.
3. 클러스터에 **ArgoCD를 설치**하고 **Application CRD를 적용**한 다음, **Sync를 시도**한다.
4. 마지막으로 **kubectl** 또는 ArgoCD CLI 등을 사용하여 **Sync가 잘 되었는지**, 애플리케이션이 **Healthy한지** 등을 확인한다. _(이 포스팅에서는 전자를 사용하겠다.)_

물론 이 방법이 정답인것도 아니고, 다른 솔루션이 많지만 최소한의 리소스로 간략하게 CI를 구축하고 테스트해보기 위해 위와 같이 구성하였다. _(예시로 Kind가 아닌 개발/스테이징 환경에서 직접 테스트하는 CI를 구축할 수 도 있는 것이다.)_

## 0-2. What is Kubernetes Kind?

**Kind**(정확히는 Kubernetes in Docker=KinD)는 이름 그대로 Docker 컨테이너 위에서 가볍게 쿠버네티스 클러스터를 생성할 수 있는 도구이다.

Minikube나 K3s와는 다르게 노드마다 호스트에 VM을 만드는 것이 아닌 Docker 컨테이너를 노드처럼 취급하면서 쿠버네티스를 구동한다. 

때문에 매우 가벼워서 CI 파이프라인에 쓰기에 매우 최적화되어 있고, e2e 테스트 환경에서도 쓰이는데, 다만 노드가 호스트가 아닌 Docker 컨테이너로 구동되기 때문에 네트워크 구성이나 로드밸런서 등의 일부 영역에서는 컨테이너 기반 아키텍처 특유의 제한이 있을 수 있다. 

# 1. Practice — Helm Chart

> 실습에 있어, 이 포스팅에선 프로덕션 또는 스테이징 환경을 구성하는 실습이 아니다.
> 
> 그건 이전 포스팅의 내용이니 참고를 바라며, 이 포스팅에선 Github Actions Workflows를 작성하는 것이 주된 실습이다.

먼저 ArgoCD가 바라보며 배포할 Helm Chart 소스를 만들어보겠다. Kustomize나 도구 없이 생으로 매니페스트를 만들어 테스트 할 수 있지만 이 포스팅에선 Helm Chart를 만들도록 하겠다.

프로젝트 파일 구조는 아래와 같다.

```
.
├── .github
│   └── workflows
│       └── ci-argocd-kind.yaml
├── charts
│   └── demo-app
│       ├── Chart.yaml
│       ├── values.yaml
│       └── templates
│           ├── _helpers.yaml
│           ├── deployment.yaml
│           └── service.yaml
└── argocd
    └── application.yaml
```

Helm Chart 및 애플리케이션 매니페스트에 대한 설명은 따로 하지 않겠다.

```yaml
# charts/demo-app/Chart.yaml

apiVersion: v2
name: demo-app
description: A demo application
type: application
version: 0.1.0
appVersion: "1.0.0"
```

```yaml
# charts/demo-app/values.yaml

replicaCount: 1
image:
  repository: nginx
  tag: "1.25"
  pullPolicy: IfNotPresent
service:
  type: ClusterIP
  port: 80
podAnnotations: {}
resources: {}
nodeSelector: {}
tolerations: []
affinity: {}
```

```yaml
# charts/demo-app/templates/_helpers.yaml

{{- define "demo-app.name" -}}
  {{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{- define "demo-app.fullname" -}}
  {{- if .Values.fullnameOverride }}
    {{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
  {{- else }}
    {{- $name := include "demo-app.name" . -}}
    {{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
  {{- end }}
{{- end }}
```

```yaml
# charts/demo-app/templates/deployment.yaml

apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "demo-app.fullname" . }}
  labels:
    app.kubernetes.io/name: {{ include "demo-app.name" . }}
    app.kubernetes.io/instance: {{ .Release.Name }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app.kubernetes.io/name: {{ include "demo-app.name" . }}
      app.kubernetes.io/instance: {{ .Release.Name }}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: {{ include "demo-app.name" . }}
        app.kubernetes.io/instance: {{ .Release.Name }}
      annotations:
        {{- with .Values.podAnnotations }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
    spec:
      containers:
        - name: {{ include "demo-app.name" . }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - containerPort: 80
              name: http
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
```

```yaml
# charts/demo-app/templates/service.yaml

apiVersion: v1
kind: Service
metadata:
  name: demo-app
spec:
  selector:
    app: demo-app
  ports:
    - name: http
      port: {{ .Values.service.port }}
      targetPort: 80
  type: {{ .Values.service.type }}
```

그리고 아래는 ArgoCD Application CRD인데, 각자의 Git 레포지토리(예: 깃허브) 주소를 지정하면 된다.

```yaml
# argocd/application.yaml

apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: demo-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/<OWNER/REPO>.git
    targetRevision: HEAD # 또는 main 등
    path: charts/demo-app
    helm:
      releaseName: demo-app
  destination:
    server: https://kubernetes.default.svc
    namespace: demo-app
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

필자는 아래와 같은 주소와 `main` 브랜치를 사용하니 아래와 같이 명시해주었다. 다만 `.github/workflows`는 그대로 루트 디렉토리에 둬야한다.

_(별개의 깃 레포지토리 서버가 있거나 비공개 레포지토리인 경우일 때 repo-creds 설정은 알아서 찾아보길 바란다.)_

```yaml
# spec:
  source:
    repoURL: https://github.com/yulmwu/blog-example-demo.git
    targetRevision: main
    path: k8s-argocd-ci-example/charts/demo-app
    helm:
      releaseName: demo-app
```

# 2. Practice — Github Actions Workflows

![](https://velog.velcdn.com/images/yulmwu/post/b0c7ccad-8c33-4fae-b4f7-a160ead3d346/image.png)

이제 Helm Chart를 만들었으니, 이를 Github Actions에서 Kind 클러스터를 만들고 CI를 구축해보자. 그 흐름은 `0. Overview` 목차에서 다뤘으니 생략하겠다.

## 2-1. Trigger `on`

아래와 같이 `main` 브랜치에 Push 되거나 PR이 왔을때만 트리거되어 워크플로우가 실행되도록 한다.

```yaml
name: ArgoCD CI with Kind

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]
```

## 2-2. kubectl, Kind Installation

포스팅을 작성하는 시점 쿠버네티스 1.33을 사용하므로 kubectl 및 Kind 클러스터 또한 1.33으로 맞춰주겠다.

```yaml
jobs:
  argocd-kind-test:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up kubectl
        uses: azure/setup-kubectl@v4
        with:
          version: 'latest'

      - name: Set up kind
        uses: helm/kind-action@v1
        with:
          cluster_name: argocd-ci-cluster
          kubectl_version: 'v1.33.0'
```

## 2-3. ArgoCD Installation

ArgoCD는 공식적으로 제공하는 설치용 매니페스트를 사용하겠다. 사용하는 쿠버네티스 버전에 따라 버전을 고정해야 될 수 있다.

```yaml
      - name: Install ArgoCD
        run: |
          kubectl create namespace argocd
          kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

      - name: Wait for ArgoCD components to be ready
        run: |
          kubectl wait --namespace argocd \
            --for=condition=Available deployment/argocd-redis \
            --timeout=120s
          kubectl wait --namespace argocd \
            --for=condition=Available deployment/argocd-server \
            --timeout=120s
          kubectl wait --namespace argocd \
            --for=condition=Available deployment/argocd-repo-server \
            --timeout=120s
          kubectl wait --namespace argocd \
            --for=condition=Available deployment/argocd-dex-server \
            --timeout=120s
          kubectl wait --namespace argocd \
            --for=condition=Available deployment/argocd-applicationset-controller \
            --timeout=120s
          kubectl wait --namespace argocd \
            --for=condition=Available deployment/argocd-notifications-controller \
            --timeout=120s
```

ArgoCD 설치가 완료될 때 까지 기다리는 명령을 주었다. Deployment를 기준으로 확인하며 이름이 바뀔 수 있으니 참고하자.

## 2-4. ArgoCD Application CRD Apply

ArgoCD Application CRD를 적용한다. 필자는 아래와 같이 적용했지만, 실습을 따라한다면 경로가 다를 것이다.

```yaml
      - name: Apply ArgoCD Application
        run: |
          kubectl apply -f k8s-argocd-ci-example/argocd/application.yaml
```

## 2-5. Sync/Health Check

여기부턴 이 실습을 위해 작성된 쉘 스크립트인데, 필요에 따라 직접 수정해도 된다. 필자는 간단하게 kubectl로 상태를 Polling 하고, ArgoCD 애플리케이션이 Sync/Healthy 한지 체크한다. 

추가적으로 Deployment나 다른 리소스를 wait하여 체크해볼 수 도 있고, 애플리케이션으로 직접 요청을 보내 확인해볼 수 도 있을 것이다.

```yaml
      - name: Wait for ArgoCD Application Sync & Healthy
        run: |
          APP_NAME="demo-app"
          NAMESPACE="argocd"

          echo "Waiting for ArgoCD Application/${APP_NAME} to be Synced and Healthy..."

          for i in {1..10}; do
            SYNC_STATUS=$(kubectl get application ${APP_NAME} -n ${NAMESPACE} -o jsonpath='{.status.sync.status}' || echo "Unknown")
            HEALTH_STATUS=$(kubectl get application ${APP_NAME} -n ${NAMESPACE} -o jsonpath='{.status.health.status}' || echo "Unknown")

            echo "Try ${i}: sync=${SYNC_STATUS}, health=${HEALTH_STATUS}"

            if [ "$SYNC_STATUS" = "Synced" ] && [ "$HEALTH_STATUS" = "Healthy" ]; then
              echo "Application is Synced and Healthy"
              exit 0
            fi

            sleep 5
          done

          echo "Application did not become Synced/Healthy in time"
          kubectl get application ${APP_NAME} -n ${NAMESPACE} -o yaml || true
          kubectl get pods -A || true

          exit 1
          
      - name: Clean up
        if: always()
        run: |
          kind delete cluster --name argocd-ci-cluster
```

여태까지의 YAML을 `.github/workflows/ci-argocd-kind.yaml`에 저장하고 Push  해보자. 
(필자의 [blog-example-demo 레포지토리](https://github.com/yulmwu/blog-example-demo)에 가보면 해당 파일이 루트에 없는데, 테스트 후 `k8s-argocd-ci-example/_.git/...`으로 옮겨두었다.)

# 3. Testing

테스트 방법은 간단하다. 트리거에 구성한대로 `main` 브랜치에 Push 하거나 PR을 날려보면 된다. 그럼 아래와 같이 Workflows가 실행되는 것을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/1c6a793f-40f7-41cc-b571-0829ce8ee13d/image.png)

몇 분 정도 기다려서 잘 동작하는지 확인해보자.

![](https://velog.velcdn.com/images/yulmwu/post/ee81e8f5-3b74-4bf7-9662-be2407514fdd/image.png)

잘 되는 모습을 볼 수 있다. 여기서 `Wait for ArgoCD ...`를 확인해보면 

![](https://velog.velcdn.com/images/yulmwu/post/93d8b16c-ffbc-4826-8908-7f22deb50012/image.png)


이렇게 3번째 시도, 11초만에 Sync와 Healthy까지 확인이 되는 모습을 볼 수 있는데, 만약 리소스가 많아 오래 걸릴 경우 적절히 스크립트를 수정하면 된다.