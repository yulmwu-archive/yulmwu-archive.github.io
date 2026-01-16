---
title: "[Kubernetes CI/CD] GitOps with ArgoCD (Kustomize Demo) "
description: "ArgoCD를 통한 쿠버네티스 GitOps 구성 및 Kustomize 배포"
slug: "2025-10-03-kubernetes-gitops-argocd"
author: yulmwu
date: 2025-10-03T12:07:32.658Z
updated_at: 2026-01-14T19:37:48.649Z
categories: ["Kubernetes"]
tags: ["CI/CD", "argocd", "kubernetes"]
series:
    name: Kubernetes
    slug: kubernetes
thumbnail: ../../thumbnails/kubernetes/kubernetes-gitops-argocd.png
linked_posts:
    previous: 2025-10-03-kubernetes-gc-ownerreferences-finalizer
    next: 2025-10-03-kubernetes-argocd-ci
is_private: false
---

# 0. Overview

한가지 시나리오를 들어보자. 쿠버네티스 인프라 매니페스트 파일을 깃 레포지토리(깃허브 등)에 Push 해두고, 매니페스트를 수정하면 자동으로 동기화되는 방식으로 인프라를 운영한다.

그러기 위해선 크게 2가지의 솔루션이 있을 것이다.

1. 깃 레포지토리 CI/CD 워크플로우(Github Actions 등)에서 `kubectl apply` (Git Repository → CI/CD → K8s 순서로 Push)
2. 클러스터에서 깃 레포지토리를 Pull, 자동으로 상태에 반영

먼저 첫번째 경우를 보자. 아래와 같이 동작할 수 있을 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/9e1d7455-0554-4ff9-b740-e6d463b5ae2c/image.png)

그런데 이러한 방식엔 몇가지 문제가 있다. 아래의 다이어그램을 보자.

![](https://velog.velcdn.com/images/yulmwu/post/38913754-0425-45af-ac22-9c760935126f/image.png)

발생하는 문제는 아래와 같다.

- CI/CD 워크플로우에서 클러스터에 접근하기 위한 엑세스 권한 필요 (AWS EKS 환경 등에선 IAM 권한 등 필요)
- 워크플로우에서 단순히 Push로 클러스터 상태를 적용하기 때문에 감사/추적의 어려움, 즉 레포지토리에서 선언된 상태와 클러스터 상태의 불일치 가능성 있음 (드리프트 발생 시 방치)
- 이전 상태로 롤백의 어려움

물론 클러스터 내에선 따로 설치해야할 Operator나 컨트롤러가 필요하지 않지만, 단점들이 너무 크기 때문에 실사용하기엔 어려움이 있다.

그래서 이번 포스팅에서 다뤄볼 주제인 GitOps가 2번째 방식을 사용한다.

# 1. What is GitOps?

쿠버네티스에서 GitOps는 애플리케이션의 상태(선언적 매니페스트)를 깃 레포지토리에 저장하고, 이를 클러스터에서 Pull하여 자동으로 상태를 동기화하는 DevOps 방법론의 일종이다.

Git의 버전 관리와 협업, Diff 및 롤백 등의 기능을 그대로 사용한 채로 클러스터를 자동으로 동기화하기 때문에 간편한 유지보수가 가능해진다.

![](https://velog.velcdn.com/images/yulmwu/post/99dbbbd6-3e6d-422f-8e5a-20836a7fd736/image.png)

GitOps의 기본적인 원칙은 아래와 같다. (자료마다 다르게 작성되어 있을 순 있지만 기본적인 내용 자체는 비슷하다)

- **Declarative**: 클러스터의 원하는 상태를 깃 레포지토리에 선언적 매니페스트로 저장
- **Versioned and Immutable**: Git을 통한 버전 관리 및 버전 별 불변성, Pull Request 등을 통한 상호 검토로 Human Error 방지
- **Pulled Automatically**: ArgoCD 등의 컨트롤러(에이전트)가 자동으로 깃 레포지토리를 Pull하여 상태 적용
- **Continuously Reconciled**: Git 레포지토리의 선언된 상태에 맞도록 자동 조정(Reconcile)

이러한 GitOps는 레포지토리의 워크플로우가 직접 Push하는 방식의 단점을 모두 커버할 수 있으며, 깃의 뛰어난 버전 관리/협업 기능 덕분에 안정적인 인프라 유지보수 또한 가능해진다.

# 2. What is ArgoCD?

여태까지 몇 번 등장했던 이름으로 유추할 수 있듯이, ArgoCD는 쿠버네티스 GitOps 도구 중 하나이다.

다른 GitOps 도구로 FluxCD 등이 있는데, ArgoCD는 중앙 집중식으로 애플리케이션을 선언하여 클러스터를 관리한다면, FluxCD는 비교적 더 가볍고 실시간으로 동기화하고 모니터링하는데 집중을 둔 도구이다.

이 포스팅에선 ArgoCD를 사용하여 간단하게 GitOps를 맛보고, 추후 기회가 된다면 FluxCD 또한 다뤄보도록 하겠다.

## What is Kustomize?

ArgoCD 및 FluxCD를 포함한 쿠버네티스 GitOps를 다뤄보게 된다면 Helm 또는 Kustomize를 통해 애플리케이션을 깃 레포지토리에 배포하는 아키텍처를 많이 볼 수 있을 것이다.

Helm을 통해 배포하면 여러 리소스를 패키지화 하여 배포 과정을 간소화하고 버전 관리나 롤백 등의 기능으로 일관성 등을 확보할 수 있다.

Kustomize는 쿠버네티스 매니페스트를 커스터마이징하는 도구로, Base 매니페스트를 바탕으로 여러 환경(예: Development, Production) 별로 오버레이를 선언하여 쉽게 리소스를 생성할 수 있게 해준다.

![](https://velog.velcdn.com/images/yulmwu/post/e1df7475-882a-4e48-9a72-47afde572499/image.png)

물론 ArgoCD나 FluxCD를 사용하는데 있어 반드시 Helm 차트 또는 Kustomize를 사용해야 하는 것은 아니다.

바닐라 매니페스트들만 사용하여 GitOps를 운영할 순 있지만 이러한 Helm 차트 또는 Kustomize를 사용하게 될 경우 더욱 더 효율적으로 운영할 수 있기 때문에 자주 사용되고, 이 포스팅에선 간단하게 Kustomize를 사용해볼 것이다.

Kustomize는 kubectl에 기본적으로 내장되어 있어 따로 설치할 필요는 없다.

# 3. Example Demo

정말 간단하게 실습을 해보자. ArgoCD를 사용하여 깃허브 레포지토리에 올라가 있는 Kustomize 예제를 동기화하고, 매니페스트 수정 시 반영이 되는지 확인해보겠다.

## (1) ArgoCD Operator Installation

먼저 ArgoCD Operator를 설치하기 위해 네임스페이스 하나를 만들고 Helm을 통해 설치해주겠다.

```shell
kubectl create namespace argocd

helm repo add argo https://argoproj.github.io/argo-helm
helm repo update
helm install argocd argo/argo-cd \
  --namespace argocd \
  --set server.service.type=NodePort # or LoadBalancer
```

여기서 서비스는 ArgoCD 웹 대시보드를 노출할 서비스를 지정하며, 상황에 맞게 설정하면 된다.

![](https://velog.velcdn.com/images/yulmwu/post/0d087b3f-3f41-4434-8655-a1199a429b38/image.png)

그리고 대시보드에 로그인하기 위한 패스워드를 확인해보자. 대시보드를 통해 애플리케이션을 만들건 아니지만 배포 토폴로지를 확인해보기 위해 사용할 예정이다.

```shell
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d; echo
```

해당 패스워드를 복사해두고, 로컬 환경이라면 아래의 명령어를 통해 포워딩해주자.

```shell
kubectl -n argocd port-forward svc/argocd-server 8080:80
```

![](https://velog.velcdn.com/images/yulmwu/post/517bcd7a-5ef5-427d-b0a6-a42ca592e4f0/image.png)

여기서 Username엔 `admin`, 패스워드는 복사해둔 패스워드를 넣고 로그인해보자.

![](https://velog.velcdn.com/images/yulmwu/post/da578703-d2ca-4011-8916-4ca4d5042c8e/image.png)

그럼 대시보드가 나타나는데, 잠시 후 확인해보록 하고 아래의 ArgoCD CRD 중 하나인 AppProject 매니페스트를 하나 만들어주겠다.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
    name: demo-proj
    namespace: argocd
spec:
    description: "Demo project"
    sourceRepos:
        - "*"
    destinations:
        - namespace: dev
          server: https://kubernetes.default.svc
        - namespace: prod
          server: https://kubernetes.default.svc
    clusterResourceWhitelist:
        - group: "*"
          kind: "*"
```

AppProject를 만들지 않으면 default 프로젝트에 애플리케이션이 만들어지는데, 프로젝트를 따로 만들 수 있다.

다음으로 애플리케이션(Application CRD)을 만들어볼건데, 그 전에 깃허브 레포지토리를 만들어줘야 한다.

## (2) Github Repository, Kustomize

깃허브 레포지토리를 만들어주자.

![](https://velog.velcdn.com/images/yulmwu/post/fc7828f5-4555-4a35-a4e7-bdeafa4b832e/image.png)

그리고 Kustomize 매니페스트를 작성해주겠다. 디렉토리 구조는 아래와 같다.

```
.
├── base
│   ├── deployment.yaml
│   └── kustomization.yaml
└── overlays
    ├── dev
    │   └── kustomization.yaml
    └── prod
        └── kustomization.yaml
```

Base는 각 환경의 Overlay가 사용할 기본 매니페스트로, 일반적인 쿠버네티스 오브젝트를 선언한다. 간단하게 Deployment와 Service를 선언해주었다.

```yaml
# base/deployment.yaml

apiVersion: apps/v1
kind: Deployment
metadata:
    name: demo
    labels: { app: demo }
spec:
    replicas: 1
    selector:
        matchLabels: { app: demo }
    template:
        metadata:
            labels: { app: demo }
        spec:
            containers:
                - name: web
                  image: rlawnsdud/demo
                  ports:
                      - containerPort: 3030
                  env:
                      - name: HOST
                        value: "0.0.0.0"
                      - name: PORT
                        value: "3030"
---
apiVersion: v1
kind: Service
metadata:
    name: demo
    labels: { app: demo }
spec:
    selector: { app: demo }
    ports:
        - name: http
          port: 80
          targetPort: 3030
```

그리고 Kustomize에선 `kustomization.yaml`을 선언하여 해당 Base 또는 Overlay가 사용할 리소스나 관련 설정을 할 수 있다.

```yaml
# base/kustomization.yaml

resources:
    - deployment.yaml
```

다음으로 각 Overlay를 선언해준다. `patches` 필드를 통해 환경 별로 Base 매니페스트의 구성을 오버레이할 수 있다.

```yaml
# overlays/dev/kustomization.yaml

resources:
    - ../../base
namePrefix: dev-
commonLabels:
    env: dev
patches:
    - target:
          kind: Deployment
          name: demo
      patch: |-
          - op: add
            path: /spec/template/spec/containers/0/env/-
            value:
              name: APP_NAME
              value: "Dev"
```

```yaml
# overlays/prod/kustomization.yaml

resources:
    - ../../base
namePrefix: prod-
commonLabels:
    env: prod
patches:
    - target:
          kind: Deployment
          name: demo
      patch: |-
          - op: add
            path: /spec/template/spec/containers/0/env/-
            value:
              name: APP_NAME
              value: "Prod"
```

이렇게 Development 및 Production 환경에 대한 다른 설정을 적용해주었고, 이를 깃허브 레포지토리에 Push 하자.

![](https://velog.velcdn.com/images/yulmwu/post/b58a8a1f-efea-43d8-8e6e-ff1e9388a282/image.png)

## (3) ArgoCD Application

이제 ArgoCD 애플리케이션을 만들어보자. Dev 및 Prod 두 애플리케이션을 정의하고 깃허브 레포지토리를 연동한다. 그럼 내부적으로 ArgoCD 엔진이 자동으로 Kustomize를 감지한다.

```yaml
# argocd-dev-application.yaml

apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
    name: demo-dev
    namespace: argocd
spec:
    project: demo-proj
    source:
        repoURL: https://github.com/eocndp/argocd-kustomize-demo # 깃허브 레포지토리 URL
        targetRevision: main
        path: overlays/dev # Overlay 경로
    destination:
        server: https://kubernetes.default.svc
        namespace: dev
    syncPolicy:
        automated:
            prune: true
            selfHeal: true
        syncOptions:
            - CreateNamespace=true
            - timeout.reconcile=30s # Pulling 및 Reconcile 간격
```

마찬가지로 Prod 애플리케이션도 정의하고 적용하자.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
    name: demo-prod
    namespace: argocd
spec:
    project: demo-proj
    source:
        repoURL: https://github.com/eocndp/argocd-kustomize-demo
        targetRevision: main
        path: overlays/prod
    destination:
        server: https://kubernetes.default.svc
        namespace: prod
    syncPolicy:
        automated:
            prune: true
            selfHeal: true
        syncOptions:
            - CreateNamespace=true
            - timeout.reconcile=30s
```

![](https://velog.velcdn.com/images/yulmwu/post/80a4bd42-196a-4ccd-ac69-e0305fd49ecb/image.png)

CLI로 확인하면 재미가 없으니 ArgoCD 대시보드를 확인해보자.

## (4) Testing

![](https://velog.velcdn.com/images/yulmwu/post/818ec154-97a6-47fc-8575-0f4574b26ab7/image.png)

그럼 방금 만들었던 두 애플리케이션이 나온 것을 볼 수 있고, 둘 다 동기화된 것을 확인할 수 있다. 특정 애플리케이션을 클릭하여 현재의 토폴로지 또한 확인할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/8f3ae9bc-4461-43d9-817c-c8469001c772/image.png)

만약 ArgoCD와 동기화된 Deployment가 Drift 되어 삭제된다고 하면 어떨까?

![](https://velog.velcdn.com/images/yulmwu/post/6fdfc50c-2507-407b-98fb-331274a4152d/image.png)

그럼 위 사진과 같이 Drift Reconcile 되어 Deployment가 다시 만들어지는 것을 확인할 수 있다.

이번엔 깃허브 레포지토리의 Kustomize 내용을 변경해보자.

![](https://velog.velcdn.com/images/yulmwu/post/d9c3063a-2dc2-433b-80e9-3c9680bc6f71/image.png)

Reconcile(Pulling) 간격을 30초로 설정해두었기 때문에 30초 정도의 시간이 지난다면 아래와 같이 또다시 Reconcile 되는 것을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/930de539-e407-4b88-94fe-22c3d397263c/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/275dbf4f-2b97-4984-9353-8bc08c38cd55/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/d2cfe17f-84fc-464a-a4e9-feb7c16d2831/image.png)

이로써 간단하게 ArgoCD를 사용한 기초적인 GitOps 실습을 해보았다. 매우 편리한 방법론 중 하나이니 유용하게 사용할 수 있을 것이다.
