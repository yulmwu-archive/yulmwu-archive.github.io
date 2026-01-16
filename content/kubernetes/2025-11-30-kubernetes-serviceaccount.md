---
title: "[Kubernetes] ServiceAccount, RBAC: AuthN/AuthZ for Kubernetes API"
description: "Kubernetes API에 접근하기 위한 RBAC(Role Based Access Control) 기반 ServiceAccount"
slug: "2025-11-30-kubernetes-serviceaccount"
author: yulmwu
date: 2025-11-30T11:18:59.974Z
updated_at: 2026-01-15T13:19:50.822Z
categories: ["Kubernetes"]
tags: ["aws", "kubernetes"]
series:
    name: Kubernetes
    slug: kubernetes
thumbnail: ../../thumbnails/kubernetes/kubernetes-serviceaccount.png
linked_posts:
    previous: 2025-11-30-kubernetes-istio-envoy
    next: 2025-11-30-kubernetes-prometheus-grafana
is_private: false
---

# 0. Overview

우리가 쿠버네티스를 처음 접했을 때 `kubectl` 명령어를 통해 쿠버네티스 API를 접근하고 여러 명령어를 사용했었다. 그런데 잘 생각해본다면 이는 해당 쿠버네티스 클러스터에 대한 모든 권한을 가지게 되는데, 이는 보안상 위험한 접근이다.

또한 쿠버네티스를 다루면서 여러 사용자(개발자), 또는 애플리케이션에서 쿠버네티스를 동시에 사용하는 것이 대부분이기 때문에 모든 권한을 줘버린다면 굉장히 취약해질 것이다.

쿠버네티스에선 이러한 문제를 막을 수 있는 여러 솔루션이 있으나 대표적으로 **Service Account(SA)**가 채택하는 방식인 **RBAC(Role Based Access Control)**가 대표적인 솔루션이다.

---

ServiceAccount와 함께 AWS IRSA(IAM Roles for Service Accounts)도 함께 다뤄보려 하였으나 주제에서 벗어나는 것 같아서 이에 대해선 추후 다시 포스팅을 작성해보겠다.

# 1. RBAC(Role Based Access Control), ServiceAccount

사실 용어만 저렇게 있어보이는건데, 사실 그냥 역할(Role)을 만들고 그 역할에 권한을 부여, 그리고 사용자나 그룹 등에 역할을 적용하여 권한을 관리하는 형태이다.

_디스코드(Discord)를 사용해봤다면 매우 익숙한 형태일 것이다. 디스코드의 역할 기능이 바로 이 RBAC이다._

![](https://velog.velcdn.com/images/yulmwu/post/f3144750-1245-4601-8531-a3e9e3b67f03/image.png)

즉 사용자나 애플리케이션*(쿠버네티스에선 Pod, Deployment 등이 해당된다)*에 직접적으로 권한을 부여하는 것이 아니라 역할을 만들고 그 역할에 권한을 부여, 그리고 사용자나 애플리케이션에 Role을 부여하는 형태이다.

# 2. Kubernetes AuthN/AuthZ

RBAC 기반의 ServiceAccount를 설명하기 전, 쿠버네티스 API에서 어떻게 인증(AuthN)과 인가(AuthZ)가 이루어지는지 알고 넘어가는 것이 좋다.

쿠버네티스 API 또한 HTTP 서버이기 때문에 이해하는데 있어 어렵지 않다.

![](https://velog.velcdn.com/images/yulmwu/post/a5718059-edd1-4833-b2b5-ca9ef3436156/image.png)

먼저 HTTP 서버이므로 HTTP 요청을 처리하기 위한 핸들러를 거친다. 이후 클라이언트가 쿠버네티스 사용자가 맞는지 확인하는 AuthN(인증), 그리고 해당 서비스나 기능을 사용할 수 있는지(AuthN, 인가) 확인한다.

이때 ServiceAccount JWT 토큰이나 외부 써드파티 OIDC(Open ID Connect)나 OAuth, X.509 인증서 등으로 인증한다.

그리고 생소한 Admission Controller라는 것을 거치는데, 이는 요청이 서버로 들어가 클러스터에 반영되기 전 요청을 변형(Mutating)하거나 정책에 대해 유효한지 체크(Validating)하여 위반 시 요청을 거부하는 역할을 한다.

_(예를 들어 Mutating에선 StorageClass를 지정하지 않은 PVC 생성 요청에 대해 default StorageClass를 적용, Validating은 네임스페이스 존재 여부, ResourceQuota 등을 체크한다.)_

---

그런데 여기서 의문을 가질 수 있는데, 우리가 kubectl을 사용했을 때 사용자를 만들지 않고도 모든 권한을 가져 쿠버네티스 클러스터에 접근할 수 있었다는 것이다.

쿠버네티스엔 `system:anonymous` 사용자와 `system:unauthenticated` 그룹을 통해 익명으로 접근할 수 있지만, 기본값은 아무런 권한이 없어 403을 반환하고, kubectl의 경우 인증을 위한 인증서를 통해 쿠버네티스 API에 접근한다.
_(이에 대해선 리눅스 기준 `~/.kube/config`를 통해 확인해볼 수 있다.)_

```yaml
> cat ~/.kube/config
users:
- name: arn:aws:eks:ap-northeast-2:123456789:cluster/eks-test # eksctl을 통해 생성됨
  user: # EKS STS 토큰을 통해 접근
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: aws
      args:
      - --region
      - ap-northeast-2
      - eks
      - get-token
      - --cluster-name
      - eks-test
      - --output
      - json
      env: null
      interactiveMode: IfAvailable
      provideClusterInfo: false
- name: demo # (Minikube를 통해 생성됨)
  user: # 로컬에 저장된 인증서를 통해 접근
    client-certificate: /Users/user/.minikube/profiles/demo/client.crt
    client-key: /Users/user/.minikube/profiles/demo/client.key
```

위와 같이 모든 권한을 가진 사용자(인증서)와 Context를 조합하여 현재 Context를 설정하고 kubectl을 통해 쿠버네티스 API에서 모든 권한을 가질 수 있던 것이였다.

그런데 이렇게 인증서만으로 관리하는 것은 쉽지 않기 때문에 쿠버네티스에선 ServiceAccount 오브젝트를 통해 사용자를 관리하는 경우가 많다.

# 3. ServiceAccount

앞서 여러번 언급했지만, ServiceAccount는 한 명의 사용자나 애플리케이션에 대한 계정으로, ServiceAccount에 Role 또는 ClusterRole을 붙여 사용한다.

ServiceAccount는 기본적으로 네임스페이스 내에 속하는 오브젝트인데, 아래와 같이 기본 ServiceAccount와 쿠버네티스 시스템에서 사용되는 ServiceAccount들이 구성되어 있는 것을 볼 수 있다.

```shell
> kubectl get serviceaccount --all-namespaces
NAMESPACE         NAME                                          SECRETS   AGE
default           default                                       0         55s
kube-node-lease   default                                       0         55s
kube-public       default                                       0         55s
kube-system       attachdetach-controller                       0         57s
kube-system       bootstrap-signer                              0         60s
kube-system       certificate-controller                        0         60s
kube-system       clusterrole-aggregation-controller            0         56s
...
```

이제 아래와 같이 ServiceAccount를 만든 다음 해당 ServiceAccount를 가지고 쿠버네티스 API로 접근해보자.

예시를 위해 쿠버네티스 API를 직접 curl로 호출해보고, ServiceAccount를 적용해보겠다. 그러기 위해선 해당 ServiceAccount의 JWT 토큰이 필요하다. 아래와 같은 매니페스트를 작성하고 적용해보자.

```yaml
# sa-token.yaml

apiVersion: v1
kind: Secret
metadata:
    name: foo-token
    annotations:
        kubernetes.io/service-account.name: foo
type: kubernetes.io/service-account-token
```

그리고 아래의 명령어를 통해 JWT 토큰을 가져오고 쿠버네티스 API 서버의 주소를 지정해주자. 필자는 Minikube 환경을 통해 간단하게 실습하고 있어 직접 하드코딩 하였고, 필요에 따라 `~/.kube/config`를 참조하면 된다.

```shell
kubectl apply -f sa.yaml

TOKEN=$(kubectl -n default create token foo)

# Minikube, if you are using another cluster, change the CA path and API server URL accordingly
CA_PATH=~/.minikube/ca.crt
API_SERVER="https://127.0.0.1:50232"
```

이제 아래의 명령어를 통해 Foo ServiceAccount를 가지고 쿠버네티스 API인 `pods/get`에 접근해보자.

```shell
curl --header "Authorization: Bearer $TOKEN" \
	--cacert $CA_PATH $API_SERVER/api/v1/namespaces/default/pods
```

```js
{
  "kind": "Status",
  "apiVersion": "v1",
  "metadata": {},
  "status": "Failure",
  "message": "pods is forbidden: User \"system:serviceaccount:default:foo\" cannot list resource \"pods\" in API group \"\" in the namespace \"default\"",
  "reason": "Forbidden",
  "details": {
    "kind": "pods"
  },
  "code": 403
}
```

그러면 위와 같이 403 Forbidden이 발생하고, 해당 유저(`system:serviceaccount:default:foo` 또는 `foo`로 간략)에서 `pods/get`에 접근할 수 없다는 에러가 발생한다.  
_(여기서 Pods는 Core API이기 때문에 API Group이 따로 없다.)_

이제 Role, 또는 ClusterRole을 만들고 RoleBinding 및 ClusterRoleBinding을 통해 권한을 적용해보겠다.

# 4. Role, RoleBinding

먼저 Role은 역할에 어떠한 권한을 부여할지 나타내는 오브젝트로, Role 자체는 범위가 네임스페이스 내로 한정된다.

하지만 네임스페이스 관련 권한이나 네임스페이스 밖에 있는 PV, 노드 조회와 같은 네임스페이스 범위가 아닌 클러스터 전반에 걸친 권한을 사용할 수 있는 ClusterRole이 있다.

```yaml
# pod-role.yaml

apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
    name: foo-pod-reader
    namespace: default
rules:
    - apiGroups: [""]
      resources: ["pods"]
      verbs: ["get", "list", "watch"]
```

여기서 `apiGroups`는 해당 리소스(오브젝트)의 API Group으로, 이는 `kubectl api-resources` 명령어나 Docs를 참조하자. 예시로 Ingress 오브젝트는 `networking.k8s.io` API Group에 위치한다.

그리고 이를 ServiceAccount에 적용하기 위해선 ServiceAccount나 Role을 수정하는 것이 아닌 RoleBinding 및 ClusterRoleBinding을 만들어 ServiceAccount와 Role을 바인딩해줘야 한다.

![](https://velog.velcdn.com/images/yulmwu/post/17ff11f5-212c-45db-bcc9-8354586f6020/image.png)

> 범위(레벨)를 클러스터로 두냐 네임스페이스로 두냐는 Role과 ClusterRole이 아닌 RoleBinding과 ClusterRoleBinding으로 결정된다.
>
> 즉 아래와 같은 상황에선 역할 자체는 ClusterRole 이지만, 권한은 네임스페이스로 제한된다.
>
> ![](https://velog.velcdn.com/images/yulmwu/post/935d9c0f-0261-42a4-907f-9549e9a3b30f/image.png)
>
> 즉 클러스터 레벨에서 공통으로 사용되는 역할을 ClusterRole로 설정해둘 수 있는데, 이럴 경우 일단 권한의 의도가 명확하지 않고 ClusterRole 자체가 모든 네임스페이스에 대한 접근 권한을 가지고 있기 때문에 보안상, 또는 휴먼 에러에 취약할 수 있다.

RoleBinding은 아래와 같이 작성한다.

```yaml
# pod-rolebinding.yaml

apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
    name: foo-pod-reader-binding
    namespace: default
subjects:
    - kind: ServiceAccount
      name: foo
      namespace: default
roleRef:
    kind: Role
    name: foo-pod-reader
    apiGroup: rbac.authorization.k8s.io
```

위 두 오브젝트를 적용하고 아까의 쿠버네티스 API 호출 명령어(curl)를 실행해보자.

```shell
> kubectl apply -f pod-role.yaml
> kubectl apply -f pod-rolebinding.yaml

> curl --header "Authorization: Bearer $TOKEN" \
     --cacert $CA_PATH $API_SERVER/api/v1/namespaces/default/pods
{
  "kind": "PodList",
  "apiVersion": "v1",
  "metadata": {
    "resourceVersion": "1499"
  },
  "items": [
    {
      "metadata": {
        "name": "test-6bc6b589d7-pn97x",
... (이하 생략)
```

그럼 위와 같이 정상적으로 접근되는 것을 볼 수 있다. 하지만 권한에 `pods` 리소스에 대한 `get`, `list`, `watch`만 부여하였기 때문에 `namespaces`와 같은 리소스를 조회할 순 없다.

# 5. ClusterRole, RoleBinding

```shell
> curl --header "Authorization: Bearer $TOKEN" \
     --cacert $CA_PATH $API_SERVER/api/v1/namespaces
{
  "kind": "Status",
  "apiVersion": "v1",
  "metadata": {},
  "status": "Failure",
  "message": "namespaces is forbidden: User \"system:serviceaccount:default:foo\" cannot list resource \"namespaces\" in API group \"\" at the cluster scope", # Cluster Scope로 명시됨
  "reason": "Forbidden",
  "details": {
    "kind": "namespaces"
  },
  "code": 403
}
```

그렇다면 ClusterRole과 ClusterRoleBinding을 선언하여 클러스터 레벨에서 네임스페이스들을 조회할 수 있도록 해보자.

```yaml
# ns-clusterrole.yaml

apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
    name: foo-pod-reader
    namespace: default
rules:
    - apiGroups: [""]
      resources: ["pods"]
      verbs: ["get", "list", "watch"]
```

```yaml
# ns-clusterrolebinding.yaml

apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
    name: foo-namespace-reader-binding
subjects:
    - kind: ServiceAccount
      name: foo
      namespace: default
roleRef:
    kind: ClusterRole
    name: foo-namespace-reader
    apiGroup: rbac.authorization.k8s.io
```

```shell
kubectl apply -f ns-clusterrole.yaml
kubectl apply -f ns-clusterrolebinding.yaml
```

그리고 다시 curl 명령어로 네임스페이스를 조회해보자.

```shell
> curl --header "Authorization: Bearer $TOKEN" \
     --cacert $CA_PATH $API_SERVER/api/v1/namespaces
{
  "kind": "NamespaceList",
  "apiVersion": "v1",
  "metadata": {
    "resourceVersion": "1590"
  },
  "items": [
    {
      "metadata": {
        "name": "default",
... (이하 생략)
```

이렇게 클러스터 레벨에서 네임스페이스 조회를 할 수 있게 되었다. 하지만 부여했던 권한에 동작 중 네임스페이스를 만드는 것은 포함하지 않았기 때문에 아래와 같이 네임스페이스를 만드는 API 호출은 실패한다.

```shell
> curl --header "Authorization: Bearer $TOKEN" \
     --cacert $CA_PATH -X POST \
     -H "Content-Type: application/json" \
     -d '{"apiVersion":"v1","kind":"Namespace","metadata":{"name":"test-namespace"}}' \
     $API_SERVER/api/v1/namespaces
{
  "kind": "Status",
  "apiVersion": "v1",
  "metadata": {},
  "status": "Failure",
  "message": "namespaces is forbidden: User \"system:serviceaccount:default:foo\" cannot create resource \"namespaces\" in API group \"\" at the cluster scope",
  "reason": "Forbidden",
  "details": {
    "kind": "namespaces"
  },
  "code": 403
}
```

---

추가적으로 ClusterRole Aggregation을 통해 다른 ClusterRole을 ClusterRole에 포함시켜 재사용할 수 있다. 이는 자식 ClusterRole에 `aggregationRule`을 포함시키고 라벨로 매칭시키면 된다. _(이에 대해선 따로 다루진 않겠다.)_

# 6. Application ServiceAccount

여태 실습했던 것은 개발자가 kubectl과 같이 쿠버네티스 API를 호출하였다면, 사실 가장 중요한 것이 애플리케이션 입장에서 쿠버네티스 API를 호출하는 것이다.

여기서 애플리케이션은 대게 파드를 의미하며, 굳이 파드가 쿠버네티스 API를 호출할 필요가 있냐고 할 수 있다.

하지만 Operator 등에서 커스텀 컨트롤러와 같은 경우 이 또한 컨테이너화된 애플리케이션이기 때문에 파드로 운영된다. 이 포스팅에선 Operator 커스텀 컨트롤러를 만들지 않고 `https://kubernetes`를 호출하여 쿠버네티스 API를 사용해보겠다.

> `kubectl get services`를 실행했을 때 서비스를 만들지 않아도 아래와 같이 443(HTTPS) 포트가 오픈되어 있는 `kubernetes` 서비스가 존재한다.

```
> kubectl get services
NAME         TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE
kubernetes   ClusterIP   10.96.0.1    <none>        443/TCP   142m
```

> 이는 쿠버네티스 API에 접근하기 위한 ClusterIP 서비스로, 해당 서비스로 접속하여 쿠버네티스 API를 호출할 수 있다.

예시로 파드를 하나 만들고 쿠버네티스 API를 호출해보겠다. (쿠버네티스 SDK, 클라이언트) 적절한 권한이 적용된 Role이 없으나 아까와 같이 403을 응답으로 받아야 한다.

```js
const k8s = require("@kubernetes/client-node")

const kc = new k8s.KubeConfig()
kc.loadFromDefault()

kc.makeApiClient(k8s.CoreV1Api)
	.listNamespace()
	.then((res) => console.log(res.items.map((ns) => ns.metadata.name)))
	.catch((err) => console.error("Error fetching pods:", err))
```

간단하게 네임스페이스 리스트를 출력하는 소스코드이다.

예제의 소스코드와 Dockerfile은 [깃허브 레포지토리](https://github.com/yulmwu/blog-example-demo/tree/main/k8s-serviceaccount-example/k8s-client-demo)에서 확인해볼 수 있다. 적절히 Docker로 빌드하고, 쿠버네티스에서 파드로 만들어보자.

```shell
kubectl -n default run k8s-client-demo --image=rlawnsdud/k8s-client-demo:latest --restart=Never --command -- sleep 3600
kubectl -n default exec -it k8s-client-demo -- /bin/sh
```

접속했다면 `node index.js` 명령어를 실행하여 쿠버네티스 SDK를 사용해보자.

```shell
$ node index.js
Error fetching pods: ApiException [Error]: HTTP-Code: 403
Message: Unknown API Status Code!
Body: "{\"kind\":\"Status\",\"apiVersion\":\"v1\",\"metadata\":{},\"status\":\"Failure\",\"message\":\"namespaces is forbidden: User \\\"system:serviceaccount:default:default\\\" cannot list resource \\\"namespaces\\\" in API group \\\"\\\" at the cluster scope\",\"reason\":\"Forbidden\",\"details\":{\"kind\":\"namespaces\"},\"code\":403}\n"
```

그럼 위와 같이 권한이 부족하다고 에러가 발생한다. 그렇기 때문에 마찬가지로 네임스페이스를 조회할 수 있는 권한이 필요하다. 우리는 `foo`라는 ServiceAccount를 만들어두었으니 기존의 파드를 삭제하고 ServiceAccount를 적용한 새로운 파드를 만들어보자.

```yaml
# k8s-client-demo.yaml

apiVersion: v1
kind: Pod
metadata:
    name: k8s-client-demo
    namespace: default
spec:
    serviceAccountName: foo
    containers:
        - name: k8s-client-demo
          image: rlawnsdud/k8s-client-demo:latest
          command: ["sleep", "3600"]
```

_(`sleep 3600`을 호출한 이유는 컨테이너가 곧바로 죽지 않도록 하기 위함이다. exec로 접속 후 직접 `node index.js`를 실행하면 된다)_

```shell
$ node index.js
[ 'default', 'kube-node-lease', 'kube-public', 'kube-system' ]
```

그럼 위와 같이 성공적으로 권한이 적용된 것을 볼 수 있다. 그런데 어떻게 파드에 ServiceAccount를 적용시켰던 것일까? 그 해답은 만든 파드에 `describe`를 해보면 알 수 있다.

```shell
> kubectl describe pods/k8s-client-demo
...
    Mounts:
      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-stl9c (ro)
...
```

위처럼 `/var/run/secrets/kubernetes.io/serviceaccount` 경로에 SA가 마운트된 것을 볼 수 있다. 실제로 해당 경로에 파일을 확인해보면 아래와 같이 토큰이 포함된 것을 확인해볼 수 있다.

```shell
> kubectl exec -it k8s-client-demo -- cat /var/run/secrets/kubernetes.io/serviceaccount/token | jq -R .

"eyJhbGciOiJSUzI1NiIsImtpZCI6ImZuWWI4ZHFVeVhOc0dMNDlCckJ6eVNuVHdSU29SamRYNlBnQ2pEa3hJNmsifQ.eyJhdWQiOlsiaHR0cHM6Ly9rdWJlcm5ldGVzLmRlZmF1bHQuc3ZjLmNsdXN0ZXIubG9j...
```
