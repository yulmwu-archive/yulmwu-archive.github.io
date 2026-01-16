---
title: "[Kubernetes] CSA(Client Side Apply, last-applied) and SSA(Server Side Apply) (Feat. Helm 4)"
description: "쿠버네티스의 CSA(Client Side Apply)와 SSA(Server Side Apply), 필드 소유권에 대하여 (Feat. Helm 4.0 릴리즈)"
slug: "2025-12-04-kubernetes-csa-ssa"
author: yulmwu
date: 2025-12-04T07:28:55.187Z
updated_at: 2026-01-13T04:51:29.573Z
categories: ["Kubernetes"]
tags: ["helm", "kubernetes"]
series:
    name: Kubernetes
    slug: kubernetes
thumbnail: ../../thumbnails/kubernetes/kubernetes-csa-ssa.png
linked_posts:
    previous: 2025-12-04-kubernetes-prometheus-grafana
    next: 2025-12-04-kubernetes-gc-ownerreferences-finalizer
is_private: false
---

# 0. Overview

필자가 A형 인플루엔자(독감)에 확진되었는데, 독자 여러분은 추워진 날씨에 건강 관리를 잘 하시길 바라는 바이다.

아무튼 그래서 병가를 내고 집에서 최근*(이라고 하기엔 몇주 전)*에 릴리즈된 **Helm 4.0**에 대해 관련 문서와 [CNCF 프레젠테이션](https://youtu.be/wkP1xCQMCaE?si=2JFdojKxQpIZB8zM)을 보고있었다.

여러 업데이트 내역이 있었지만 그 중 **SSA(Server-Side Apply)**를 지원한다는 내용이 있었다. 예전에 동기가 이야기했던 **필드 매니저(Field Manager)**에서 잠깐 등장했던 개념이였는데, 무심코 지나친 것 같아서 자세히 알아보게 되었다.

# 1. CSA(Client Side Apply), 3-Way Merge

먼저 쿠버네티스의 철학은 **선언형 관리(Declarative)**인데, 이를 위해선 원하는 최종 상태를 Reconciliation 하면서도 요청에 따라 새 필드를 추가하거나 값을 수정하고, 또는 필드를 삭제해야 한다.

예시로 어떠한 필드를 삭제한다고 가정하자. 쿠버네티스는 단일 주체가 아닌 여러 사용자의 kubectl apply, kubectl patch/scale, 컨트롤러, Admission Webhook, 그리고 Helm이나 ArgoCD 등의 다양한 주체가 동시에 오브젝트를 다룬다.

그럴 경우 만약 어떠한 필드를 삭제하려고 할 때, 쿠버네티스는 그 삭제 의도를 알 수 없다. 예시로 다른 주체*(심지어 쿠버네티스 자체도 포함된다)*가 자동으로 추가한 필드인데, 이것이 과연 적용하려는 매니페스트에 포함되어 있지 않다고해서 "필드를 삭제해라" 라는 확신이 없는 것이다.
_(여기서 kubectl의 apply, label, scale 등은 각자 다른 주체이다.)_

![](https://velog.velcdn.com/images/yulmwu/post/2c3b17ee-e289-4386-a2b6-f9a51c5be688/image.png)

예시로 파드를 만들고 `kubectl get pod/my-pod -o yaml` 명령어를 입력해보면 한 가지 특이한 필드를 확인해볼 수 있다.

```yaml
metadata:
    annotations:
        kubectl.kubernetes.io/last-applied-configuration: |
            {"apiVersion":"v1","kind":"Pod","metadata":{"annotations":{},"name":"my-pod","namespace":"default"},"spec":{"containers":[{"envFrom":[{"secretRef":{"name":"my-secret"}}],"image":"nginx","name":"my-container"}]}}

# 편의 상 이하 last-applied로 줄여서 부르겠다.
```

바로 `metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"]` 필드인데, 이는 kubectl apply에 대해서만 적용되는 내용인데, 방금까지 설명했던 삭제 동작에 대한 모호함을 판단하려면 새로 적용하려는 상태, 현재 상태(Live), 그리고 이전에 적용했던 상태(`last-applied`)를 필요로 한다.
_(현재 상태는 컨트롤러 등의 다른 주체에 의해 변경될 수 있다. 때문에 현재 상태와 이전 상태를 둘 다 필요로 한다.)_

그래서 이를 통해 kubectl apply 시에 아래와 같은 조건으로 각 필드에 대한 삭제/패치 여부를 결정한다. (**3-Way Merge**)

1. `last-applied`에는 있었는데 새로 적용하려는 상태에선 없다. ⇒ 필드 삭제
2. `last-applied`와 새로 적용하려는 상태에서 공통으로 존재하는데 값이 다르다. ⇒ 값 패치
3. `last-applied`에는 없었으나 새로 적용하려는 상태에서 생겼다. ⇒ 값을 패치하거나 수정

_(단, `last-applied`와 새로 적용하려는 상태에 둘 다 없는 필드이거나 둘 다 존재하면서 같은 값을 가진 필드는 제외함)_
_(여기서 현재 상태가 필요한 이유는 HPA 등의 다른 주체가 값을 변경했을 수 도 있고, `last-applied`에는 없는 다른 주체의 필드를 실수로 삭제하지 않기 위함이기도 하다.)_

하지만 kubectl apply 외에 다른 주체들은 이러한 3-Way Merge를 필요로 하지 않았는데, 다른 주체 자체적으로 상태를 관리하거나 설계 자체에서 이러한 문제를 의도하지 않았기 때문이다. (삭제 의도를 추론하는 선언형 관리 자체를 안함)

즉 kubectl apply 자체적으로 가진 필드(`kubectl.kubernetes.io/last-applied-configuration`)이며, 이를 클라이언트에서 처리하고 쿠버네티스 서버에선 클라이언트에서 계산된 상태를 가지고 패치만 하게 되며, 이를 **CSA(Client Side Apply)**라고 한다.

# 2. SSA(Server Side Apply)

그런데 여태까지 설명했던 `last-applied`는 kubectl apply 단일 주체에 대한 설명이였다.

kubectl apply의 3-Way Merge는 삭제 의도를 추론하기엔 문제가 없었지만 쿠버네티스가 더이상 단일 주체가 아닌 여러 주체가 공동으로 관리하는 Multi Actor 아키텍처로 변해가면서 "필드에 대한 소유권"에 대한 문제가 더욱 더 커지게 되었다.

CSA는 애초에 삭제나 추가, 수정 등의 Diff 판단을 클라이언트에서 계산하는 방식이였고, 필드 단위 소유권이 없기 때문에 여러 주체 간 충돌을 해결할 수 없었다.

당장 예시를 들어봐도

- Helm이 라벨을 추가, 이후 CSA apply로 인해 라벨이 삭제됨. _(CSA apply는 기술적인 한계로 값 단위가 아닌 필드 단위로 판단했다.)_
- HPA가 `replicas`를 10으로 설정하였으나 CSA apply로 인해 다시 `replicas`가 3인 상태로 돌아감.

와 같이 "필드를 누가 관리하는가", 즉 필드에 대한 소유권을 알 수 없다는 큰 한계가 있었다.

특히나 Helm, ArgoCD와 같은 오브젝트나 리소스를 관리하는 여러 주체가 등장하면서 필드에 대한 소유권이 더욱 더 필요하게 되었는데, 이를 위해선 kubectl apply 하나만이 클라이언트단에서 Merge를 계산하는 것(3-Way Merge)이 아닌 서버단에서 필드에 대한 소유권과 Merge를 처리할 수 있도록 해야 했다.

이 때문에 쿠버네티스 자체적으로 리소스 관리 모델을 설계했는데, 이를 **SSA(Server Side Apply)**라고 하며 SSA에선 필드 단위의 소유권(Field Ownership)을 통해 리소스를 관리한다.

---

예시로 `kubectl apply`를 통해 파드를 생성하고 `kubectl label`로 라벨을 추가해보자. 그리고 `kubectl get pod/my-pod -o yaml --show-managed-fields` 명령어를 통해 자세한 매니페스트를 확인해보면 `metadata.managedFields` 필드에 아래와 같이 나타나는 것을 볼 수 있다.

```yaml
  managedFields:
  - ...
    manager: kubectl-client-side-apply
    operation: Update
    time: "2025-12-04T12:30:28Z"
  - ...
    manager: kubelet
    operation: Update
    subresource: status
    time: "2025-12-04T12:30:44Z"
  - apiVersion: v1
    fieldsType: FieldsV1
    fieldsV1:
      f:metadata:
        f:labels:
          .: {}
          f:foo: {}
    manager: kubectl-label
    operation: Update
    time: "2025-12-04T12:35:01Z"
```

내용이 길어 `...` 부분을 일부 생략했으나 생략된 부분에 각 주체가 관리하는 필드가, 마지막 `kubectl-label`에선 추가한 라벨이 있는 모습을 볼 수 있다.

이로써 어느 주체가 어떤 필드를 관리하는지 알 수 있고, 다른 주체가 다른 주체의 필드를 수정하려고 한다면 Conflict 에러를, 삭제 또한 해당 소유자만 가능하기 때문에 여러 주체가 동시에 리소스를 관리해도 충돌이 발생하는 것을 막을 수 있다.
_(여기서 충돌을 막는다는 것은 에러를 유발하지 않는다는 것이 아닌, 사용자의 의도를 벗어나는 동작을 하지 않는다는 것을 의미한다.)_

유추할 수 있겠지만 SSA에선 `last-applied`를 사용하지 않고 새로운 상태, 현재 상태, 그리고 `managedFields`를 통해 Merge를 서버단에서 처리한다.

즉, 서버는 단순히 Patch를 적용하는 것을 넘어 `managedFields`를 기반으로 어떤 필드를 유지하고 수정하며 삭제할지를 결정하는 소유권 기반의 선언적 Merge를 수행한다.

위 예시에선 kubectl apply, kubectl label, 쿠버네티스 API 모두 다른 주체이기 때문에 각각 `kubectl-client-side-apply`, `kubelet`, `kubectl-label`로 표시된 것을 볼 수 있다.

---

kubectl apply의 경우 `--server-side` 옵션을 통해 `kubectl.kubernetes.io/last-applied-configuration`을 사용하지 않고 `managedFields`를 통해 SSA를 사용할 수 있도록 할 수 있다.

```yaml
- apiVersion: v1
  fieldsType: FieldsV1
  fieldsV1:
      f:spec:
          f:containers:
              k:{"name":"my-container"}:
                  .: {}
                  f:envFrom: {}
                  f:image: {}
                  f:name: {}
  manager: kubectl
  operation: Apply # = kubectl apply, 이 경우 metadata의 last-applied 어노테이션을 남기지 않음
  time: "2025-12-04T13:51:21Z"
```

또한 `--field-manager` 옵션을 통해 위 `manager` 이름을 변경할 수 있으며, 당연하겠지만 SSA의 경우 `--dry-run=client` 옵션을 사용할 수 없고, `--dry-run=server`는 사용할 수 있다.

# 3. SSA Conflict Example

예제로 어느 파드의 `metadata.labels.app` 필드를 Manager A가 소유한 상태로 만들고, Manager B가 해당 필드를 수정하려고 한다면 충돌(Conflict)이 발생하는 것을 확인해보겠다.

```yaml
# pod-ssa.yaml

apiVersion: v1
kind: Pod
metadata:
    name: ssa-demo
    labels:
        app: ssa-test
spec:
    containers:
        - name: app
          image: nginx
```

위와 같은 파드를 만들고, 아래의 명령어로 SSA를 사용함과 Field Manager의 이름을 지정해주자.

```shell
kubectl apply --server-side --field-manager=manager-a -f pod-ssa.yaml
```

그리고 `get` 명령어에 `--show-managed-fields` 옵션을 붙여 실행해보면 아래와 같이 `manager-a`에 `metadata.labels.app` 필드에 대한 소유권이 붙은 것을 확인할 수 있다.

```shell
> kubectl get pod ssa-demo -o yaml --show-managed-fields
```

```yaml
managedFields:
    - apiVersion: v1
      fieldsType: FieldsV1
      fieldsV1:
          f:metadata:
              f:labels:
                  f:app: {}
          f:spec:
              f:containers:
                  k:{"name":"app"}:
                      .: {}
                      f:image: {}
                      f:name: {}
      manager: manager-a
      operation: Apply
      time: "2025-12-04T14:17:11Z"
```

이제 Manager B가 해당 라벨을 수정하겠다고 지정해보자. 명령어는 아까와 동일하다.

```yaml
# pod-ssa-modified.yaml

apiVersion: v1
kind: Pod
metadata:
    name: ssa-demo
    labels:
        app: modified
spec:
    containers:
        - name: app
          image: nginx
```

```shell
> kubectl apply --server-side --field-manager=manager-b -f pod-ssa-modified.yaml

error: Apply failed with 1 conflict: conflict with "manager-a": .metadata.labels.app
Please review the fields above--they currently have other managers. Here
are the ways you can resolve this warning:
* If you intend to manage all of these fields, please re-run the apply
  command with the `--force-conflicts` flag.
* If you do not intend to manage all of the fields, please edit your
  manifest to remove references to the fields that should keep their
  current managers.
* You may co-own fields by updating your manifest to match the existing
  value; in this case, you'll become the manager if the other manager(s)
  stop managing the field (remove it from their configuration).
See https://kubernetes.io/docs/reference/using-api/server-side-apply/#conflicts
```

그럼 위와 같이 `metadata.labels.app` 필드는 `manager-a`가 소유한다고 Conflict 에러를 반환하는 모습을 볼 수 있다. 설명 대로 `--force-conflicts` 옵션을 통해 강제로 소유권을 이전할 수 있다.

```shell
> kubectl apply --server-side --field-manager=manager-b --force-conflicts -f pod-ssa-modified.yaml

> kubectl get pod/my-pod -o yaml --show-managed-fields
```

```yaml
- apiVersion: v1
  fieldsType: FieldsV1
  fieldsV1:
      f:spec:
          f:containers:
              k:{"name":"app"}:
                  .: {}
                  f:image: {}
                  f:name: {}
  manager: manager-a
  operation: Apply
  time: "2025-12-04T14:17:11Z"
- apiVersion: v1
  fieldsType: FieldsV1
  fieldsV1:
      f:metadata:
          f:labels:
              f:app: {}
      f:spec:
          f:containers:
              k:{"name":"app"}:
                  .: {}
                  f:image: {}
                  f:name: {}
  manager: manager-b
  operation: Apply
  time: "2025-12-04T14:20:20Z"
```

다만 `--force-conflicts` 옵션은 소유권에 대한 의도를 무시하기 때문에 설계에 있어 문제가 생길 수 있고, 애초에 SSA에선 Conflict가 나지 않도록 원천적으로 설계하는 것이 중요하기 때문에 해당 옵션은 최후의 Takeover 수단으로 사용하는 것이 좋을 것이다.

# 4. Helm 4.0 — Supports SSA

다시 처음으로 돌아가, 그래서 Helm 4.0에서 SSA을 지원하기 때문에 아래와 같은 이점을 챙길 수 있을 것이다.

- Helm이 소유하지 않은 필드를 삭제하거나 덮어쓰지 않음. (못함..)
- Helm과 다른 도구 간의 충돌 시 디버깅이 명확해짐

등등.. 사실 본 포스팅은 쿠버네티스의 CSA와 SSA에 대한 글이였는데, 글을 다 쓰고 보니 너무 이론적으로 접근한 것 같아서 아쉽긴 하다.

그래도 이해하고 넘어간다면, 충돌이 발생하는 상황을 원천적으로 차단할 수 있게 설계할 수 있는 능력을 키울 수 있다고 생각한다.

이상으로 포스팅을 마치겠다.
