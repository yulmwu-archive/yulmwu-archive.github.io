---
title: '[Kubernetes] Garbage Collection: OwnerReference, Orphaning and Finalizer'
description: '쿠버네티스의 GC(Garbage Collection)와 OwnerReferences, Finalizer'
slug: '2025-12-09-kubernetes-gc-ownerreferences-finalizer'
author: yulmwu
date: 2025-12-09T03:03:45.564Z
updated_at: 2026-01-14T13:18:24.518Z
categories: ['Kubernetes']
tags: ['kubernetes']
series:
    name: Kubernetes
    slug: kubernetes
thumbnail: ../../thumbnails/kubernetes/kubernetes-gc-ownerreferences-finalizer.png
linked_posts:
    previous: 2025-12-09-kubernetes-csa-ssa
    next: 2025-12-09-kubernetes-gitops-argocd
is_private: false
---

# 0. Overview

쿠버네티스를 운영하다 보면 별의 별 오류를 볼 수 있다. 그 중 네임스페이스를 지웠는데 Terminating에서 멈춰서 진행이 안된다라던지, 리소스를 지웠는데 지워지지 않는다던지 등의 경험을 해볼 수 있다.

우리가 자바나 C#과 같은 언어를 공부할 때 가비지 컬렉터(Garbage Collector, 이하 GC)를 접하게 되는데, 힙 영역에서 사용되지 않는 메모리를 정리해주는 역할을 한다.

쿠버네티스도 GC가 존재한다. 쿠버네티스의 GC는 리소스를 일관되게 삭제하기 위하여 존재한다. 예시로 Deployment 리소스를 만들면 Deployment 리소스 자체만 생성되는게 아닌 ReplicaSet, 그리고 그 아래에 Pod 리소스가 생성된다.

![](https://velog.velcdn.com/images/yulmwu/post/16cfd121-faf1-4799-986a-e96f5aa870cf/image.png)

우리가 Deployment를 삭제하게 된다면 Deployment 리소스 자체만 삭제되는 것 뿐만 아니라 ReplicaSet과 생성된 Pod들 또한 삭제가 되는 것을 확인해볼 수 있다.

```
> kubectl get all -n default
NAME                           READY   STATUS                       RESTARTS      AGE
pod/test-6fb97b9cf5-wsfh6      1/1     Running                      0             8m32s
NAME                 TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE
service/kubernetes   ClusterIP   10.96.0.1    <none>        443/TCP   7d17h
NAME                      READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/test      1/1     1            1           8m32s
NAME                                 DESIRED   CURRENT   READY   AGE
replicaset.apps/test-6fb97b9cf5      1         1         1       8m32s

> kubectl delete deployment/test
deployment.apps "test" deleted from default namespace

> kubectl get all -n default
NAME                 TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE
service/kubernetes   ClusterIP   10.96.0.1    <none>        443/TCP   7d17h
```

여기서 의문을 가질 수 있다. 어떻게 Deployment를 지웠을 뿐인데 그 아래에 있던 ReplicaSet과 Pod들이 삭제가 되었을까? 그 배후에는 쿠버네티스의 GC와 자식 요소에 있는 `ownerReferences` 필드가 있다.

# 1. ownerReferences

예시로 Deployment를 생성하고 아래와 같이 부모 요소의 리소스 UID와 자식 요소(ReplicaSet, Pod)의 YAML을 확인해보자.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
    name: test
    namespace: default
spec:
    replicas: 1
    selector:
        matchLabels:
            app: test
    template:
        metadata:
            labels:
                app: test
        spec:
            containers:
                - name: nginx
                  image: nginx:latest
```

`kubectl get <Resource> -n default -o yaml`을 통해 YAML 형식으로 출력되도록 한다. (주요한 부분만 남겨두고 생략하였다.)

```yaml
> kubectl get deploy/test -n default -o yaml

apiVersion: apps/v1
kind: Deployment
metadata:
  uid: b0bbff6a-932b-45a6-a62d-907aa8ae1e9e # b0bb
```

```yaml
> kubectl get replicaset/test-94d888b5b -n default -o yaml

apiVersion: apps/v1
kind: ReplicaSet
metadata:
  ownerReferences:
  - apiVersion: apps/v1
    blockOwnerDeletion: true
    controller: true
    kind: Deployment
    name: test
    uid: b0bbff6a-932b-45a6-a62d-907aa8ae1e9e # b0bb
  uid: 01b19eea-d986-4346-afd1-345f70f339cb # 01b1
```

```yaml
> kubectl get pod/test-94d888b5b-qnq9p -n default -o yaml

metadata:
  ownerReferences:
  - apiVersion: apps/v1
    blockOwnerDeletion: true
    controller: true
    kind: ReplicaSet
    name: test-94d888b5b
    uid: 01b19eea-d986-4346-afd1-345f70f339cb # 01b1
  uid: 284917a5-3d88-40a4-9401-151d8281f7e2 # 2849
```

위와 같이 자식 리소스의 메타데이터에 `ownerReferences` 필드가 있고, 부모 리소스의 UID가 포함되어 있는 것을 볼 수 있다.

여기서 `blockOwnerDeletion` 필드와 `controller` 필드가 있는 것을 볼 수 있다.

`blockOwnerDeletion`은 Foreground 삭제에서 자식 요소가 남아있는 한 부모 요소를 삭제하지 않도록 한다.

> 쿠버네티스에서 부모 리소스를 삭제할 때 자식 리소스를 어떻게 처리할지를 3가지로 선택할 수 있다.
>
> 자식 부터 시작하여 부모 순서로 삭제하는 Foreground, 부모 먼저 삭제 후 자식은 백그라운드에서 삭제하는 Background, 부모만 삭제하고 자식은 남겨두는 Orphan 방식이 있다.
> (이는 `--cascade` 옵션으로 지정할 수 있다. 기본값은 Background이다.)

`controller`는 여러 OwnerReferences 중 이 자식 리소스를 실질적으로 관리하는 주 컨트롤러를 지정한다. (`: true`)

여러 OwnerReferences가 있을 수 있는데, 그 중 하나의 부모가 자식 리소스를 책임질 수 있도록 해야한다. (하나의 `controller: true`)

# 2. Garbage Collector

그런데 OwnerReferences는 자식이 부모의 UID를 지정하지, 부모가 자식의 UID를 가지지 않는다. 사실 이는 당연한 것으로, 자식의 개수는 유동적이지만 그 때 마다 매번 부모 리소스를 수정할 순 없기 때문이다.

그래서 부모 요소를 삭제할 경우 쿠버네티스의 GC가 Orphan 상태의 리소스를 삭제한다. 정확하게 설명하자면 Delete 요청이 온다면 `metadata.deletionTimestamp`를 설정하고 Cascade에 따라 자식을 먼저 지울지, 나중에 지울지, 그냥 냅둘지를 결정하고 GC가 OwnerReferences를 따라 자식을 처리한다.

쿠버네티스에서 GC는 컨트롤러 형태로 존재한다. 기본적으로 `kube-system` 네임스페이스의 `kube-controller-manager` 컨트롤러에 GC가 포함된다.

# 3. Finalizer

한가지 예시를 들어보자. Ingress/Gateway나 LoadBalancer Service에서 AWS Load Balancer Controller를 사용한다고 가정해보자.

만약 ALB와 연동된 Ingress를 지우게 된다면 컨트롤러에 의해 같이 생성된 AWS ALB(ELB) 또한 삭제가 되어야 할 것이다. 하지만 AWS ALB는 쿠버네티스 GC가 직접 삭제할 수 없기 때문에 컨트롤러에 의존하게 된다.

![](https://velog.velcdn.com/images/yulmwu/post/d6ee667b-56ae-4aad-9770-9e69dcaac69c/image.png)

하지만 모종의 이유로 컨트롤러가 동작하지 않아 Ingress 리소스 자체만 삭제가 되고 AWS ALB가 삭제되지 않은 상태로 남아있을 수 있다.

이럴 경우 컨트롤러가 다시 복구될 때 까지 Ingress를 삭제시키지 않고 남도록 하여 복구되었을 때 AWS ALB와 함께 삭제할 수 있도록 강제해야 할 것이다.

이렇듯 삭제 시 쿠버네티스 외부의 리소스가 남지 않도록 Ingress/Gateway, LB Service, PVC/PV, CRD 등의 리소스와 동기화하기 위한 기능이 바로 Finalizer이다.

```yaml
spec:
    finalizers:
        - kubernetes
```

위와 같이 어떤 리소스(네임스페이스 등)는 기본적으로 kubernetes(또는 kubernetes.io/pv-protection 등)를 포함하는 Finalizer를 가진다.
이는 쿠버네티스 내부 컨트롤러가 정리할 일이 끝나기 전까지 삭제되지 않기 위함으로, 주체는 `kube-controller-manager`이다.

---

Finalizer에 대한 실습 후 포스팅을 마무리 해보겠다. ConfigMap을 생성하고 Finalizer를 달아서 의도적으로 영원히 삭제되지 않도록 해보겠다.

```shell
> kubectl create configmap finalizer-demo --from-literal=a=b
configmap/finalizer-demo created
```

그리고 아래와 같이 `finalizer` 필드를 패치하는 명령어를 입력하자.

```shell
> kubectl patch configmap/finalizer-demo -p '{"metadata":{"finalizers":["example.com/cleanup"]}}'
configmap/finalizer-demo patched
```

이에 대해 확인해보면 아래와 같이 finalizers 필드가 패치된 것을 확인해볼 수 있다. 실제론 이 필드는 Third Party 도구나 서비스, Controller(Operator)가 대신 조작할 것이다.

```shell
> kubectl get configmap/finalizer-demo -o yaml
```

```yaml
apiVersion: v1
data:
    a: b
kind: ConfigMap
metadata:
    creationTimestamp: '2025-12-12T06:59:16Z'
    finalizers:
        - example.com/cleanup
    name: finalizer-demo
    namespace: default
    resourceVersion: '27434'
    uid: 53103bfd-6694-4b17-bca9-eda147e0937a
```

그리고 `kubectl delete configmap/finalizer-demo` 명령어를 입력하여 삭제를 시도해보자.

```shell
> kubectl delete configmap/finalizer-demo
configmap "finalizer-demo" deleted from default namespace
```

그럼 네임스페이스에서 삭제되었다는 메시지는 뜨지만 kubectl 프로세스가 종료되지 않는 모습을 볼 수 있다. 터미널 세션을 하나 더 열어서 `kubectl get configmap`과 `-o yaml` 출력을 다시 해보자.

```shell
> kubectl get configmap
NAME               DATA   AGE
finalizer-demo     1      4m16s
```

```shell
> kubectl get configmap/finalizer-demo -o yaml
```

```yaml
apiVersion: v1
data:
    a: b
kind: ConfigMap
metadata:
    creationTimestamp: '2025-12-12T06:59:16Z'
    deletionGracePeriodSeconds: 0
    deletionTimestamp: '2025-12-12T07:02:22Z'
    finalizers:
        - example.com/cleanup
    name: finalizer-demo
    namespace: default
    resourceVersion: '27554'
    uid: 53103bfd-6694-4b17-bca9-eda147e0937a
```

그럼 출력과 같이 `deletionTimestamp`는 찍히는 것을 볼 수 있다. 즉 쿠버네티스 API에 의해 삭제 요청은 되었지만, Finalizer에 의해 삭제되지 않는 모습이다. 아래의 명령어로 해당 Finalizer를 지워 컨트롤러를 흉내 내본다면 즉시 삭제되는 모습을 볼 수 있을 것이다.

```shell
> kubectl patch configmap finalizer-demo --type=json \
  -p='[{"op":"remove","path":"/metadata/finalizers"}]'

configmap/finalizer-demo patched

> kubectl get configmap/finalizer-demo -o yaml
Error from server (NotFound): configmaps "finalizer-demo" not found
```

이로써 쿠버네티스의 GC와 OwnerReference, 그리고 Finalizer에 대해 알아보았다. 쿠버네티스를 운영하면서 여러 리소스에 대한 부모-자식 관계 문제가 발생할 수 있다.

그때 쿠버네티스의 GC와 OwnerReference, Finalizer에 대한 이해가 있다면 해결될 수 도 있으니 알아두면 좋을 것이다.
