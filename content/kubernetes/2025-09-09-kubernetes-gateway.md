---
title: '[Kubernetes w/ EKS] Gateway API (Feat. AWS VPC Lattice)'
description: 'Ingress의 차세대, Gateway API 실습 및 AWS Lattice 개념'
slug: '2025-09-09-kubernetes-gateway'
author: yulmwu
date: 2025-09-09T02:34:00.236Z
updated_at: 2026-01-18T04:27:42.363Z
categories: ['Kubernetes']
tags: ['aws', 'eks', 'kubernetes', 'networking']
series:
    name: Kubernetes
    slug: kubernetes
thumbnail: ../../thumbnails/kubernetes/kubernetes-gateway.png
linked_posts:
    previous: 2025-09-09-kubernetes-service-ingress
    next: 2025-09-09-kubernetes-hpa
is_private: false
---

> 해당 게시글은 [세명컴퓨터고등학교](https://smc.sen.hs.kr/) 보안과 동아리 세미나 발표 내용을 블로그 형식으로 정리한 글로, **본 글의 저작권은 [yulmwu (김준영)](https://github.com/yulmwu)에게 있습니다.** 개인적인 용도로만 사용 가능하며, 상업적 목적의 **무단 복제, 배포, 또는 변형을 금지합니다.**
>
> 글에 오류가 댓글로 남겨주시거나 피드백해주시면 감사드리겠습니다.

> AWS VPC Lattice에 대한 설명은 아래의 포스팅에서 따로 다루며, 해당 포스팅에선 VPC Lattice 실습을 하지 않고 이 포스팅에서 EKS(Kubernetes) Gateway API를 통해 실습합니다.
>
> 이 포스팅에서 사용된 매니페스트 파일은 아래의 깃허브 링크에서 확인해보실 수 있습니다.
>
> https://github.com/eocndp/k8s-gateway-aws-vpc-lattice-example
>
> 아래의 사전 지식(쿠버네티스 서비스/Ingress, VPC Peering/TGW/PrivateLink)에 대한 포스팅을 미리 보고 오시면 더욱 빠른 이해가 가능합니다.
>
> - https://velog.io/@yulmwu/kubernetes-service-ingress
> - https://velog.io/@yulmwu/aws-vpc-peering-transit-privatelink

# 0. Overview

쿠버네티스에서 클러스터 외부에 노출하는 방법엔 ClusterIP, NodePort, LoadBalancer 서비스와 Ingress가 있었다. (자세한 내용은 [이 포스팅](https://velog.io/@yulmwu/kubernetes-service-ingress)에서 확인할 수 있다.)

![](https://velog.velcdn.com/images/yulmwu/post/bcadac7d-ad33-47c2-8857-4058afdd0de1/image.png)

그 중 위 사진처럼 Ingress는 Ingress Controller가 L7 로드밸런싱과 경로 기반 라우팅을 해주는데, 몇가지 문제가 있다.

1. 기본적으로 L7 HTTP/HTTPS만 지원하고, TCP/UDP 등의 L4 프로토콜은 불가능하다.
2. 컨트롤러마다 동작의 차이가 크다. (Nginx Ingress Controller(지원 종료 예정), AWS ALB Ingress Controller 등 동작과 방식이 다르고, 필요로 하는 어노테이션이 서로 달라 표준이라기 보단 해당 컨트롤러에 종속된다.)

그 외에도 문제가 있겠지만, 위 두가지 문제와 한계로 인해 Kubernetes Sig Network에서 **Gateway API**를 설계하였다. (이하 Gateway라 명칭함)

# 1. What is Gateway API?

먼저 Gateway API(Gateway)는 HTTPRoute, TCPRoute, UDPRoute, GRPCRoute 등의 여러 프로토콜을 지원하고, 단순히 호스트/경로 라우팅 뿐만 아니라 헤더, 메서드 등의 요소를 기반으로 라우팅될 수 있다.

그리고 Ingress의 경우 Ingress 리소스로 라우팅 등의 선언하고 IngressClass를 통해 어느 Ingress Controller를 사용할지 정한다.

Gateway API는 Gateway, GatewayClass, Route 리소스(오브젝트)를 통해 선언된다.

- **GatewayClass**: 어디에서 제공되는 Gateway Controller를 사용할지 정의한다. (AWS LB Controller, Nginx 등)
- **Gateway**: GatewayClass와 연결되어 실제 트래픽을 어느 Route로 보낼지(호스트/포트 리스너), 인증 등의 설정을 포함하는 실제 게이트웨이 인스턴스이다.
- **Route**: 각 프로토콜 별로 트래픽을 어떤 서비스(백엔드)로 전달할지 라우팅 규칙(경로)을 정의한다.

그리고 Ingress의 어노테이션이 난무하던 것과 달리 표준화된 필드와 Policy 리소스를 통해 일관성 있게 사용할 수 있다.

즉 아래와 같이 동작한다. (AWS LB Controller)

![](https://velog.velcdn.com/images/yulmwu/post/c2953b70-af3f-4bc3-9e9d-a9651a48ee29/image.png)

# 2. What is VPC Lattice ?

> EKS Gateway API 실습을 위해 AWS VPC Lattice에 대한 개념을 설명하고 넘어가겠다.
>
> K8s Gateway API에 대한 개념은 잠시 치워두고, VPC Lattice에 대해 잠깐만 알고 넘어가자.

두개 이상의 VPC를 연결할 때 VPC Peering/Transit Gateway, 또는 다른 VPC 간의 애플리케이션 또는 서비스를 연결하기 위해 VPC PrivateLink라는 서비스를 사용하였다.

![](https://velog.velcdn.com/images/yulmwu/post/7bbf54c1-7f97-4c5e-8fb2-85112b459e1a/image.png)

> 이 주제에 대해선 https://velog.io/@yulmwu/aws-vpc-peering-transit-privatelink 이 포스팅을 참고해보자.

그런데 만약 서로 다른 VPC/계정에 흩어진 마이크로 서비스 간에 통합하고 네트워킹하려면 어떻게 할까?

물론 Peering / Transit Gateway(TGW) / PrivateLink가 있다. 하지만 각 서비스의 단점이나 한계를 살펴보자.

- **VPC Peering**: 두 VPC간 직접 연결되는 Point to Point 방식으로, CIDR이 겹치는 VPC는 사용 불가, Service Mesh로 VPC N개를 연결하기 위해 $\frac {N \times (N - 1)}{2}$개의 Peering이 필요함, 유지보수의 어려움 등
- **Transit Gateway**: Hub and Spoke 구조, 네트워크 계층(IP)으로 애플리케이션(서비스) 단위의 제어는 아님 (네트워크 중심)
- **PrivateLink**: 마찬가지로 Point to Point, 서비스마다 NLB 연결 필요 및 대규모 Service Mesh 형태에선 유지보수하기 어려움 등

이렇듯 3개의 서비스 모두 L3/L4 연결을 만들 순 있지만 서비스(애플리케이션) 단위의 라우팅이나 보안 설정 등을 일관되게 적용하기 어렵고, 유지보수 하기도 쉽지 않다.

그래서 **VPC Lattice**는 분산된 여러 VPC/계정 간 서비스(애플리케이션) 네트워킹 및 라우팅을 위해 설계된 서비스로, L4/L7 계층에 HTTP/HTTPS, gRPC, TLS, TCP 등의 프로토콜을 사용할 수 있다.

> Lattice Service Network를 통해 중앙에서 관리하는 Hub and Spoke 형태로 보일 순 있으나, Service Mesh 특성과 Hub and Spoke의 특성을 둘 다 가지고 있다.
>
> 다만 Envoy 사이드카 프록시 등을 가지고 있지 않고(AWS 완전 관리형 서비스), 네트워크 단위가 아닌 서비스 엔드포인트 단위로 동작하기 때문에 둘 모두 속하지 않는다. (내부적인 동작 자체는 Service Mesh와 비슷하긴 하다.)

또한 서비스(애플리케이션) 단위의 접근 제어가 가능하고, IAM 기반으로 설정할 수 있다. (Auth Policy)

![](https://velog.velcdn.com/images/yulmwu/post/ea61279c-6957-4b4b-b81b-7d7fe18eb5de/image.png)

서비스(애플리케이션)들을 HTTP/HTTPS 라우팅을 한다는 것에 VPC Lattice가 로드밸런서 처럼 동작하여 인터넷 Public 엑세스가 가능할 것이라 생각할 수 있지만, 프라이빗 서비스이기 때문에 VPC Lattice 앞에 ALB/API Gateway 등의 서비스를 붙여야 한다.

다음은 VPC Lattice의 주요 구성 요소들이다.

### Lattice: Service

실제 서비스(애플리케이션)을 대표하는 서비스 단위의 리소스로, 타겟 그룹(대상 그룹)으로 연결된다.

즉 로드밸런서의 라우팅 규칙과 비슷하며, Listener는 프로토콜과 포트를 정의, Routing Rule는 경로/헤더/가중치 등을 기반으로 트래픽을 분배하는 라우팅 규칙을 정의한다.

### Lattice: Target Group

로드밸런서의 타겟 그룹과 마찬가지로 실제 트래픽을 받는 애플리케이션 워크로드의 집합으로, EC2 인스턴스나 IP, 람다, ALB, ECS, EKS 등의 서비스를 지원한다.

ELB 타겟 그룹과 마찬가지로 Health Check로 상태를 체크한다.

### Lattice: Service Network

여러 서비스와 VPC를 논리적으로 묶고, 엑세스 제어 / 리전, 계정 간 연결 / 모니터링 등의 기능을 중앙에서 제공한다.

Lattice 아키텍처 다이어그램에서 중앙에 있는 VPC Lattice Service Network가 바로 이것으로, Hub and Spoke 처럼 트래픽이 거쳐가는 것은 아니다.

서비스들을 등록하고 컨슈머(VPC, 계정)가 Association하는 논리적인 집합인 것이다.

### Lattice: Auth Policy

서비스나 서비스 네트워크 단위에서 엑세스 권한을 제어하는 정책이다.

`NONE`이나 `AWS_IAM`으로 선택할 수 있으며, `NONE`으로 설정 시 AuthN, AuthZ를 요구하지 않고 그 리소스에 접근하는 모든 트래픽을 허용한다.

즉 서비스 네트워크에서 Auth Type을 `NONE`으로 설정 시 참여되는 모든 VPC 리소스가 접근될 수 있다.

`AWS_IAM`은 VPC, 계정별 접근 권한을 제어하거나 특정 Principal이 해당 서비스에 접근할 수 있는지 IAM으로 설정한다.

> 이 포스팅에선 빠른 실습을 위해 Auth Type = `NONE`으로 설정하여 실습한다.
>
> 실제 프로덕션 환경에선 `AWS_IAM`을 통해 세분화된 권한 설정이 필요하다.

### Lattice: Observability

서비스 네트워크를 통해 중앙에서 관리할 수 있기 때문에 통신 상태나 트래픽 등을 모니터링하거나 로깅할 수 있다.

CloudWatch Metrics나 Access Logs 등을 사용할 수 있고 이 또한 서비스나 서비스 네트워크 단위로 설정할 수 있다.

## Why use VPC Lattice in K8s Gateway API ?

다시 쿠버네티스에서 돌아와서, 사실 Gateway API 컨트롤러로는 ALB, NLB 등의 로드밸런서를 붙일 수 도 있다. 아래와 같은 상황을 예로 들어보자.

- 다수의 계정/VPC와 다수의 클러스터를 가짐 (가용성 등)
- 서비스 간 통신에 IAM과 같은 일관된 AuthN/Z가 필요
- EC2, ECS, EKS, 람다 등의 다양한 컴퓨팅 서비스가 있는 경우
- 중앙에서 모니터링 등이 필요한 경우

만약 위와 같은 세부적인 기능이 필요하지 않고 단일 VPC/계정/클러스터에 주 목적이 인터넷 노출이라면 ALB나 NLB를 사용해도 무방하다. (비용이 더 저렴)

하지만 다수의 VPC와 클러스터, 계정 등을 가지거나 더 세부적인 기능이 필요하다면 Lattice를 고려해보는 것이 좋다.

또한 Gateway API의 추상화 구조와 VPC Lattice 추상화 구조가 비슷하기 때문에 매핑하기도 쉽다.

![](https://velog.velcdn.com/images/yulmwu/post/75c22078-9736-42ac-bb92-22c1614a9d5b/image.png)

(실제로 저렇게 흐름이 이어지고 100% 매핑되는 것이 아니다. 이해를 돕기 위해 추상화된 자료로 준비하였다.)

# 3. Example (Demo)

실습은 AWS EKS 환경에서 진행한다. (쿠버네티스 1.33) 실습에 사용될 아키텍쳐는 아래와 같다.

![](https://velog.velcdn.com/images/yulmwu/post/ac4e6adb-5073-4b6f-9cb9-162474458dc9/image.png)

여기서 DNS의 경우 Route53 Private Hosted Zone(이하 PHZ)에 커스텀 도메인 `example.com`을 만들고, 수동으로 CNAME에 서비스 DNS을 추가한다. 물론 [External DNS](https://github.com/kubernetes-sigs/external-dns) 등을 사용하면 자동으로 설정되지만, 간단한 실습이기 때문에 수동으로 추가해보겠다.

(클라이언트 VPC 생성 및 클라이언트 EC2 생성 과정은 생략한다.)

## (1) EKS Cluster

먼저 EKS Cluster를 만드는데, eksctl을 사용하여 만들어보겠다. 아래와 같은 매니페스트 파일을 작성하고 적용해보자.

```yaml
# cluster.yaml

apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig
metadata:
    name: eks-demo
    region: ap-northeast-2
    version: '1.33'
vpc:
    cidr: 10.1.0.0/16
    nat:
        gateway: Single # NAT Gateway
managedNodeGroups:
    - name: ng-1
      instanceType: t3.medium
      desiredCapacity: 2
      privateNetworking: true
      iam:
          withAddonPolicies:
              ebs: true
addons:
    - name: vpc-cni
    - name: kube-proxy
    - name: coredns
```

VPC CIDR은 `10.1.0.0/16`, 2개의 노드는 모두 프라이빗 서브넷에 올려둔다. (NAT Gateway 1개)

```shell
eksctl create cluster -f cluster.yaml
aws eks update-kubeconfig --name eks-demo --region ap-northeast-2
```

![](https://velog.velcdn.com/images/yulmwu/post/3ea98cbf-7158-49de-81a1-3594159b9b82/image.png)

그럼 아래와 같이 EKS 클러스터와 EC2 노드가 생성된다.

![](https://velog.velcdn.com/images/yulmwu/post/19499760-d32e-4752-a69d-5ff52bbcf9af/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/84396bf9-bf78-4372-b842-ed935d4cca8e/image.png)

그리고 실습하기 앞서 CLI를 쉽게 다루기 위해 아래와 같은 환경변수를 만들어주자. (AWS CLI 로그인이 필요하다.)

```shell
export CLUSTER_NAME=eks-demo
export AWS_REGION=ap-northeast-2
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

## (2) Deployment & Service

다음으로 실습을 위한 `demo-app-a`, `demo-app-b` Deployment와 ClusterIP 서비스를 붙인다. (이 서비스가 추후 HTTPRoute에 연결된다.)

```yaml
# demo-app.yaml

apiVersion: apps/v1
kind: Deployment
metadata:
    name: demo-app-a
spec:
    replicas: 2
    selector:
        matchLabels:
            app: demo-app-a
    template:
        metadata:
            labels:
                app: demo-app-a
        spec:
            containers:
                - name: demo-app-a
                  image: rlawnsdud/demo:latest
                  imagePullPolicy: Always
                  ports:
                      - containerPort: 3000
                  env:
                      - name: HOST
                        value: '0.0.0.0'
                      - name: PORT
                        value: '3000'
                      - name: POD
                        valueFrom:
                            fieldRef:
                                fieldPath: metadata.name
                      - name: ROUTE
                        value: 'v1'
                      - name: GLOBAL_PREFIX
                        value: '/v1'
                  readinessProbe:
                      httpGet:
                          path: /v1/health
                          port: 3000
                      initialDelaySeconds: 5
                      periodSeconds: 10
                  livenessProbe:
                      httpGet:
                          path: /v1/health
                          port: 3000
                      initialDelaySeconds: 10
                      periodSeconds: 20
---
apiVersion: v1
kind: Service
metadata:
    name: demo-app-a
spec:
    selector:
        app: demo-app-a
    ports:
        - name: http
          port: 80
          targetPort: 3000
    type: ClusterIP
---
apiVersion: apps/v1
kind: Deployment
metadata:
    name: demo-app-b
spec:
    replicas: 2
    selector:
        matchLabels:
            app: demo-app-b
    template:
        metadata:
            labels:
                app: demo-app-b
        spec:
            containers:
                - name: demo-app-b
                  image: rlawnsdud/demo:latest
                  imagePullPolicy: Always
                  ports:
                      - containerPort: 3000
                  env:
                      - name: HOST
                        value: '0.0.0.0'
                      - name: PORT
                        value: '3000'
                      - name: POD
                        valueFrom:
                            fieldRef:
                                fieldPath: metadata.name
                      - name: ROUTE
                        value: 'v2'
                      - name: GLOBAL_PREFIX
                        value: '/v2'
                  readinessProbe:
                      httpGet:
                          path: /v2/health
                          port: 3000
                      initialDelaySeconds: 5
                      periodSeconds: 10
                  livenessProbe:
                      httpGet:
                          path: /v2/health
                          port: 3000
                      initialDelaySeconds: 10
                      periodSeconds: 20
---
apiVersion: v1
kind: Service
metadata:
    name: demo-app-b
spec:
    selector:
        app: demo-app-b
    ports:
        - name: http
          port: 80
          targetPort: 3000
    type: ClusterIP
```

그리고 Health Check를 위해 Lattice TargetGroupPolicy 오브젝트를 만들어줘야 한다.

```yaml
apiVersion: application-networking.k8s.aws/v1alpha1
kind: TargetGroupPolicy
metadata:
    name: tg-policy-demo-app-a
spec:
    targetRef:
        group: ''
        kind: Service
        name: demo-app-a
    protocol: HTTP
    protocolVersion: HTTP1
    healthCheck:
        enabled: true
        path: '/v1/health'
        port: 3000
        protocol: HTTP
        protocolVersion: HTTP1
        intervalSeconds: 10
        timeoutSeconds: 5
        healthyThresholdCount: 3
        unhealthyThresholdCount: 3
---
apiVersion: application-networking.k8s.aws/v1alpha1
kind: TargetGroupPolicy
metadata:
    name: tg-policy-demo-app-b
spec:
    targetRef:
        group: ''
        kind: Service
        name: demo-app-b
    protocol: HTTP
    protocolVersion: HTTP1
    healthCheck:
        enabled: true
        path: '/v2/health'
        port: 3000
        protocol: HTTP
        protocolVersion: HTTP1
        intervalSeconds: 10
        timeoutSeconds: 5
        healthyThresholdCount: 3
        unhealthyThresholdCount: 3
```

컨테이너 이미지는 필자가 만들어둔 [rlawnsdud/demo](https://github.com/yulmwu/example-app) 이미지를 사용하는데, `/env?select=POD,ROUTE` 엔드포인트를 통해 설정한 환경변수를 확인해볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/ea3c72e8-a412-4791-a7d3-fd7f393b6d93/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/844ac3ce-824a-448c-9fb5-cde5e5703068/image.png)

k9s에서 아무 파드나 잡고 S 키를 눌러 아래와 같이 테스트해보자.

![](https://velog.velcdn.com/images/yulmwu/post/01578e90-e4c1-4adb-8527-87936456720e/image.png)

## (3) EKS Pod Identity, IAM Role, Policy

쿠버네티스(EKS)와 AWS 리소스는 기본적으로 권한이 없어 Gateway API Controller가 Lattice를 컨트롤할 수 없으므로 권한을 줘야한다.

> 쿠버네티스 리소스와 AWS 리소스 간 IAM 권한을 부여하는 방법엔 크게 2가지가 있다.
>
> 바로 IRSA(IAM Role for Service Accounts)와 Pod Identity가 있는데, IRSA는 Service Account에 IAM OIDC를 부여한다.
>
> 반면 Pod Identity는 Identity Agent 파드가 붙어 AWS 리소스에 접근할 권한을 관리한다.
>
> ![](https://velog.velcdn.com/images/yulmwu/post/024d08ce-f256-4dec-ba25-6d11422bbd34/image.png)

```shell
# 컨트롤러 IAM 정책 설정
curl -fsSL https://raw.githubusercontent.com/aws/aws-application-networking-k8s/main/files/controller-installation/recommended-inline-policy.json -o recommended-inline-policy.json

aws iam create-policy --policy-name VPCLatticeControllerIAMPolicy \
  --policy-document file://recommended-inline-policy.json

export VPCLatticeControllerIAMPolicyArn=$(aws iam list-policies \
  --query 'Policies[?PolicyName==`VPCLatticeControllerIAMPolicy`].Arn' --output text)

# 컨트롤러 네임스페이스 & 서비스 어카운트
kubectl apply -f https://raw.githubusercontent.com/aws/aws-application-networking-k8s/main/files/controller-installation/deploy-namesystem.yaml

cat > gateway-api-controller-service-account.yaml <<'EOF'
apiVersion: v1
kind: ServiceAccount
metadata:
  name: gateway-api-controller
  namespace: aws-application-networking-system
EOF
kubectl apply -f gateway-api-controller-service-account.yaml

# 파드 Identity 애드온 설치
aws eks create-addon --cluster-name ${CLUSTER_NAME} \
  --addon-name eks-pod-identity-agent --addon-version v1.0.0-eksbuild.1

# IAM Role 생성 (Trust Relationship 설정)
cat > eks-pod-identity-trust-relationship.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowEksAuthToAssumeRoleForPodIdentity",
      "Effect": "Allow",
      "Principal": { "Service": "pods.eks.amazonaws.com" },
      "Action": ["sts:AssumeRole","sts:TagSession"]
    }
  ]
}
EOF

aws iam create-role \
  --role-name VPCLatticeControllerIAMRole \
  --assume-role-policy-document file://eks-pod-identity-trust-relationship.json \
  --description "IAM Role for AWS Gateway API Controller for VPC Lattice"

aws iam attach-role-policy \
  --role-name VPCLatticeControllerIAMRole \
  --policy-arn $VPCLatticeControllerIAMPolicyArn

export VPCLatticeControllerIAMRoleArn=$(aws iam list-roles \
  --query 'Roles[?RoleName==`VPCLatticeControllerIAMRole`].Arn' --output text)

# 서비스 어카운트에 IAM Role 연결
aws eks create-pod-identity-association \
  --cluster-name ${CLUSTER_NAME} \
  --role-arn ${VPCLatticeControllerIAMRoleArn} \
  --namespace aws-application-networking-system \
  --service-account gateway-api-controller
```

여기선 Pod Identity를 사용하였는데, EKS 쿠버네티스 파드가 AWS 리소스를 안전하게 접근할 수 있도록 해준다.

## (4) SG Lattice Prefix List

Lattice를 사용하였을 때 네트워크 흐름을 살펴보면 크게 `Client -> Lattice Service Network -> Target Group -> Target(Pod)` 순서이다.

이때 파드 입장에서 보면 Lattice Service Network에서 오는 트래픽을 보게 되는데, 여기서 원본 IP가 Lattice의 IP 대역을 가진 IP로 변경된다. (그래서 원본 IP를 유지하려면 HTTP/HTTPS 등에선 `X-Forwarded-For` 등의 헤더를 사용한다.)

그래서 파드나 노드의 보안 그룹에서 해당 트래픽을 허용해야 하는데, CIDR이 아닌 Prefix List(`pl-...`)로 설정할 수 있다.

AWS 콘솔에서 설정해도 되지만 빠른 진행을 위해 아래의 명령어로 설정해주자.

```shell
# 클러스터 SG ID
CLUSTER_SG=$(aws eks describe-cluster --name ${CLUSTER_NAME} \
  --output json | jq -r '.cluster.resourcesVpcConfig.clusterSecurityGroupId')

# Lattice IPv4/IPv6 Prefix List ID
PREFIX_LIST_ID=$(aws ec2 describe-managed-prefix-lists \
  --query "PrefixLists[?PrefixListName=='com.amazonaws.$AWS_REGION.vpc-lattice'].PrefixListId" \
  | jq -r '.[]')

# 클러스터 SG에 Lattice Prefix List 인바운드 규칙 추가(Lattice가 클러스터로 트래픽을 보낼 수 있도록 허용)
aws ec2 authorize-security-group-ingress \
  --group-id $CLUSTER_SG \
  --ip-permissions "PrefixListIds=[{PrefixListId=${PREFIX_LIST_ID}}],IpProtocol=-1"

# IPv6 Lattice Prefix List ID (옵션)
PREFIX_LIST_ID_IPV6=$(aws ec2 describe-managed-prefix-lists \
  --query "PrefixLists[?PrefixListName=='com.amazonaws.$AWS_REGION.ipv6.vpc-lattice'].PrefixListId" \
  | jq -r '.[]')

# IPv6 Lattice Prefix List 인바운드 규칙 추가 (옵션)
aws ec2 authorize-security-group-ingress \
  --group-id $CLUSTER_SG \
  --ip-permissions "PrefixListIds=[{PrefixListId=${PREFIX_LIST_ID_IPV6}}],IpProtocol=-1"
```

명령어를 실행하면 아래와 같이 클러스터 SG에 Lattice Prefix List가 추가된걸 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/5ebc0653-e2b8-4ff0-b7f3-255bbd057fc5/image.png)

## (5) Gateway API Controller

그리고 helm을 통해 AWS Gateway API Controller를 설치해주자. 전에 Service Account에 IAM 권한을 연결해두었으니 해당 SA를 사용하도록 한다.

```shell
# Gateway API CRD 설치
kubectl kustomize "github.com/kubernetes-sigs/gateway-api/config/crd?ref=v1.1.0" | kubectl apply -f -

# ECR 로그인
aws ecr-public get-login-password --region us-east-1 | helm registry login --username AWS --password-stdin public.ecr.aws

# Helm Gateway API Controller 설치 (SA는 기존에 있는걸로)
helm install gateway-api-controller \
  oci://public.ecr.aws/aws-application-networking-k8s/aws-gateway-controller-chart \
  --version=v1.1.4 \
  --set=serviceAccount.create=false \
  --set=serviceAccount.name=gateway-api-controller \
  --namespace aws-application-networking-system \
  --set=log.level=info
```

설치를 완료했다면 이제 Gateway API Controller가 쿠버네티스의 Gateway/HTTPRoute CRD를 감지 후 VPC Lattice 리소스에 매핑해준다.

![](https://velog.velcdn.com/images/yulmwu/post/1ffc65a4-fcdc-4771-a991-a3d7ca227ac3/image.png)

## (6) Lattice Service Network

그리고 AWS Lattice 서비스 네트워크를 만들어야 한다. (EKS 서비스, 대상 그룹 등은 Gateway API Controller가 만들어준다.)

![](https://velog.velcdn.com/images/yulmwu/post/8e702d55-c971-4f1e-9fa3-00e6d972db7b/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/951b34b3-142f-44ba-aab6-4b8f05183166/image.png)

서비스 연결은 생략하고, VPC 연결을 해준다.

![](https://velog.velcdn.com/images/yulmwu/post/d3bd9891-5677-4332-b785-13b6dce53fbb/image.png)

인증도 생략한다. (실제 프로덕션 환경에선 Zero Trust를 위해 AWS IAM을 사용하는 것을 권장한다.)

![](https://velog.velcdn.com/images/yulmwu/post/2a20f2a6-2972-4dcf-aec3-6765e462e5f9/image.png)

다시 터미널로 돌아가, 아래의 명령어로 Gateway API Controller 설정을 변경해준다.

```shell
helm upgrade gateway-api-controller \
  oci://public.ecr.aws/aws-application-networking-k8s/aws-gateway-controller-chart \
  --version=v1.1.4 \
  --reuse-values \
  --namespace aws-application-networking-system \
  --set=defaultServiceNetwork=demo-sn # Lattice 서비스 네트워크 이름
```

## (7) Gateway, HTTPRoute

이제 Gateway와 HTTPRoute 리소스를 생성하여 연결해보자. 아래와 같은 매니페스트를 작성하고 적용한다.

```yaml
# gateway-class.yaml

apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
    name: amazon-vpc-lattice
spec:
    controllerName: application-networking.k8s.aws/gateway-api-controller
```

```yaml
# gateway.yaml

apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
    name: demo-sn
spec:
    gatewayClassName: amazon-vpc-lattice
    listeners:
        - name: http
          protocol: HTTP
          port: 80
          allowedRoutes:
              namespaces:
                  from: All
              kinds:
                  - kind: HTTPRoute
                    group: gateway.networking.k8s.io
```

```yaml
# httproute.yaml

apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
    name: demo-http-route
spec:
    parentRefs:
        - name: demo-sn
          sectionName: http
    rules:
        - matches:
              - path:
                    type: PathPrefix
                    value: /v1
          backendRefs:
              - kind: Service
                name: demo-app-a
                port: 80
        - matches:
              - path:
                    type: PathPrefix
                    value: /v2
          backendRefs:
              - kind: Service
                name: demo-app-b
                port: 80
```

그리고 아래의 명령어를 작성해보자.

```shell
kubectl get httproute demo-http-route -o jsonpath='{.metadata.annotations.application-networking\.k8s\.aws/lattice-assigned-domain-name}'
```

그러면 아래와 같이 Lattice 서비스 DNS가 나타난다.

![](https://velog.velcdn.com/images/yulmwu/post/c98747ee-14bb-46eb-93aa-210774f9f470/image.png)

이걸 클라이언트 EC2에서 테스트해보자.

![](https://velog.velcdn.com/images/yulmwu/post/845eda26-30cc-447f-93d0-8ae469e04414/image.png)

사진과 같이 라우팅도 되며, 다른 VPC에 있는 리소스이지만 잘 통신되는 것을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/1b8c18d4-9fda-4d18-96f2-e385790bbcb7/image.png)

리스너나 대상 그룹도 알아서 잘 설정된다.

## (8) Route 53 Private Hosted Zone

그런데 저러한 DNS는 너무 길고 복잡한데, 이걸 Route 53 Private Hosted Zone에서 `api.example.com`에 CNAME으로 추가하여 커스텀 프라이빗 도메인을 만들어보자.

그런데 그 전에 HTTPRoute 매니페스트를 수정해줘야 한다.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
    name: demo-http-route
spec:
    parentRefs:
        - name: demo-sn
          sectionName: http
    hostnames:
        - api.example.com
# ...
```

그리고 HTTPRoute를 삭제하고 다시 만들자. 그러면 아래와 같이 "커스텀 도메인" 항목이 보여진다.

![](https://velog.velcdn.com/images/yulmwu/post/07913ee1-8c35-4018-8f24-2d2a24de12fe/image.png)

이제 Route 53 PHZ를 생성한다.

![](https://velog.velcdn.com/images/yulmwu/post/6399f36f-2550-44dc-b073-04005589905e/image.png)

"호스팅 영역 생성"을 클릭한다.

![](https://velog.velcdn.com/images/yulmwu/post/b6ee0ea2-f5b8-4e1e-9b7f-343e17383e55/image.png)

여기서 중요한 점은 "프라이빗 호스트 영역"으로 설정해야 한다. 도메인 이름은 `example.com`로 설정하였다.

![](https://velog.velcdn.com/images/yulmwu/post/f45fb219-a24e-4003-8fa0-5d3111bb096d/image.png)

VPC는 EKS VPC, Client VPC 둘 다 설정해주었다.

PHZ 생성이 되었다면 "레코드 생성"을 클릭한다.

![](https://velog.velcdn.com/images/yulmwu/post/7cff8b6e-3a4f-4fd2-83ea-77000285a163/image.png)

그리고 CNAME을 선택하고, 값엔 Lattice 서비스 도메인(HTTPRoute)을 입력한다. (새로 만들어진걸 적어야한다.)

레코드 이름(서브 도메인)은 `api`로 설정하였다.

![](https://velog.velcdn.com/images/yulmwu/post/be80deec-bc8b-4024-a486-bb2528c32dd2/image.png)

그리고 테스트해보자.

![](https://velog.velcdn.com/images/yulmwu/post/d8290875-c5f6-41da-9379-896d6334306f/image.png)

잘 동작한다. (만약 통신이 안된다면 보안그룹 등을 확인해보자.)

# 4. Calculate Price (Lattice)

비용 계산에서 EKS(Kubernetes) 비용은 생략한다. 노드의 유형, 개수, NAT Gateway 수 등등 요소가 많아 하나하나 계산하기엔 어려움이 있다.

때문에 VPC Lattice 비용만 계산해보겠다. Lattice는 아래와 같이 비용이 청구된다.

- 서비스 별 시간 당 비용
- 데이터 처리량(송수신 합계)
- HTTP 요청당 요금(HTTP/HTTPS 리스너)
- TCP 연결당 요금(TLS 리스너)

요금은 아래와 같다.

![](https://velog.velcdn.com/images/yulmwu/post/f4605957-d9b5-4986-8090-2950fbc87d55/image.png)

서울(`ap-northeast-2`) 기준으로, 다른 리전이나 시간이 지나 요금에 변동이 있을 수 있으니 아래의 공식 문서를 참고하자.

https://aws.amazon.com/ko/vpc/lattice/pricing

먼저 1시간당 요금은 서비스 1개를 기준으로 0.0325\$이다. 1달을 기준으로 하면 대략 $0.0325\$ \times 730h = 24.37\$$의 요금이 발생한다.

데이터 처리 요금은 GB당 0.0325\$로, 예를 들어 100GB의 데이터 처리(송수신 합계)가 발생하였다면 $0.0325\$ \times 100GB = 3.25\$$의 요금이 발생하게 된다.

마지막으로 HTTP/HTTPS 요청 또는 TLS 연결에서 100만 건의 요청/연결 당 0.13\$가 발생한다. 첫 30만 건의 요청/연결은 무료이다.

때문에 만약 300만 건의 HTTP/HTTPS 요청이 발생하였다면 아래와 같이 계산할 수 있다.

$0.13\$ \times 2.7M = 0.351\$$

이처럼 서비스 네트워크 자체의 비용과 VPC 연결 비용 자체는 없는걸 볼 수 있다.

다소 비싸보일 순 있지만, 서비스를 최대한 줄이고 최적화를 한다면 Ingress를 사용하였을 때 보다 더욱 효율적일 수 있다.

예를 들어 NLB 그 자체로도 서울 리전 기준 매달 `16.42$`가 고정적으로 나간다는 것을 보면, 여러 계정/VPC/클러스터가 존재하는 큰 규모의 인프라라면 안쓸 이유가 없는 서비스이다.

---

이상으로 Gateway + VPC Lattice 실습을 마무리하겠다. 혹시라도 블로그에서 잘못된 코드가 있을 수 있으니 아래의 깃허브 레포지토리에서 사용된 매니페스트 파일들을 확인해볼 수 있다.

https://github.com/eocndp/k8s-gateway-aws-vpc-lattice-example
