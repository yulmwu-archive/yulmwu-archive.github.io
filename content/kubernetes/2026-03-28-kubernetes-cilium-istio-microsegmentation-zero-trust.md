---
title: "[Kubernetes] Cilium 및 Istio로 구현하는 L3/L4/L7 Zero Trust Microsegmentation 아키텍처"
description: "Cilium CNI 및 Istio 서비스 메시를 통해 Kubernetes에서 애플리케이션 L3/L4, L7 Microsegmentation Zero Trust 구현하기"
slug: "2026-03-28-kubernetes-cilium-istio-microsegmentation-zero-trust"
author: yulmwu
date: 2026-03-28T06:09:37.451Z
updated_at: 2026-04-09T04:53:33.558Z
categories: ["Kubernetes"]
tags: ["kubernetes"]
series:
  name: Kubernetes
  slug: kubernetes
thumbnail: https://mirror-cdn.swua.kr/thumbnails/kubernetes/kubernetes-cilium-istio-microsegmentation-zero-trust_960x540.png
linked_posts:
  previous: 2026-03-28-kubernetes-eks-cilium-cni
  next: 
is_private: false
---

> eBPF 및 Cilium CNI에 대해선 아래의 포스팅을 참고하세요.
>
> - https://velog.io/@yulmwu/kubernetes-eks-cilium-cni
> - (Mirror) https://articles.swua.kr/kubernetes/2026-03-23-kubernetes-eks-cilium-cni 

# 0. Overview

Kubernetes는 기본적으로 CNI 플러그인 및 kube-proxy에 의해 Pod와 Pod 간 통신이 Flat하게 가능한 네트워킹 아키텍처이다.

이는 MSA 구조 및 분산된 환경에서 매우 유용하게 작용하지만, 반대로 기본적으로 별도의 방화벽 등을 구성하지 않기 때문에 하나의 Pod가 공격자에 의해 탈취되면 클러스터 내 모든 Pod를 비롯한 리소스에 임의로 접근할 수 있다.

이는 꽤나 자주 발생되는 보안 취약 포인트로, 이 포스팅에선 Zero Trust 및 Microsegmentation 구조로 이러한 보안 인시던트 문제를 완화해볼 것이다.

# 1. Zero Trust 및 Microsegmentation

위와 같은 문제를 완화하기 위해 Zero Trust 모델을 도입해야 한다. Zero Trust는 기본적으로 모든 요청이나 접속에 대해 위협으로 간주하여 차단한다.

이는 같은 네트워크 내부의 애플리케이션이나 서비스도 마찬가지로, 이 애플리케이션이 공격자에 의해 탈취될 가능을 절대적으로 배제할 수 없기 때문이다.

이에 따라 최소 권한 원칙(Principle of Least Privilege, PoLP)을 도입하고 지속적으로 인증/인가를 검증을 통해 침해를 예방할 수 있다.

MSA 아키텍처에서 Zero Trust 철학 중 가장 중요한 개념은 마이크로세그멘테이션(Microsegmentation)인데, 이는 운영 환경에서 네트워크를 애플리케이션이나 워크로드 등에 따라 작게 세분화하고 각 영역(Chunk)을 지정한다.

![](https://mirror-cdn.swua.kr/images/kubernetes/2026-03-28-kubernetes-cilium-istio-microsegmentation-zero-trust/d47a8e8b-9eb3-4fc3-8688-d428d0236841.png)

여기에 Zero Trust 철학을 도입한다면 공격자가 하나의 영역에 진입하더라도 다른 영역으로의 이동(Lateral Movement)을 예방한다. 이를 위해선 단순히 IP/Protocol 수준의 제어를 넘어 애플리케이션/워크로드 단위의 세밀한 제어가 필요하다.

Microsegmentation 도입시 Zero Trust 철학을 쉽게 도입할 뿐만 아니라, 적합성 유지, 복잡한 Observability의 간소화, 정책 간소화 등의 여러 이점을 얻을 수 있을 것이다. 

이러한 Microsegmentation는 그 대상에 따라 애플리케이션, 환경, 프로세스/가상머신이나 N계층, 사용자 세분화 등의 여러 유형으로 영역을 구분할 수 있다. (이 포스팅에선 애플리케이션 레벨의 Microsegmentation을 다룬다.)

# 2. L3/L4 및 L7의 Microsegmentation

앞서 애플리케이션이나 워크로드의 계층별로 Segmentation하는 것은 추상적인 설명이고, 일반적인 경우 L3/L4 및 L7에 대한 정책을 지정하는 것 부터 시작한다. 

L3/L4에 대한 정책은 IP/CIDR, 포트 및 프로토콜을 통해 연결/접속 자체를 통제하는 최소 경계이고, L7는 해당 요청에 대한 경로, HTTP 메서드, gRPC 메타데이터, JWT Claims 등을 통해 세부적으로 제어할 수 있다.

이 포스팅에선 L3/L4에 대한 정책을 eBPF 기반의 Cilium NetworkPolicy Enforcement를 통해 작성해보고, L7에 대한 정책을 Istio(Envoy Sidecar)의 mTLS Strict 및 AuthorizationPolicy를 적용하여 제한하고 제어해보겠다.

## NetworkPolicy Enforcement

기본적으로 Kubernetes에선 NetworkPolicy를 통해 L3/L4 네트워킹 정책을 구성할 수 있다. NetworkPolicy 리소스는 네임스페이스 스코프의 리소스로 Pod에 대한 Inbound(Ingress) 및 Outbound(Egress) 트래픽을 제어한다. 

정책이 적용된 Pod는 해당 정책에 명시된 트래픽만 허용되는 화이트리스트의 구조로, 예시의 NetworkPolicy 정책은 아래와 같다.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: my-app
spec:
  podSelector: {} # 모든 Pod를 의미함
  policyTypes:
  - Ingress
  - Egress
```
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-api
  namespace: my-app
spec:
  podSelector:
    matchLabels:
      app: api-server
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: frontend
    ports:
    - protocol: TCP
      port: 8080
```

위 예시는 해당 네임스페이스의 모든 트래픽을 차단하는 정책으로, 이는 Zero Trust의 기본적인 원칙이다. 두번째 `allow-frontend-to-api` 정책은 `app=frontend` Label이 붙은 Pod에게만 `api-server`에 8080 포트로 접근할 수 있는 권한을 준다. 

이러한 NetworkPolicy는 CNI Plugin에 따라 상의하며, 아래의 Terraform 코드는 EKS 환경에선 VPC CNI Addon(Plugin)에서 NetworkPolicy Enforcement Engine을 제공한다. (기본적으로 비활성화되어 있으며 따로 활성화를 해야한다.)

```go

resource "aws_eks_addon" "vpc_cni" {
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "vpc-cni"
  addon_version               = var.vpc_cni_addon_version
  service_account_role_arn    = var.vpc_cni_service_account_role_arn
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"

  configuration_values = jsonencode({
    enableNetworkPolicy = "true"
  })

  depends_on = [
    aws_eks_cluster.main,
  ]
}
```

이는 VPC CNI에 포함된 Network Policy Engine으로, VPC CNI가 아닌 Calico CNI 또는 Cilium CNI 등의 다른 CNI에서도 Network Policy를 지원한다. 

> 다만 모든 CNI Plugin에서 NetworkPolicy를 지원하지는 않는다. 그 예시로 Flannel CNI는 Overlay Networking에 중점을 두고 NetworkPolicy Enforcement Engine은 지원하지 않는다.

## (L3/L4) Cilium NetworkPolicy  Engine

NetworkPolicy Enforcement Engine으로서 자주 사용되는 CNI Plugin엔 앞서 언급한 Calico CNI 및 Cilium CNI가 존재한다. Calico CNI의 Engine은 Tier 개념을 적용하여 정책의 우선순위를 지정할 수 있는 특이 사항이 있다.

[Cilium CNI는 eBPF 기반으로 Kernel 레벨에서 NetworkPolicy를 처리할 수 있기 때문에](https://articles.swua.kr/kubernetes/2026-03-23-kubernetes-eks-cilium-cni) 타 CNI의 iptables/IPVS로 인한 오버헤드가 감소한다. 

![](https://mirror-cdn.swua.kr/images/kubernetes/2026-03-28-kubernetes-cilium-istio-microsegmentation-zero-trust/60d1e1b4-1e35-4dc5-985d-23ae261b0c60.png)

_출처: https://docs.cilium.io/en/stable/installation/cni-chaining-aws-cni_

네트워킹 CNI 자체를 Cilium으로 대체하거나 기존 CNI(예: VPC CNI)를 유지한채로 Cilium CNI를 Data Path/NetworkPolicy Engine으로서 함께 사용하는 Chaining 모드 등을 사용해볼 수 있다.

이 포스팅에선 Cilium을 NetworkPolicy Enforcement Engine으로서 Chaining하여 사용하도록 하겠다. Calico CNI와는 다르게 Tier나 Order의 개념이 없으며, 기본적으로 Allow 트래픽에 대해 합집합(Union)으로 동작하며 Deny 정책을 우선시한다.

---

Cilium NetworkPolicy Engine의 특징 중 하나는 Pod IP가 아닌 Label 기반의 Security Identity를 통해 정책을 적용한다.

기존의 Calico CNI와 같이 iptables 기반의 CNI에서는 Pod가 재생성되면 IP가 변경되기 때문에 iptables Rule도 재구성이 필요하다. 즉 Pod의 수가 늘어나고 스케일링이 잦은 경우엔 iptables가 선형 O(N)으로 동작하여 성능이 저하될 수 있다.

이에 비해 Cilium은 Label을 기반으로 하나의 Identity를 생성한다. 

```yaml
labels:
  app: frontend
  env: prod

# Identity: 12345
```

이에 대해 Enforcement가 eBPF -> Source Identity / Destination Identity 확인 -> Policy 적용으로 진행되기 때문에 이로 인한 오버헤드가 비교적 많이 감소한다.

iptables가 선형적으로 동작하여 O(N)으로 동작한다면, eBPF 기반의 Cilium은 Kernel 내에서 Hash Map 기반으로 동작하기 때문에 사실상 O(1) 시간복잡도로 동작할 수 있다.

## (L7) Istio and Envoy Sidecar 

지금까지 Cilium을 통한 L3/L4에 대한 Zero Trust Microsegmentation에 대해 설명하였다. L3/L4만 막았다고 해서 L7를 간과하면 안되는 것이, 서비스 구동을 위해 필수적으로 필요한 트래픽은 어쩔 수 없이 허용해야 하고 이를 공격 포인트로 침해될 수 있다.

때문에 앞서 언급하였듯 L7에 mTLS나 JWT Claims 인증 등을 도입하는 것이 적절하고, 이에 대해선 Istio Service Mesh와 Envoy Sidecar 방식을 사용하는 것이 Best Practices이다. (Ambient Mode는 별도로 찾아보길 바란다.)

![](https://mirror-cdn.swua.kr/images/kubernetes/2026-03-28-kubernetes-cilium-istio-microsegmentation-zero-trust/bb6e3865-1544-4f16-9b22-74637e4b97fa.png)

_출처: https://istio.io/latest/docs/ops/deployment/architecture_

> Cilium CNI도 Node wide Envoy Proxy를 통해 L7 제어 및 정책 적용이 가능하지만, L7 제어는 Cilium의 주된 목적은 아니며 L7 제어 및 정책 적용에 대해선 Istio와 같은 Service Mesh 사용하는 것이 더 적절할 수 있다. 

이 포스팅에선 Istio를 활용하여 Service Mesh를 구축하면서 각 마이크로서비스간 mTLS Principal 기반 L7 AuthZ을 구현하고 mTLS를 구성해볼 것이다. 필요시 JWT 또는 OIDC 등을 도입해볼 수 있다.

> 두 정책은 기본적인 동작이 다른데, CiliumNetworkPolicy는 정책이 적용되는 순간 기본적으로 차단되고 ingressDeny/egressDeny를 통해 명시적으로 차단도 추가할 수 있다. 단, Default Deny + Allow List가 기본적이며 필요한 경우 Deny로 예외를 보강한다.
> 
> Istio AuthorizationPolicy는 정책이 없으면 기본 허용이며 Allow 정책은 매칭되는 요청만 통과, Deny 정책은 매칭되는 요청만 차단한다. 
>
> 즉 Zero Trust 관점에선 Cilium을 통해 연결/요청 경계를 최소화하고 Istio는 명시적 Allow로 요청 범위를 좁히는 방식이 가장 안전하다.

# 3. Demo Architecture

예시의 아키텍처는 아래와 같이 전형적인 MSA 데모로 여기에 특정 프로토콜(L3/L4)이나 특정 경로(L7)만 허용되도록 해보고 mTLS Principal 기반 AuthorizationPolicy까지 적용해보겠다. 아래는 실습 중심으로, 이론적인 내용을 깊게 다루지 않는 점 참고 바란다.

![](https://mirror-cdn.swua.kr/images/kubernetes/2026-03-28-kubernetes-cilium-istio-microsegmentation-zero-trust/e06ef908-a4b7-401a-b9b3-aed840478daf.png)

이때 L3/L4 Cilium에 대한 Observability 도구는 Hubble UI, L7 Istio에 대한 Observability 도구는 Kiali를 사용해보도록 하겠다.

또한 실습을 위해 필요한 부가적인 CLI 도구는 아래와 같다. 이러한 도구 없이 직접 Helm을 통해 설치하거나 Kubectl을 사용해볼 수 있지만 편의성을 위해 사용하겠다.

- `cilium`
- `hubble`
- `istioctl`

셋 모두 같은 이름으로 Homebrew를 통해 설치할 수 있다. MacOS 이외의 운영체제나 아키텍처는 각 문서를 참조하자.

## EKS Cluster

예시의 EKS Cluster는 아래와 같다. eksctl이 아닌 Terraform 등으로 프로비저닝해도 무방하다. 

```yaml
# cluster.yaml

apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig

metadata:
  name: shop-zt
  region: ap-northeast-2
  version: "1.35"
iam:
  withOIDC: true
managedNodeGroups:
  - name: ng-1
    instanceType: t3.medium
    desiredCapacity: 2
    minSize: 2
    maxSize: 4
    volumeSize: 20
```

```shell
eksctl create cluster -f cluster.yaml
aws eks update-kubeconfig --region ap-northeast-2 --name shop-zt
```

> 만약 Cilium Full Mode를 사용할 경우 아래와 같은 IAM 정책이 필요할 수 있다. Resource 범위는 적절하게 구성하면 되고, VPC CNI Chaining Mode를 사용할 경우 불필요하다.
> 
> ```json
> {
>   "Version": "2012-10-17",
>   "Statement": [
>     {
>       "Effect": "Allow",
>       "Action": [
>         "ec2:DescribeNetworkInterfaces",
>         "ec2:DescribeInstances",
>         "ec2:DescribeInstanceTypes",
>         "ec2:DescribeSubnets",
>         "ec2:DescribeSecurityGroups",
>         "ec2:DescribeVpcs",
>         "ec2:DescribeAvailabilityZones",
>         "ec2:DescribeTags",
>         "ec2:CreateNetworkInterface",
>         "ec2:DeleteNetworkInterface",
>         "ec2:AttachNetworkInterface",
>         "ec2:DetachNetworkInterface",
>         "ec2:ModifyNetworkInterfaceAttribute",
>         "ec2:AssignPrivateIpAddresses",
>         "ec2:UnassignPrivateIpAddresses",
>         "ec2:CreateTags"
>       ],
>       "Resource": "*"
>     }
>   ]
> }
> ```

## Cilium CNI, Istio Installation

다음으로 Cilium CNI 및 Istio를 설치해보겠다. 이때 Helm Chart 등을 통해 설치해도 되지만, 각 프로젝트 모두 전용 CLI를 제공하기 때문에 이를 사용해보기로 하였다.

```shell
cilium install \
  --set cni.chainingMode=aws-cni \
  --set hubble.relay.enabled=true \
  --set hubble.ui.enabled=true
cilium status
```

![](https://mirror-cdn.swua.kr/images/kubernetes/2026-03-28-kubernetes-cilium-istio-microsegmentation-zero-trust/24098fa6-56d4-4616-b74c-9d5b3888be08.png)

_Cilium CNI가 정상적으로 설치되기까지 약간의 시간이 소요될 수 있다._

Istio도 아래와 같이 간단하게 설치할 수 있다. 세부적인 옵션들은 문서를 참조하길 바란다.

```shell
istioctl install -y
kubectl get pods -n istio-system
```

![](https://mirror-cdn.swua.kr/images/kubernetes/2026-03-28-kubernetes-cilium-istio-microsegmentation-zero-trust/c25095f5-f5a5-4466-9325-9f98ad67e1be.png)

## Prometheus, Kiali Installation

Kiali는 Istio 서비스 메시의 구성, 트래픽 흐름, 상태를 실시간으로 시각화하여 보여주는 Observability 도구이다. 이를 위해서 Prometheus도 설치해줘야 하는데, Istio에 맞게 설치하는 과정이 다소 난해하다. 

직접 세부적으로 커스터마이징하여 사용할 수 있겠지만, 이 포스팅은 그런 목적은 아니기 때문에 아래와 같이 Istio 레포지토리에서 제공하는 Best Practices 예제를 사용해볼 것이다.

```shell
curl -L https://istio.io/downloadIstio | sh -
export ISTIO_HOME=$PWD/istio-*
```

```shell
kubectl apply -f $ISTIO_HOME/samples/addons/prometheus.yaml
kubectl apply -f $ISTIO_HOME/samples/addons/kiali.yaml
```

궁금하다면 직접 매니페스트 파일을 확인해도 좋다. 이렇게 설치를 완료하였다면 애플리케이션을 배포하고 NetworkPolicy와 mTLS, AuthorizationPolicy 등을 배포해보겠다.

## Namespace / Applications

```yaml
# namespace.yaml

apiVersion: v1
kind: Namespace
metadata:
  name: shop
  labels:
    istio-injection: enabled
```

```yaml
# apps.yaml

apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: shop
  labels:
    app: frontend
spec:
  replicas: 1
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
      - name: frontend
        image: hashicorp/http-echo:0.2.3
        args:
        - "-text=frontend"
        - "-listen=:80"
        ports:
        - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: shop
spec:
  selector:
    app: frontend
  ports:
  - port: 80
    targetPort: 80
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: shop
  labels:
    app: api
spec:
  replicas: 1
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
      - name: api
        image: hashicorp/http-echo:0.2.3
        args:
        - "-text=api"
        - "-listen=:80"
        ports:
        - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: shop
spec:
  selector:
    app: api
  ports:
  - port: 80
    targetPort: 80
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders
  namespace: shop
  labels:
    app: orders
spec:
  replicas: 1
  selector:
    matchLabels:
      app: orders
  template:
    metadata:
      labels:
        app: orders
    spec:
      containers:
      - name: orders
        image: hashicorp/http-echo:0.2.3
        args:
        - "-text=orders"
        - "-listen=:80"
        ports:
        - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: orders
  namespace: shop
spec:
  selector:
    app: orders
  ports:
  - port: 80
    targetPort: 80
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payments
  namespace: shop
  labels:
    app: payments
spec:
  replicas: 1
  selector:
    matchLabels:
      app: payments
  template:
    metadata:
      labels:
        app: payments
    spec:
      containers:
      - name: payments
        image: hashicorp/http-echo:0.2.3
        args:
        - "-text=payments"
        - "-listen=:80"
        ports:
        - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: payments
  namespace: shop
spec:
  selector:
    app: payments
  ports:
  - port: 80
    targetPort: 80
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: db
  namespace: shop
  labels:
    app: db
spec:
  replicas: 1
  selector:
    matchLabels:
      app: db
  template:
    metadata:
      labels:
        app: db
    spec:
      containers:
      - name: db
        image: postgres:15
        env:
        - name: POSTGRES_PASSWORD
          value: example
        ports:
        - containerPort: 5432
---
apiVersion: v1
kind: Service
metadata:
  name: db
  namespace: shop
spec:
  selector:
    app: db
  ports:
  - port: 5432
    targetPort: 5432
```

```shell
kubectl apply -f namespace.yaml
kubectl apply -f apps.yaml
```

현재까지 배포가 완료하였다면 아래와 같은 구조를 가진다.

![](https://mirror-cdn.swua.kr/images/kubernetes/2026-03-28-kubernetes-cilium-istio-microsegmentation-zero-trust/0c6404a4-8818-4892-b657-077ea47746ce.png)

하지만 현재 상태는 하나의 Pod가 탈취될 경우 다른 Pod에도 접근이 될 수 있으므로 보안 취약점 포인트가 된다. 이제 이를 완화해보기 위해 아래와 같은 보안 요소를 적용해보겠다.

- (Cilium) NetworkPolicy / CiliumNetworkPolicy
- (Istio) mTLS
- (Istio) mTLS Principal AuthZ

## Cilium NetworkPolicy (NetPol, CNP)

Zero Trust의 전제는 기본적으로 모든 연결/요청에 대해 절대 신뢰하지 않고 항상 검증한다는 것이다. 이를 위해 NetworkPolicy를 적용할 수 있고, 이는 CiliumNetworkPolicy (CNP)를 사용하지 않아도 괜찮다.

```yaml
# cilium-default-deny.yaml

apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shop-default-deny
  namespace: shop
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
```

이 경우 Ingress, Egress 모두 막혔기 때문에 Pod는 서로 통신할 수도 없으며 인터넷 통신이 되지도 않는다. 이제 아래와 같은 CiliumNetworkPolicy를 통해 아키텍처에 대한 네트워킹 구성을 해보겠다.

다음은 단일 매니페스트 파일이지만 설명을 위해 나눠서 첨부하겠다.

```yaml
# cilium-allow.yaml

apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-dns
  namespace: shop
spec:
  endpointSelector: {}
  egress:
  - toEndpoints:
    - matchLabels:
        k8s:io.kubernetes.pod.namespace: kube-system
        k8s:k8s-app: kube-dns
    - matchLabels:
        k8s:io.kubernetes.pod.namespace: kube-system
        k8s:k8s-app: coredns
    toPorts:
    - ports:
      - port: "53"
        protocol: UDP
      rules:
        dns:
        - matchPattern: "*"
    - ports:
      - port: "53"
        protocol: TCP
      rules:
        dns:
        - matchPattern: "*"
---
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-istiod
  namespace: shop
spec:
  endpointSelector: {}
  egress:
  - toEndpoints:
    - matchLabels:
        k8s:io.kubernetes.pod.namespace: istio-system
        k8s:app: istiod
    toPorts:
    - ports:
      - port: "15010"
        protocol: TCP
      - port: "15012"
        protocol: TCP
      - port: "443"
        protocol: TCP
```

위와 같이 CoreDNS와 Istio Envoy 통신을 위한 구성을 해줘야 정상적인 통신이 가능하다. 이 중 15010, 15012 포트는 Istio 컨트롤 플레인인 istiod와 Envoy Sidecar가 통신하기 위한 포트이다. 이에 대해선 아래의 문서를 참조하자.

- https://istio.io/latest/docs/ops/deployment/application-requirements

TCP 15010, 15012 포트는 xDS 관련 포트로 Envoy 운영에 있어 필수적인 포트이다. (15010은 Insecure xDS로 잘 사용하진 않는다.)

다음은 애플리케이션간 통신을 위한 CiliumNetworkPolicy(CNP)이다.

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: frontend-to-api
  namespace: shop
spec:
  endpointSelector:
    matchLabels:
      app: api
  ingress:
  - fromEndpoints:
    - matchLabels:
        app: frontend
    toPorts:
    - ports:
      - port: "80"
        protocol: TCP
---
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: frontend-egress-to-api
  namespace: shop
spec:
  endpointSelector:
    matchLabels:
      app: frontend
  egress:
  - toEndpoints:
    - matchLabels:
        app: api
    toPorts:
    - ports:
      - port: "80"
        protocol: TCP
---
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: api-to-orders
  namespace: shop
spec:
  endpointSelector:
    matchLabels:
      app: orders
  ingress:
  - fromEndpoints:
    - matchLabels:
        app: api
    toPorts:
    - ports:
      - port: "80"
        protocol: TCP
---
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: api-egress-to-orders
  namespace: shop
spec:
  endpointSelector:
    matchLabels:
      app: api
  egress:
  - toEndpoints:
    - matchLabels:
        app: orders
    toPorts:
    - ports:
      - port: "80"
        protocol: TCP
---
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: api-to-payments
  namespace: shop
spec:
  endpointSelector:
    matchLabels:
      app: payments
  ingress:
  - fromEndpoints:
    - matchLabels:
        app: api
    toPorts:
    - ports:
      - port: "80"
        protocol: TCP
---
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: api-egress-to-payments
  namespace: shop
spec:
  endpointSelector:
    matchLabels:
      app: api
  egress:
  - toEndpoints:
    - matchLabels:
        app: payments
    toPorts:
    - ports:
      - port: "80"
        protocol: TCP
---
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: orders-to-db
  namespace: shop
spec:
  endpointSelector:
    matchLabels:
      app: db
  ingress:
  - fromEndpoints:
    - matchLabels:
        app: orders
    toPorts:
    - ports:
      - port: "5432"
        protocol: TCP
---
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: orders-egress-to-db
  namespace: shop
spec:
  endpointSelector:
    matchLabels:
      app: orders
  egress:
  - toEndpoints:
    - matchLabels:
        app: db
    toPorts:
    - ports:
      - port: "5432"
        protocol: TCP
```

각각 Ingress/Egress 모두 구성을 해주었으며, 이때 `fromEndpoints`와 `toEndpoints`를 사용하였다.

마지막으로 Prometheus Scrape을 위한 15090 포트(Envoy Prometheus Telemetry)를 허용하는 정책이다.

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-prometheus-scrape
  namespace: shop
spec:
  endpointSelector: {}
  ingress:
  - fromEndpoints:
    - matchLabels:
        k8s:io.kubernetes.pod.namespace: istio-system
        k8s:app.kubernetes.io/name: prometheus
        k8s:app.kubernetes.io/component: server
    toPorts:
    - ports:
      - port: "15020"
        protocol: TCP
      - port: "15090"
        protocol: TCP
```

다음으로 Cilium에 포함되어 있는 고급 기능인 Gloal NetworkPolicy와 FQDN Policy를 적용해보겠다.

## Cilium Global/FQDN NetworkPolicy

Cilium은 클러스터 단위에 NetworkPolicy(CNP)를 적용할 수 있는 리소스인 CiliumClusterwideNetworkPolicy를 지원한다. 아래의 예제는 Istio/Envoy Health Check 포트인 TCP 15021(HTTP)를 클러스터 레벨에서 허용하는 정책의 예제이다.

```yaml
# cilium-global.yaml

apiVersion: cilium.io/v2
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: deny-node-to-workload
spec:
  endpointSelector:
    matchLabels:
      "k8s:io.kubernetes.pod.namespace": "shop"
  ingress:
  - fromEntities:
    - host
    toPorts:
    - ports:
      - port: "15021"
        protocol: TCP
```

이때 `fromEntities`는 특정한 IP 주소나 Label을 알 수 없는 논리적 대상(Entity)으로부터 들어오는 트래픽을 제어할 때 사용하는 정책 설정이다. 

Kubernetes 환경에서는 보통 Pod의 Label을 기반으로 정책을 세우지만, 클러스터 외부나 로컬 호스트처럼 개별 Identity를 지정하기 어려운 대상을 그룹화하여 관리하기 위해 사용한다. 사용할 수 있는 값들은 아래와 같다.

- `world`: 클러스터 외부의 모든 엔드포인트를 의미하며, `0.0.0.0/0`에 대한 허용과 유사하다.
- `host`: 해당 엔드포인트가 실행 중인 로컬 호스트(노드)를 의미한다.
- `cluster`: 로컬 클러스터 내부의 모든 네트워크 엔드포인트를 포함하는 논리적 그룹이다.
- `remote-node`: 로컬 호스트를 제외한 클러스터 내의 다른 모든 노드를 의미한다.
- `kube-apiserver`: 클러스터의 Kubernetes API 서버를 의미한다.
- `health`: Cilium의 Health Check을 위한 엔드포인트를 의미한다.

예를 들어 클러스터 외부(world)에서 들어오는 모든 트래픽을 차단하고, 오직 클러스터 내부(cluster)에서 오는 트래픽만 허용하고 싶을 때 다음과 같이 작성할 수 있다.

```yaml
ingress:
- fromEntities:
  - cluster
```

우리가 구성한 정책은 `shop` 네임스페이스에 있는 모든 Pod(Workload)를 대상으로, 해당 Pod가 떠있는 노드(Host)로부터 오는 TCP 15021 포트만 허용하고 나머지는 차단하려는 보안 정책이다.

다음으로 살펴볼 요소는 CNP의 `toFQDNs`이다. 

```yaml
# cilium-fqdn.yaml

apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-egress-fqdn
  namespace: shop
spec:
  endpointSelector:
    matchLabels:
      app: api
  egress:
  - toFQDNs:
    - matchName: api.stripe.com
    - matchName: example.com
    - matchPattern: "*.amazonaws.com"
    toPorts:
    - ports:
      - port: "443"
        protocol: TCP
    - ports:
      - port: "80"
        protocol: TCP
```

이 구성은 `shop` 네임스페이스의 `api` 애플리케이션이 허용된 특정 외부 주소(FQDN)로만 나가는 트래픽(Egress)을 허용하는 보안 정책이다. 이는 Cilium NetworkPolicy에서 제공하는 고급 기능으로, 화이트리스트 방식의 정책을 적용할 수 있다.

여기까지만 해도 L3/L4 네트워킹에 대해 Zero Trust 및 Microsegmentation 구성이 어느정도 되었다고 볼 수 있지만, Istio를 통한 L7 Zero Trust 구성도 해보겠다. 

## Istio mTLS (Envoy)

mTLS에 대한 설명은 필자가 전에 다뤘던 내용이 있으니 생략하고, Istio + Envoy는 이러한 mTLS 구성을 매우 손쉽게 구성할 수 있다.

```yaml
# istio-mtls.yaml

apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: shop-mtls
  namespace: shop
spec:
  mtls:
    mode: STRICT
```

만약 특정 Pod가 공격자에 의해 탈취되어 네트워크 트래픽이 스니핑될 가능성이 존재할 수 있다. 이때 mTLS는 두 마이크로서비스간 암호화(TLS)가 되므로 이러한 문제를 완화할 수 있다. 추가적으로 이를 통해 아래의 mTLS Principal Authorization까지 가능하므로 mTLS를 도입하였다.

## Istio mTLS Principal Authorization

Istio는 SPIFFE Identity 기반의 AuthorizationPolicy를 지원한다. SPIFFE Identity는 mTLS 통신의 핸드셰이크에서 인증서로 전달되는 Principal(주체)에 대한 식별 정보로, 이를 통해 ServiceAccount 기반의 Principal Policy를 구성할 수 있다.

> 이 포스팅에선 단순한 예시로 하나의 SA를 기반으로 AuthorizationPolicy를 구성한다. 프로덕션에선 이를 권장하지 않으며, 각 마이크로서비스에 대한 별개의 SA를 구성하는 것이 Best Practices이다.

```yaml
# istio-authz.yaml

apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: api-allow-from-frontend
  namespace: shop
spec:
  selector:
    matchLabels:
      app: api
  rules:
  - from:
    - source:
        principals: ["cluster.local/ns/shop/sa/default"]
    to:
    - operation:
        methods: ["GET", "POST"]
        paths: ["/orders", "/payments"]
---
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: orders-allow-from-api
  namespace: shop
spec:
  selector:
    matchLabels:
      app: orders
  rules:
  - from:
    - source:
        principals: ["cluster.local/ns/shop/sa/default"]
    to:
    - operation:
        methods: ["GET", "POST"]
        paths: ["/orders"]
---
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: payments-allow-from-api
  namespace: shop
spec:
  selector:
    matchLabels:
      app: payments
  rules:
  - from:
    - source:
        principals: ["cluster.local/ns/shop/sa/default"]
    to:
    - operation:
        methods: ["POST"]
        paths: ["/pay"]
```

# Demo Testing

여기까지 구성이 완료되었다면 트래픽을 조금이라도 줘야 원활한 확인이 가능하다. 각 서비스마다 테스트를 진행하면서 curl을 통해 트래픽을 발생시켜보았다.

```bash
kubectl -n shop run curl-frontend --image=curlimages/curl:8.5.0 --restart=Never --labels app=frontend --command -- sleep 3600
kubectl -n shop wait --for=condition=Ready pod/curl-frontend --timeout=180s
kubectl -n shop exec curl-frontend -c curl-frontend -- curl -sS http://api.shop.svc.cluster.local/orders
kubectl -n shop exec curl-frontend -c curl-frontend -- curl -sS http://api.shop.svc.cluster.local/admin
```

```bash
kubectl -n shop run curl-api --image=curlimages/curl:8.5.0 --restart=Never --labels app=api --command -- sleep 3600
kubectl -n shop wait --for=condition=Ready pod/curl-api --timeout=180s
kubectl -n shop exec curl-api -c curl-api -- curl -sS http://orders.shop.svc.cluster.local/orders
kubectl -n shop exec curl-api -c curl-api -- curl -sS -X POST http://payments.shop.svc.cluster.local/pay
kubectl -n shop exec curl-api -c curl-api -- curl -sS http://payments.shop.svc.cluster.local/pay
```

```bash
kubectl -n shop run net-orders --image=busybox:1.36 --restart=Never --labels app=orders --command -- sleep 3600
kubectl -n shop wait --for=condition=Ready pod/net-orders --timeout=180s
kubectl -n shop exec net-orders -- sh -c "nc -zv -w 3 db.shop.svc.cluster.local 5432"
```

```bash
kubectl -n shop exec curl-api -c curl-api -- nslookup api.stripe.com
kubectl -n shop exec curl-api -c curl-api -- nslookup -type=A example.com
kubectl -n shop exec curl-api -c curl-api -- curl -sS https://api.stripe.com
kubectl -n shop exec curl-api -c curl-api -- curl -4 -sS https://example.com
```

위와 같이 네트워킹이 잘 되는 것을 확인해볼 수 있다. 위 명령어는 문제가 없어야하지만, 허용 범위를 벗어날 경우 통신이 안되는 것 또한 확인해볼 수 있다. Hubble은 CLI 또는 웹 UI를 통해 확인해볼 수 있다.

```shell
kubectl -n kube-system port-forward svc/hubble-relay 4245:80
hubble status --server localhost:4245
hubble observe --server localhost:4245 -n shop --last 5
hubble observe --server localhost:4245 --from-pod shop/frontend --to-pod shop/api --last 5
hubble observe --server localhost:4245 -n shop --verdict DROPPED --last 5
hubble observe --server localhost:4245 -n shop --protocol http --last 5
```

![](https://mirror-cdn.swua.kr/images/kubernetes/2026-03-28-kubernetes-cilium-istio-microsegmentation-zero-trust/66bf0565-0f68-45ce-a300-9105c773e5d7.png)

이러한 로그 자체만으로도 큰 도움이 될 수 있지만, 아래와 같이 웹 UI에 접속해볼 수 있다.

![](https://mirror-cdn.swua.kr/images/kubernetes/2026-03-28-kubernetes-cilium-istio-microsegmentation-zero-trust/b16f2800-415d-4165-955c-e5f7b5a28cfe.png)

![](https://mirror-cdn.swua.kr/images/kubernetes/2026-03-28-kubernetes-cilium-istio-microsegmentation-zero-trust/0598bec4-08fe-4db0-8a2a-0eeb07b0c598.png)

마지막으로 Istio 서비스 메시의 Observability 도구인 Kiali에 접속해보자. 마찬가지로 포워딩을 통해 접속해볼 수 있다.

```shell
kubectl -n istio-system port-forward svc/kiali 20001:20001
```

![](https://mirror-cdn.swua.kr/images/kubernetes/2026-03-28-kubernetes-cilium-istio-microsegmentation-zero-trust/c4365f5f-ae7c-46f6-977a-39cfea0bb4ce.png)

![](https://mirror-cdn.swua.kr/images/kubernetes/2026-03-28-kubernetes-cilium-istio-microsegmentation-zero-trust/0f5e5524-87e4-4670-9655-7444d04d56dc.png)

이 외에도 더 많은 기능이 있겠지만, 간단하게 여기까지만 살펴보겠다. 