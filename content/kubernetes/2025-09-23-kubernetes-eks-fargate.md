---
title: '[Kubernetes w/ EKS] EKS Fargate Cluster'
description: 'AWS EC2 노드 프로비저닝 없이 EKS 클러스터 구성하기 (AWS Fargate)'
slug: '2025-09-23-kubernetes-eks-fargate'
author: yulmwu
date: 2025-09-23T03:09:18.966Z
updated_at: 2026-01-21T00:48:02.371Z
categories: ['Kubernetes']
tags: ['aws', 'eks', 'kubernetes']
series:
    name: Kubernetes
    slug: kubernetes
thumbnail: ../../thumbnails/kubernetes/kubernetes-eks-fargate.png
linked_posts:
    previous: 2025-09-23-kubernetes-ca
    next: 2025-09-23-kubernetes-eks-max-pods
is_private: false
---

# 0. Overview

전통적인 쿠버네티스 환경에선 클러스터는 하나의 컨트롤 플레인(Control Plane)와 하나 이상의 워커 노드(Worker Node)로 구성된다.

즉 아래와 같이 클러스터가 구성되는 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/713bc0b7-99d7-4911-b1a7-bc3ae22c0ce2/image.png)

만약 AWS EKS(Elastic Kubernetes Service)를 사용하게 될 경우 완전 관리형 서비스이기 때문에 컨트롤 플레인은 AWS에서 자체적으로 관리하고, 워커 노드는 EC2를 프로비저닝하여 구성한다.

![](https://velog.velcdn.com/images/yulmwu/post/7cc8ff72-bcbf-4de6-aa00-d2d653e36907/image.png)

그런데 ECS(Elastic Container Service)를 사용해봤다면 알 수 있겠지만, EC2 노드 그룹 대신 Fargate를 통해 노드 프로비저닝 없이 클러스터를 구성할 수 있다.

# 1. What is AWS Fargate?

Fargate는 서버(노드)를 프로비저닝 하지 않고 컨테이너를 실행할 수 있는 컴퓨팅 엔진이다.

AWS에서 제공하는 컨테이너 오케스트레이션 서비스인 ECS나 EKS(Kubernetes)에서 사용할 수 있으며, 노드(EC2) 관리를 하지 않고 컨테이너 오케스트레이션에 집중할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/5a0bb551-b9eb-474b-b8b6-811b770fe556/image.png)

때문에 노드에 설치되는 kubelet과 kube-proxy 등이 설치되지 않고 AWS에서 관리한다.

또한 노드마다 특정 파드를 실행되게 하는 DaemonSet이 동작하지 않고, 서비스 중 NodePort는 사용이 불가하며 Ingress나 Gateway API에선 DaemonSet이 필요한 컨트롤러 또는 NodePort를 경유하는 방식이라면 이 또한 불가능하다.

그 외에도 EC2 기반에서 사용되는 CSI 드라이버 등에도 제약이 있을 수 있다.

물론 장점이 있으니 사용할텐데, 노드 관리가 필요하지 않아 유지보수하기 편하고 운영 오버헤드가 줄어든다.
또한 파드가 실행중에서만 Fargate로 요금이 과금되기 때문에 Idle 상태의 불필요한 노드가 없어진다.

노드 설정 등의 복잡한 과정도 없기 때문에 (비교적) 러닝 커브도 줄어든다고 볼 수 있다.

물론 EC2 기반 노드 그룹과 Fargate를 동시에 사용할 수 있다.

# 2. Example Demo

바로 실습해보자. Fargate는 노드가 없기 때문에 Fargate 클러스터를 구성할 Fargate Profile이라는 매니페스트가 필요하다.

## (1) EKS Cluster

콘솔로 생성하진 않고 eksctl과 ClusterConfig 매니페스트를 만들어서 Fargate 클러스터를 구성해보겠다.

```yaml
# cluster-config.yaml

apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig
metadata:
    name: eks-fargate-demo
    region: ap-northeast-2
    version: '1.33'
vpc:
    cidr: '10.0.0.0/16'
iam:
    withOIDC: true
fargateProfiles:
    - name: default-fargate-profile
      selectors:
          - namespace: default
          - namespace: kube-system
    - name: apps-fargate-profile
      selectors:
          - namespace: apps
            labels:
                run: on-fargate
```

여기서 EC2 기반의 노드 클러스터를 구성한다면 `managedNodeGroups`를 작성했지만, Fargate 클러스터는 `fargateProfiles`을 통해 Fargate 프로필을 구성한다.

그리고 Fargate에 파드를 올리기 위해선 두 Namespace와 Label Selector가 일치해야 한다.

```yaml
selectors:
    - namespace: apps
      labels:
          run: on-fargate # 물론 다른 이름도 가능함
```

그 밖에 옵션은 이 포스팅에서 자세히 다루지 않고, 간단하게 클러스터를 구성하고 파드를 올려보도록 하겠다. 아래의 명령어를 통해 클러스터를 구성하자.

```shell
eksctl create cluster -f cluster-config.yaml
aws eks update-kubeconfig --name eks-fargate-demo --region ap-northeast-2
```

그럼 아래와 같이 EKS 클러스터가 생성된다.

![](https://velog.velcdn.com/images/yulmwu/post/d01ae3fc-42c9-4b2b-9c2a-9e153839dfe8/image.png)

그리고 Fargate 프로필 또한 정상적으로 생성된 것을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/e8d586b3-a4e8-496c-8a3c-9c1585b2c5db/image.png)

> 만약 `failed to create Fargate profile "..." on EKS cluster`와 같은 에러가 발생한다면 클러스터를 지우고(`eksctl delete -f ...`) 다시 만들거나 EKS 클러스터만 만들고 Fargate 프로필은 따로 만드는 방법으로 시도해보자.

그런데 AWS 콘솔이나 `kubectl get nodes -o wide` 등의 명령어로 노드를 확인해보면 아래와 같이 1개 이상의 노드가 존재하는 것을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/b3a263ea-6525-4130-b7b4-f1537ddb51e4/image.png)

이는 쿠버네티스 클러스터 관점에선 노드가 있어야 스케쥴링이 될 수 있기 때문에 AWS에서 논리적으로 할당해준 노드고, 아래와 같이 EC2 인스턴스 목록을 확인해보면 물리적인 노드는 없는 것을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/2d2c60b6-4a15-48bf-8d84-90f637de5ba5/image.png)

## (2) Deployment

이제 Deployment(또는 ReplicaSet)으로 파드를 만들어 Fargate로 동작시켜보자.

```yaml
# deployment.yaml

apiVersion: apps/v1
kind: Deployment
metadata:
    name: web
    namespace: apps
    labels:
        run: on-fargate
spec:
    replicas: 2
    selector:
        matchLabels:
            app: web
            run: on-fargate
    template:
        metadata:
            labels:
                app: web
                run: on-fargate
        spec:
            containers:
                - name: nginx
                  image: public.ecr.aws/nginx/nginx:latest
                  ports:
                      - containerPort: 80
                  resources:
                      requests:
                          cpu: '0.25'
                          memory: '512Mi'
                          ephemeral-storage: '10Gi'
                      limits:
                          cpu: '0.25'
                          memory: '512Mi'
                          ephemeral-storage: '10Gi'
```

마찬가지로 `apps` 네임스페이스에 `run: on-fargate` 라벨을 붙여 파드를 생성하도록 한다.

여기서 Fargate는 EC2와 다르게 정해진 성능 용량이 없고 사용된 vCPU와 메모리 사용 시간을 바탕으로 요금이 계산되기 때문에 `resources.requests`와 자원 낭비를 막기 위한 `resources.limits`를 적어두는 것이 좋다.

만약 두 값을 동일하게 설정한다면 일관된 성능의 Fargate 환경을 사용할 수 있다.

아래의 명령어로 Deployment 매니페스트를 적용하고 파드를 확인해보자. (그 전에 `apps` 네임스페이스를 만들어야 한다.)

```shell
kubectl create namespace apps
kubectl apply -f deployment.yaml

kubectl get pods -o wide -n apps
```

![](https://velog.velcdn.com/images/yulmwu/post/9ba6bfc7-6125-4b6d-a4dd-6102188c5f73/image.png)

그럼 위 사진과 같이 `apps` 네임스페이스와 `run: on-fargate`이 Fargate 프로필과 매칭되어 Fargate 위에 올라간 것을 볼 수 있다. 같은 네임스페이스에 `curl`이 동작하는 파드를 하나 임시로 만들고 두 Nginx 파드의 IP로 접속해보자.

![](https://velog.velcdn.com/images/yulmwu/post/2257f405-f050-4674-9713-d493e5a7bbd1/image.png)

잘 동작하는 것을 볼 수 있다. Fargate에 대한 개념만 설명하는 간단한 포스팅이였기 때문에 실습은 여기까지 매우 간단하게 진행해보았다.

DaemonSet이나 NodePort를 사용하는 LoadBalancer Service/Ingress/Gateway API 등을 제외한다면 거의 동일하게 동작하니 적절하게 사용하면 될 것 이다.
