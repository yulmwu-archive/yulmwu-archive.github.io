---
title: '[Kubernetes] PaC(Policy as Code) with OPA Gatekeeper and Kyverno'
description: 'OPA Gatekeeper와 Kyverno를 통한 Kubernetes PaC(Policy as Code) 구축하기'
slug: '2026-01-13-kubernetes-pac-with-gatekeeper-and-kyverno'
author: yulmwu
date: 2026-01-13T12:30:29.037Z
updated_at: 2026-01-20T08:51:40.347Z
categories: ['Kubernetes']
tags: ['kubernetes']
series:
    name: Kubernetes
    slug: kubernetes
thumbnail: ../../thumbnails/kubernetes/kubernetes-pac-with-gatekeeper-and-kyverno.png
linked_posts:
    previous: 2026-01-13-kubernetes-gc-ownerreferences-finalizer
    next: 2026-01-13-kubernetes-gitops-argocd
is_private: false
---

# 0. Overview

Kubernetes의 철학이라 하면 **선언형(Declarative)** 인프라일 것이다. 인프라 운영자는 원하는 상태(Desired State)를 선언하고, Kubernetes의 Controller가 Desired 상태가 되도록 클러스터의 상태를 맞추기 위해 Reconcile하여 수렴시키는 것이 원칙이다.

이렇게 선언되는 상태 또한 사내의 정책(Policy)이나 거버넌스/컴플라이언스에 의해 제한되거나 강제될 수 있다.

특히나 분산된 복잡한 환경에서 정책을 관리하는 것에 어려움이 있었고, 이러한 정책을 일관적이게 관리할 수 있도록 선언형 코드로 작성하는 것을 **Policy as Code**, 이하 **PaC**라고 명칭하며 대표적으로 OPA(Open Policy Agent)나 Kubernetes 한정으로 Kyverno와 같은 도구를 활용해볼 수 있다.

Policy as Code(PaC)는 보안/컴플라이언스 규칙이나 정책을 코드로 선언하여, 배포 이전(Shift Left: 사전) 또는 **배포 후**(**Shift Right**: 사후)에 자동으로 검사/검증과 제한/차단을 가능하게하며 이 둘을 동시에 진행하는 **Hybrid** 방식 또한 사용될 수 있다.

> 본 포스팅에선 Kubernetes 환경에서의 PaC에 대해 다루며, AWS와 같은 Cloud Vendor에 대한 내용은 다루지 않겠다.
>
> [Crossplane](https://www.crossplane.io/) 등의 도구를 통해 Kubernetes 클러스터 내에서 외부 인프라/리소스에 대한 정의를 했을 경우(Kubernetes API 범위에 있을 경우) 소개할 OPA Gatekeeper와 Kyverno 등의 Kubernetes로 한정된 도구를 통해 외부 리소스에 대한 PaC를 정의하고 Kubernetes에서 통합할 수 있다.
>
> 하지만 그렇지 않은 경우 일반적으로 Kubernetes 내로 한정된다.

## I. PaC — Shift Left

![](https://velog.velcdn.com/images/yulmwu/post/2f1d9de1-185f-4709-8337-a93ba2682b4b/image.png)

앞서 설명하였듯 **Shift Left**는 배포 이전에 PaC로 검사/검증 및 제한/차단을 진행하는 방식으로, CI/CD 파이프라인으로 보면 CI 단계에서 진행된다.

즉 PaC로 작성된 정책을 통해 매니페스트를 사전에 검증 및 제한하는 것으로, CI의 역할에 대입된다. 대부분의 PaC 또는 IaC 도구에서 Shift Left 방식 및 Shift Right 방식을 모두 지원하는 Hybrid 방식을 지원한다.

대부분 SDLC의 초기 단계(테스트 등)나 CI/CD 파이프라인 중 CI 단계에서 처리되므로 초기 발견으로 비용 및 운영 상의 위험을 감소시키고, SDLC 후반부의 재작업을 줄이기 때문에 주기를 단축할 수 있다. (당연한 소리)

Kubernetes에서는 CI 단계를 포함하여 CD 초입인 API Server(Admission Controller) 진입 시점의 가드레일을 Shift Left로 볼 수 있다. (즉 클러스터에 반영되기 전)

## II. PaC — Shift Right

![](https://velog.velcdn.com/images/yulmwu/post/d7c6fa77-4783-4150-b342-16be440c5542/image.png)

반대로 **Shift Right** 방식은 운영 환경/런타임 중, 즉 배포 이후에 정책을 통해 리소스를 검증하고 제한한다. 이는 Shift Left에서는 발견되지 않는 운영 상의 정책 문제를 모니터링하여 검증하고 제한한다.

이 포스팅에서 소개하는 부분은 Shift Left에 가깝지만, 두 개의 도구 모두 런타임이나 백그라운드로 검증하고 제한할 수 있는 기능이 있기 때문에 Shift Left와 Shift Right에 걸쳐있는 Hybrid 방식이라고 볼 수 있다.

---

두 기술을 다뤄보기 전, Kubernetes API Server의 Admission Controller에 대해 잠시 다뤄보고 가겠다.

## III. Kubernetes — Admission Controller

Kubernetes에서 오브젝트나 리소스를 생성할 때는 모두 Kubernetes API Server를 거치게 된다. Kubernetes API 서버는 위와 같이 구성되어 있는데, 그 중 **Admission Controller**에서 정의한 정책에 맞는지 **검증(Validating)**하거나 요청을 **변조(Mutating)**한다.

![](https://velog.velcdn.com/images/yulmwu/post/8a180dce-f49e-41bd-a6ab-5ba413959370/image.png)

정확하게는 **1) Mutating Admission**, **2) Object Validation**, **3) Validating Admission** 순서로, 각각 사이드카 컨테이너 주입이나 기본값 설정처럼 요청을 변조(1)하거나 객체의 구조적 유효성 검증(2), 요청된 객체가 정책에 적합한지, 검증하고 허용이나 제한(거부) 여부를 결정(3)한다.

이러한 Admission Controller는 Built in 컨트롤러와 Dynamic 컨트롤러로 구성되는데, 이 중 Dynamic Controller는 **Webhook**을 통해 외부 로직을 HTTPS Callback으로 연동할 수 있다.

이러한 **Dynamic Admission Controller**는 **ValidatingWebhookConfiguration** 및 **MutatingWebhookConfiguration** 오브젝트로 Webhook을 등록할 수 있으며, 각각 `clientConfig` 필드에서 Webhook 서버의 Service 및 [caBundle](https://velog.io/@yulmwu/kubernetes-cert-manager) 등을 구성한다.

이 포스팅에서 소개할 OPA Gatekeeper와 Kyverno 또한 Shift Left 방식에서 Admission Controller(Webhook)을 통해 PaC 정책을 실행하고 적용할 수 있도록 한다.

# 1. PaC in Kubernetes

앞서 설명하였듯 Kubernetes에서 PaC 솔루션은 Dynamic Admission Controller를 활용하고, 이는 곧 리소스가 클러스터에 반영되기 전 유효성 검사/검증이나 제한/차단, 변조 등이 가능한 Shift Left 도구인 OPA Gatekeeper나 Kyverno 등이 있다.

물론 Shift Right 검증/제한 기능이 있기 때문에 Hybrid 방식을 지원하는 도구지만 이 포스팅에선 Admission Controller를 거치기 전, 즉 Shift Left 방식을 중점적으로 설명하고 예제로도 살펴보겠다. 물론 실제 운영 환경에서는 두 방식 모두 중요한 보안 요소이다.

## I. Open Policy Agent (OPA)

OPA Gatekeeper는 **OPA(Open Policy Agent)** 정책 엔진을 Kubernetes Admission Controller에 맞게 구현한 구현체이다.

OPA는 정책(Policy)와 애플리케이션을 분리하고 입력(Input, 실제 페이로드)과 데이터(Data, 미리 정의해둔 값들)를 받아 규칙을 평가하여 결정하는데, 이때 **Rego**라는 선언적 DSL을 사용한다. 문법은 아래와 같다.

### OPA Rego DSL

```go
package authz

default allow := false

allow if input.user.role == "admin"

allow if {
	input.user.role == "user"
	input.action == "read"
	count(deny) == 0
}

deny contains msg if {
	input.user.status == "suspended"
	msg := "User is suspended"
}

deny contains msg if {
	input.action == "delete"
	msg := "Delete action is not allowed"
}
```

위 Rego PaC는 아래와 같은 동작을 가진다.

- 기본적으로 모든 입력에 대해선 Deny(거부)이다. (`default allow = false`)
- 만약 페이로드의 `user.status`가 `suspended`라면 거부한다. (같은 Rule 블록에서의 조건은 AND로 평가한다.)
- 만약 페이로드의 `action`이 `delete`라면 거부한다.

만약 Allow(허용)이 되려면 아래의 조건을 만족해야 한다.

- `user.role`이 `admin`이면 무조건 허용된다.
- `user.role`이 `user`이면서 `action`이 `read`, 그리고 거부(Deny)가 없을 경우에만 허용된다.

위 예제 코드는 [Rego Playground](https://play.openpolicyagent.org/)에서 간단하게 테스트해볼 수 있다. 아래와 같은 JSON 페이로드를 Input으로 넣어 테스트해보자. 그럼 Deny와 그 이유를 응답받게 될 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/f349f7ab-ef03-4728-9626-071dc24648e2/image.png)

### Gatekeeper

이와 같이 Rego DSL을 사용하는 OPA 정책을 Kubernetes에서 실행하고 클러스터 정책을 적용하는 Admission Webhook이 **OPA Gatekeeper**이다.

정확하게는 기존의 OPA 서버를 통해 Admission Controller(Webhook)을 사용할 수 있었으나, Rego로 작성된 정책(PaC)들은 OPA 서버에서 관리되고 이 서버는 Kubernetes 클러스터 외부에서 동작되었기 때문에 정책 적용 대상이 Kubernetes 클러스터로 단일하다면 운영 시 관리에 있어 불편함이 있었다.

이러한 문제를 해결하고자 OPA Gatekeeper라는 도구가 생겨났고, Rego PaC 정책을 Kubernetes 클러스터 내에서 관리하고 Admission Controller 또한 포함하기 때문에 현재로썬 Kubernetes에서 PaC를 도입하기 위한 표준적인 도구라고 볼 수 있다.

> 그 전엔 kube-mgmt라는 도구도 있었으나, 지금은 권장되지 않는 방법이다. Gatekeeper와 비슷하게 OPA 인스턴스를 Kubernetes 클러스터 내에서 관리하는 도구인데, Gatekeeper라는 더욱 더 강력한 도구가 등장하였기 때문에 지금은 대부분 Gatekeeper를 사용한다.

OPA Gatekeeper의 아키텍처는 아래와 같다. [공식 아키텍처](https://kubernetes.io/blog/2019/08/06/opa-gatekeeper-policy-and-governance-for-kubernetes/)를 참조하여 살짝 변형하였다.

![](https://velog.velcdn.com/images/yulmwu/post/1f912e7c-a041-44a1-b48d-b14dbff8ff82/image.png)

앞서 말하지는 않았지만, Shift Right 솔루션에 대해 **Audit Controller**를 제공한다. 이는 이미 존재하는 리소스에 대해 PaC 정책을 기반으로 조사하는 컨트롤러이다. 다만 이 포스팅에서 다루지는 않겠다.

Gatekeeper의 CRD는 크게 **Constraint Template(Policy Template)**과 **Constraint(Policy Instance)**, 그리고 OPA Data를 정의할 수 있는 Config CRD로 나뉠 수 있다.

Constraint Template은 제약 조건(Constraint)을 만들기 위한 Rego와 Constraint 적용 시 필요한 파라미터 등의 스키마를 포함한다. Constraint는 Constraint Template에 필요한 값을 지정하고 실제로 적용되는 대상을 정의한다. 하나의 Constraint Template는 여러 Constraint로 만들어질 수 있다. (`CRD.constraints.gatekeeper.sh`)

---

이 중 Constraint Template은 `ConstraintTemplate` CRD로 정의될 수 있고, Constraint는 아래와 같은 CRD로 정의할 수 있다.

Constraint CRD의 이름은 Constraint Template에서 정의한 이름으로 자동 생성된다. 하지만 아래의 목록과 같은 CRD 이름이 관용적으로 사용되고, 비슷한 네이밍 컨벤션을 권장한다.

- `K8sRequiredLabels`, `K8sDisallowHostPath`, `K8sResourceLimits`, `K8sDisallowPrivileged` ...
- (추가) `Assign`, `AssignMetadata`, `AssignMetadataImage` 등의 Mutation Admission 관련 Constraint CRD 포함

이렇게 Constraint Template과 Constraint CRD를 나눠둔 이유는 OPA Rego로 작성한 정책 "정의(템플릿, 파라미터 스키마)"와, 그 정책을 어디에 어떤 값으로 적용할지(실제 실행되는 Constraint)를 분리하는 구조이기 때문이다.

이 중 실습에 있어 사용해볼 CRD는 `ConstraintTemplate`을 비롯하여 `K8sRequiredLabels`, `K8sDisallowLatest`, `K8sDisallowPrivileged`, `K8sDisallowHostPath` Constraint CRD를 실습해보겠다.

## II. Kyverno

PaC 기술에 있어 가장 대중적으로 사용되는 오픈소스 기술인 OPA(Open Policy Agent)가 사실상의 표준이지만, 만약 PaC 적용 대상이 Kubernetes 환경 하나라면 DSL인 Rego를 학습하고 OPA 자체를 학습하는 것이 일종의 트레이드오프일 수 있다.

때문에 Kubernetes CRD를 통해 Policy as Code를 작성할 수 있도록하는 도구인 **Kyverno**를 사용해볼 수 있다. 동작 자체는 OPA Gatekeeper와 유사하지만, Gatekeeper 보다는 단순한 CRD를 가지고 있다. (`Policy`, `ClusterPolicy`, `PolicyReport`, `PolicyViolation` 등등)

Kyverno PaC 정책은 아래와 같이 Kubernetes CRD 네이티브로 구성할 수 있다.

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
    name: require-requests-limits
spec:
    validationFailureAction: Enforce
    background: true
    rules:
        - name: require-cpu-mem-requests-limits
          match:
              any:
                  - resources:
                        kinds:
                            - Pod
                        namespaces:
                            - demo-pac
          validate:
              message: 'Need to specify CPU and Memory requests and limits for all containers.'
              pattern:
                  spec:
                      containers:
                          - resources:
                                requests:
                                    cpu: '?*'
                                    memory: '?*'
                                limits:
                                    cpu: '?*'
                                    memory: '?*'
```

다만 예제에선 OPA Gatekeeper를 중심적으로 다뤄보겠다. Open Policy Agent가 PaC 기술에 있어 사실상 표준적인 자리이기 때문이다.

# Demo — Gatekeeper

실습을 위해 아래와 같은 네임스페이스를 만들어주었다. 실제 운영 시엔 필수는 아니다.

```yaml
apiVersion: v1
kind: Namespace
metadata:
    name: demo-pac

# 또는 kubectl create namespace demo-pac
```

그리고 아래와 같이 Helm 명령어를 통해 Gatekeeper Operator와 CRD를 설치하자.

```shell
helm repo add gatekeeper https://open-policy-agent.github.io/gatekeeper/charts
helm repo update

helm upgrade --install gatekeeper gatekeeper/gatekeeper -n gatekeeper-system --create-namespace

# kubectl -n gatekeeper-system rollout status deploy/gatekeeper-controller- # manager
```

```shell
> kubectl get validatingwebhookconfigurations,mutatingwebhookconfigurations

NAME                                                                                                      WEBHOOKS   AGE
validatingwebhookconfiguration.admissionregistration.k8s.io/gatekeeper-validating-webhook-configuration   2          21h

NAME                                                                                                  WEBHOOKS   AGE
mutatingwebhookconfiguration.admissionregistration.k8s.io/gatekeeper-mutating-webhook-configuration   1          21h
```

## I. K8sRequiredLabels

```yaml
# gatekeeper/k8srequiredlabels-template.yaml

apiVersion: templates.gatekeeper.sh/v1beta1
kind: ConstraintTemplate
metadata:
    name: k8srequiredlabels
spec:
    crd:
        spec:
            names:
                kind: K8sRequiredLabels
            validation:
                openAPIV3Schema:
                    type: object
                    properties:
                        labels:
                            type: array
                            items:
                                type: string
    targets:
        - target: admission.k8s.gatekeeper.sh
          rego: |
              package k8srequiredlabels

              violation[{"msg": msg, "details": {"missing": missing}}] {
                required := {l | l := input.parameters.labels[_]}
                provided := {k | input.review.object.metadata.labels[k]}
                missing := required - provided
                count(missing) > 0
                msg := sprintf("Missing required labels: %v", [missing])
              }
```

위 ConstraintTemplate에서 주요하게 살펴볼 포인트는 `labels` 파라미터를 문자열의 배열로 받는 부분(openAPIV3Schema)과 `spec.targets[n].rego`에서 Rego DSL을 통해 PaC를 작성한다.

Kubernetes API에 리소스 생성/수정, 또는 Shift Right 방식으로 정책의 위반 여부를 체크할 때 Gatekeeper는 `violation[...]` 함수를 실행하여 정책의 위반 여부를 판단한다.

이 함수 내 모든 조건(Condition)이 true가 된다면 이는 정책을 위반하였다고 판단하고, 이 이유와 어떠한 라벨을 빼먹었는지를 msg와 missing 변수에 담아 반환한다. 이후 `spec.enforcementAction`에 따라 Enforce(Deny)하거나 경고(Warn/Audit)을 남긴다.

> 이 포스팅에선 정책을 위반한 사항에 대해 Enforce 방식을 실습한다. Gatekeeper의 경우 Constraint status, Kyverno의 경우 PolicyReport CRD에서 알림을 확인하거나, Prometheus 등을 위해 `/metrics` 엔드포인트를 제공한다. (kyverno-svc-metrics :8000, gatekeeper :8888)

위 함수는 Constraint를 통해 전달받은 Data(`labels[]` 파라미터)를 Input인 `metadata.labels[]`와 비교하여 빠진 부분이 없는지 확인하고, 만약 변수 `missing`에 포함된 값이 1 이상이라면 true와 메시지(`msg`), 그리고 무엇이 빠졌는지(`missing`)를 반환한다.

이를 아래와 같이 Constraint CRD인 K8sRequiredLabels에서 데이터(파라미터) 값과 함께 사용할 수 있고, 특정한 대상(ApiGroup, Kind, Namespace 등)을 지정하여 이 정책을 실행할 수 있다.

```yaml
# gatekeeper/k8srequiredlabels-constraint.yaml

apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels
metadata:
    name: demo-required-labels
spec:
    match:
        kinds:
            - apiGroups: ['']
              kinds: ['Pod']
        namespaces: ['demo-pac']
    parameters:
        labels: ['app', 'owner']
```

실습에서는 `demo-pac` 네임스페이스의 모든 Pod를 대상으로, `app`과 `owner` 라벨(`metadata.labels`)이 없다면 정책을 위반한다는 Constraints을 작성하였다. 아래와 같이 두 라벨을 제외하고 Pod를 만들어보자.

### Testing

```yaml
# gatekeeper/k8srequiredlabels-testing.yaml

apiVersion: v1
kind: Pod
metadata:
    name: web-bad-gk
    namespace: demo-pac
    labels:
        app: web-bad-gk
        # missing required 'owner' label
spec:
    containers:
        - name: nginx
          image: nginx:stable-alpine3.23
          ports:
              - containerPort: 80
```

```shell
kubectl apply -f gatekeeper/k8srequiredlabels-template.yaml
kubectl apply -f gatekeeper/k8srequiredlabels-constraint.yaml
```

```shell
> kubectl apply -f gatekeeper/k8srequiredlabels-testing.yaml

Error from server (Forbidden): error when creating "gatekeeper/k8srequiredlabels-testing.yaml": admission webhook "validation.gatekeeper.sh" denied the request:
[demo-required-labels] Missing required labels: {"owner"}
```

그럼 위와 같이 `validation.gatekeeper.sh` API Group의 Admission Webhook에서 에러를 반환하는 것을 볼 수 있다.

또한 위 테스트 오브젝트에서 `owner` 라벨을 추가한다면 Admission Webhook을 통과하는 것을 볼 수 있다.

```shell
> kubectl apply -f gatekeeper/k8srequiredlabels-testing.yaml

pod/web-bad-gk created
```

> Gatekeeper는 기본적으로 ReplicaSet, Deployment, Job과 같은 컨트롤러가 생성하는 파드에 대해 Admission 검증을 하지 않는다.
>
> 이는 불필요하고 예측 불가능한 컨트롤러의 파드 생성에 대한 Admission 검증을 건너뛰어 성능 문제를 해결하기 위함이며, 컨트롤러가 생성하는 파드의 경우 컨트롤러에 대한 정책을 따로 작성해야 한다.

## II. K8sDisallowLatest

```yaml
# gatekeeper/k8sdisallowlatest-template.yaml

apiVersion: templates.gatekeeper.sh/v1beta1
kind: ConstraintTemplate
metadata:
    name: k8sdisallowlatest
spec:
    crd:
        spec:
            names:
                kind: K8sDisallowLatest
    targets:
        - target: admission.k8s.gatekeeper.sh
          rego: |
              package k8sdisallowlatest

              is_tagless(image) {
                not contains(image, ":")
                not contains(image, "@sha256:")
              }

              is_latest(image) {
                endswith(image, ":latest")
              }

              all_containers[c] {
                c := input.review.object.spec.containers[_]
              }
              all_containers[c] {
                c := input.review.object.spec.initContainers[_]
              }

              violation[{"msg": msg, "details": {"image": image}}] {
                c := all_containers[_]
                image := c.image
                is_tagless(image)
                msg := sprintf("Required image tag is missing for image: %v", [image])
              }

              violation[{"msg": msg, "details": {"image": image}}] {
                c := all_containers[_]
                image := c.image
                is_latest(image)
                msg := sprintf("Image tag 'latest' is not allowed: %v", [image])
              }
```

이 예제는 컨테이너 이미지의 태그나 Digest가 없을 경우이거나 Latest일 경우 에러를 반환하는 정책이다. 보안상의 이유 등으로 특정 버전(태그)이나 Digest를 명시하지 않은 이미지를 막는 정책이 필요할 때 위와 같은 PaC를 작성할 수 있다.

```yaml
# gatekeeper/k8sdisallowlatest-constraint.yaml

apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sDisallowLatest
metadata:
    name: demo-disallow-latest
spec:
    match:
        kinds:
            - apiGroups: ['']
              kinds: ['Pod']
        namespaces: ['demo-pac']
```

### Testing

```yaml
# gatekeeper/k8sdisallowlatest-testing.yaml

apiVersion: v1
kind: Pod
metadata:
    name: web-bad-gk
    namespace: demo-pac
    labels:
        app: web-bad-gk
        owner: app-team
spec:
    containers:
        - name: nginx
          image: nginx:latest # disallowed 'latest' tag
          ports:
              - containerPort: 80
        - name: sidecar
          image: busybox # disallowed no tag/digest (defaults to 'latest')
          command: ['sleep', '3600']
```

`image: nginx:latest`나 `image: busybox`와 같이 특정 태그나 Digest를 명시하지 않은 경우나 Latest 태그를 사용하였을 경우 아래와 같이 Admission 검증 에러를 발생시킨다.

```shell
kubectl apply -f gatekeeper/k8sdisallowlatest-template.yaml
kubectl apply -f gatekeeper/k8sdisallowlatest-constraint.yaml
```

```shell
> kubectl apply -f gatekeeper/k8sdisallowlatest-testing.yaml
Error from server (Forbidden): error when creating "gatekeeper/k8sdisallowlatest-testing.yaml": admission webhook "validation.gatekeeper.sh" denied the request:
[demo-disallow-latest] Image tag 'latest' is not allowed: nginx:latest
[demo-disallow-latest] Required image tag is missing for image: busybox
```

## III. K8sDisallowPrivileged

```yaml
# gatekeeper/k8sdisallowprivileged-template.yaml

apiVersion: templates.gatekeeper.sh/v1beta1
kind: ConstraintTemplate
metadata:
    name: k8sdisallowprivileged
spec:
    crd:
        spec:
            names:
                kind: K8sDisallowPrivileged
    targets:
        - target: admission.k8s.gatekeeper.sh
          rego: |
              package k8sdisallowprivileged

              all_containers[c] {
                c := input.review.object.spec.containers[_]
              }
              all_containers[c] {
                c := input.review.object.spec.initContainers[_]
              }

              violation[{"msg": msg, "details": {"container": cname}}] {
                c := all_containers[_]
                c.securityContext.privileged == true
                cname := c.name
                msg := sprintf("Privileged mode is not allowed for container: %v", [cname])
              }
```

이 예제는 Privileged 모드가 활성화된 Pod 생성을 방지하는 정책으로, 컨테이너의 Privileged 모드는 호스트의 OS/커널을 비롯한 모든 리소스에 접근할 수 있는 위험한 기능이다. 정말 특별한 경우가 아니라면 사용해선 안되는 기능으로, 정책으로 막아두는 것을 추천한다.

```yaml
# gatekeeper/k8sdisallowprivileged-constraint.yaml

apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sDisallowPrivileged
metadata:
    name: demo-disallow-privileged
spec:
    match:
        kinds:
            - apiGroups: ['']
              kinds: ['Pod']
        namespaces: ['demo-pac']
```

### Testing

```yaml
# gatekeeper/k8sdisallowprivileged-testing.yaml

apiVersion: v1
kind: Pod
metadata:
    name: bad-privileged
    namespace: demo-pac
    labels:
        app: bad-privileged
        owner: demo
spec:
    containers:
        - name: pwn
          image: busybox:1.36
          command: ['sh', '-c', 'id; sleep 3600']
          securityContext:
              privileged: true # disallow privileged mode
```

이 예제는 `pwn` 컨테이너의 보안 속성(securityContext) 중 `privileged`를 활성화한 예제로, 정책에 의해 차단되어야한다.

```shell
kubectl apply -f gatekeeper/k8sdisallowprivileged-template.yaml
kubectl apply -f gatekeeper/k8sdisallowprivileged-constraint.yaml
```

```shell
> kubectl apply -f gatekeeper/k8sdisallowprivileged-testing.yaml
Error from server (Forbidden): error when creating "gatekeeper/k8sdisallowprivileged-testing.yaml": admission webhook "validation.gatekeeper.sh" denied the request:
[demo-disallow-privileged] Privileged mode is not allowed for container: pwn
```

## IV. K8sDisallowHostPath

```yaml
# gatekeeper/k8sdisallowhostpath-template.yaml

apiVersion: templates.gatekeeper.sh/v1beta1
kind: ConstraintTemplate
metadata:
    name: k8sdisallowhostpath
spec:
    crd:
        spec:
            names:
                kind: K8sDisallowHostPath
    targets:
        - target: admission.k8s.gatekeeper.sh
          rego: |
              package k8sdisallowhostpath

              violation[{"msg": msg, "details": {"volume": vname}}] {
                v := input.review.object.spec.volumes[_]
                v.hostPath
                vname := v.name
                msg := sprintf("HostPath volumes are not allowed: %v", [vname])
              }
```

볼륨 속성 중 Host Path는 노드의 종속성으로 인한 이식성 문제와 보안 취약점, 확장성 등의 문제로 권장되지 않는 방법이다. 이는 위와 같은 Rego PaC로 제한할 수 있다.

```yaml
# gatekeeper/k8sdisallowhostpath-constraint.yaml

apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sDisallowHostPath
metadata:
    name: demo-disallow-hostpath
spec:
    match:
        kinds:
            - apiGroups: ['']
              kinds: ['Pod']
        namespaces: ['demo-pac']
```

### Testing

```yaml
# gatekeeper/k8sdisallowhostpath-testing.yaml

apiVersion: v1
kind: Pod
metadata:
    name: bad-hostpath
    namespace: demo-pac
    labels:
        app: bad-hostpath
        owner: demo
spec:
    volumes:
        - name: host-root
          hostPath:
              path: /
              type: Directory
    containers:
        - name: reader
          image: busybox:1.36
          command: ['sh', '-c', 'ls -la /host || true; sleep 3600']
          volumeMounts:
              - name: host-root
                mountPath: /host # disallowed host path
```

```shell
kubectl apply -f gatekeeper/k8sdisallowhostpath-template.yaml
kubectl apply -f gatekeeper/k8sdisallowhostpath-constraint.yaml
```

```shell
> kubectl apply -f gatekeeper/k8sdisallowhostpath-testing.yaml
Error from server (Forbidden): error when creating "gatekeeper/k8sdisallowhostpath-testing.yaml": admission webhook "validation.gatekeeper.sh" denied the request:
[demo-disallow-hostpath] HostPath volumes are not allowed: host-root
```

# Demo — Kyverno

Kyverno는 Constraint Template과 Constraint CRD로 따로 구분하지 않는다. 이는 장점이 될 수도 있지만 단점이 될수도 있는 형태로, 개인적인 의견이지만 필자는 이 때문에 Kyverno보단 OPA Gatekeeper를 더욱 더 선호한다. 관련 생태계가 넓고 자료가 더 많은 것도 한몫한다.

PaC 정책을 선언하는 CRD로는 `kyverno.io/v1`의 `Policy`와 `ClusterPolicy`가 있는데, Role/ClusterRole과 같이 네임스페이스 단위이냐 클러스터 단위이냐의 차이이다.

Kyverno 예제에서도 `demo-pac` 네임스페이스를 그대로 사용하고, 아래와 같이 Helm Chart로 설치할 수 있다.

```shell
helm repo add kyverno https://kyverno.github.io/kyverno/
helm repo update

helm upgrade --install kyverno kyverno/kyverno -n kyverno --create-namespace

# kubectl -n kyverno rollout status deploy/kyverno-admission-controller
```

설치 시 `WARNING: Setting the admission controller replica count below 2 means Kyverno is not running in high availability mode.` 라는 경고 메시지가 나올 수 있는데, 이는 가용성을 위해 최소 2개의 Admission Controller를 배치하라는 의미로 Helm Chart를 수정하여 수를 늘릴 수 있다. 실습에선 무시하겠다.

## I. Mutate Fields

```yaml
# kyverno/add-managed-label.yaml

apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
    name: add-managed-label
spec:
    background: true
    rules:
        - name: add-managed-label-to-pods
          match:
              any:
                  - resources:
                        kinds:
                            - Pod
                        namespaces:
                            - demo-pac
          mutate:
              patchStrategicMerge:
                  metadata:
                      labels:
                          policy.kyverno.io/managed: 'true'
```

이 예제는 Admission/Audit 레벨에서 리소스 내용을 변조하는 Mutation Admission으로, `background` 필드를 활성화하였기 때문에 Admission 뿐만 아니라 Audit 상태, 즉 리소스가 만들어진 이후에도 주기적으로(`backgroundScanInterval`, 기본 1시간) 검증하고 리소스를 변조한다.

여기선 Pod 리소스에 대해 `policy.kyverno.io/managed: true` 라벨을 필수적으로 붙게 하도록 하는 정책이다.

### Testing

```yaml
# kyverno/add-managed-label-testing.yaml

apiVersion: v1
kind: Pod
metadata:
    name: mutate-label-check
    namespace: demo-pac
    labels:
        app: mutate-label-check
        owner: demo
spec:
    containers:
        - name: nginx
          image: nginx:stable-alpine3.23
          ports:
              - containerPort: 80
```

```shell
kubectl apply -f kyverno/add-managed-label.yaml
```

```shell
> kubectl apply -f kyverno/add-managed-label-testing.yaml
pod/mutate-label-check created

> kubectl -n demo-pac get pods/mutate-label-check -o yaml | yq '.metadata.labels'
app: mutate-label-check
owner: demo
policy.kyverno.io/managed: "true" # by Kyverno ClusterPolicy
```

## II. Require Requests and Limits

```yaml
# kyverno/require-resources.yaml

apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
    name: require-requests-limits
spec:
    validationFailureAction: Enforce
    background: true
    rules:
        - name: require-cpu-mem-requests-limits
          match:
              any:
                  - resources:
                        kinds:
                            - Pod
                        namespaces:
                            - demo-pac
          validate:
              message: 'Need to specify CPU and Memory requests and limits for all containers.'
              pattern:
                  spec:
                      containers:
                          - resources:
                                requests:
                                    cpu: '?*'
                                    memory: '?*'
                                limits:
                                    cpu: '?*'
                                    memory: '?*'
```

이제 Validation으로 돌아와, 위 예제는 `spec.containers[].resources` 필드의 `requests`, `limits` 필드 및 각 필드의 `cpu`, `memory` 값이 포함되어 있도록 강제하는 정책이다.

### Testing

```yaml
# kyverno/require-resources-testing.yaml

apiVersion: v1
kind: Pod
metadata:
    name: no-resources-should-fail
    namespace: demo-pac
    labels:
        app: no-resources-should-fail
        owner: demo
spec:
    containers:
        - name: app
          image: busybox:1.36
          command: ['sh', '-c', 'echo hello; sleep 3600']
```

```shell
kubectl apply -f kyverno/require-resources.yaml
```

```shell
> kubectl apply -f kyverno/require-resources-testing.yaml
Error from server: error when creating "kyverno/require-resources-testing.yaml": admission webhook "validate.kyverno.svc-fail" denied the request:

resource Pod/demo-pac/no-resources-should-fail was blocked due to the following policies

require-requests-limits:
  require-cpu-mem-requests-limits: 'validation error: Need to specify CPU and Memory
    requests and limits for all containers. rule require-cpu-mem-requests-limits failed
    at path /spec/containers/0/resources/limits/'
```

마찬가지로 아래와 같이 `resource` 필드를 채워서 적용하면 문제 없이 적용되는 것을 확인할 수 있다.

```yaml
resources:
    requests:
        cpu: '100m'
        memory: '128Mi'
    limits:
        cpu: '200m'
        memory: '256Mi'
```

```shell
> kubectl apply -f kyverno/require-resources-testing.yaml
pod/no-resources-should-fail created
```

## III. Pod Security

```yaml
# kyverno/pod-security.yaml

apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
    name: require-pod-security-baseline
spec:
    validationFailureAction: Enforce
    background: true
    rules:
        - name: require-seccomp-and-nonroot
          match:
              any:
                  - resources:
                        kinds:
                            - Pod
                        namespaces:
                            - demo-pac
          validate:
              message: 'Pod must comply with Pod Security Baseline: seccompProfile set to RuntimeDefault, runAsNonRoot true, no privilege escalation, readOnlyRootFilesystem true, drop all capabilities.'
              pattern:
                  spec:
                      securityContext:
                          seccompProfile:
                              type: RuntimeDefault
                      containers:
                          - securityContext:
                                runAsNonRoot: true
                                allowPrivilegeEscalation: false
                                readOnlyRootFilesystem: true
                                capabilities:
                                    drop:
                                        - ALL
```

아까의 Privilleged 컨테이너를 제한하는 정책 예제와 같이 보안 속성과 관련한 정책으로, Root 권한 상승과 같은 보안적인 이유로 위와 같이 제한해두는 경우가 많다. (각 필드에 대해선 따로 찾아보길 바란다.)

### Testing

```yaml
# kyverno/pod-security-testing.yaml

apiVersion: v1
kind: Pod
metadata:
    name: pod-security-should-fail
    namespace: demo-pac
    labels:
        app: pod-security-should-fail
        owner: demo
spec:
    # no seccompProfile (or Unconfined)
    containers:
        - name: app
          image: busybox:1.36
          command: ['sh', '-c', 'id; sleep 3600']
          securityContext:
              runAsNonRoot: false
              allowPrivilegeEscalation: true
              readOnlyRootFilesystem: false
              # no capabilities.drop: ["ALL"]
          resources:
              requests:
                  cpu: '50m'
                  memory: '64Mi'
              limits:
                  cpu: '200m'
                  memory: '256Mi'
```

```shell
kubectl apply -f kyverno/pod-security.yaml
```

```shell
> kubectl apply -f kyverno/pod-security-testing.yaml
Error from server: error when creating "kyverno/pod-security-testing.yaml": admission webhook "validate.kyverno.svc-fail" denied the request:

resource Pod/demo-pac/pod-security-should-fail was blocked due to the following policies

require-pod-security-baseline:
  require-seccomp-and-nonroot: 'validation error: Pod must comply with Pod Security
    Baseline: seccompProfile set to RuntimeDefault, runAsNonRoot true, no privilege
    escalation, readOnlyRootFilesystem true, drop all capabilities. rule require-seccomp-and-nonroot
    failed at path /spec/containers/0/securityContext/allowPrivilegeEscalation/'
```

## IV. Restrict LB Service

```yaml
# kyverno/restrict-lb-service.yaml

apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
    name: restrict-service-loadbalancer
spec:
    validationFailureAction: Enforce
    background: true
    rules:
        - name: block-loadbalancer-services
          match:
              any:
                  - resources:
                        kinds:
                            - Service
                        namespaces:
                            - demo-pac
          validate:
              message: 'LoadBalancer type Services are not allowed in this namespace.'
              pattern:
                  spec:
                      type: '!LoadBalancer'
```

사내 또는 인프라 운영 팀의 정책이나 거버넌스에 의해 Load Balancer를 프로비저닝할 수 없도록 하는 경우가 간혹 존재한다. 이때 Kubernetes에선 LoadBalancer 타입의 서비스를 만드는 것을 방지하는 정책을 걸어두기도 하는데, 위와 같이 `!` 문법을 통해 제한할 수 있다.

### Testing

```yaml
# kyverno/restrict-lb-service-testing.yaml

apiVersion: v1
kind: Service
metadata:
    name: lb-should-fail
    namespace: demo-pac
    labels:
        app: lb-should-fail
        owner: demo
spec:
    type: LoadBalancer
    selector:
        app: foo
    ports:
        - name: http
          port: 80
          targetPort: 80
```

```shell
kubectl apply -f kyverno/restrict-lb-service.yaml
```

```shell
> kubectl apply -f kyverno/restrict-lb-service-testing.yaml
Error from server: error when creating "kyverno/restrict-lb-service-testing.yaml": admission webhook "validate.kyverno.svc-fail" denied the request:

resource Service/demo-pac/lb-should-fail was blocked due to the following policies

restrict-service-loadbalancer:
  block-loadbalancer-services: 'validation error: LoadBalancer type Services are not
    allowed in this namespace. rule block-loadbalancer-services failed at path /spec/type/'
```

## V. Generate default Quota and LimitRange

```yaml
# kyverno/generate-quota-and-limitrange.yaml

apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
    name: generate-quota-and-limitrange
spec:
    background: true
    rules:
        - name: gen-resourcequota
          match:
              any:
                  - resources:
                        kinds:
                            - Namespace
                        names:
                            - demo-pac
          generate:
              apiVersion: v1
              kind: ResourceQuota
              name: demo-quota
              namespace: '{{ request.object.metadata.name }}'
              synchronize: true
              data:
                  spec:
                      hard:
                          pods: '20'
                          requests.cpu: '2'
                          requests.memory: '2Gi'
                          limits.cpu: '4'
                          limits.memory: '4Gi'
        - name: gen-limitrange
          match:
              any:
                  - resources:
                        kinds:
                            - Namespace
                        names:
                            - demo-pac
          generate:
              apiVersion: v1
              kind: LimitRange
              name: demo-limitrange
              namespace: '{{ request.object.metadata.name }}'
              synchronize: true
              data:
                  spec:
                      limits:
                          - type: Container
                            defaultRequest:
                                cpu: '50m'
                                memory: '64Mi'
                            default:
                                cpu: '200m'
                                memory: '256Mi'
```

마지막으로 Kyverno의 정책 규칙중엔 `generate` 규칙이 존재한다. 이는 자동으로 리소스를 생성하는 기능으로 `{{ request.object.metadata.name }}` 템플릿은 요청된 Namespace 리소스(`request.object`)의 `metadata.name`를 사용한다는 의미이다.

`spec.background`가 활성화되어있기 때문에 백그라운드에서 스캔되어 트리거 될 것이라 생각할 수 있지만, 백그라운드에서 트리거되는 `generate`는 Admission Request/Context가 없고 이는 generate의 소스가 될 수 없기 때문이다. 때문에 리소스를 생성하거나 업데이트할 때 generate가 트리거될 수 있다.

### Testing

```shell
kubectl apply -f kyverno/generate-quota-and-limitrange.yaml
```

그리고 아래와 같이 기존 네임스페이스 삭제하고 다시 만들어야 한다. 그 이유는 앞서 설명하였다.

```shell
kubectl delete all --all -n demo-pac
kubectl delete ns/demo-pac

kubectl create namespace demo-pac
```

그리고 해당 네임스페이스에서 ResourceQouta와 LimitRange 리소스를 확인해보자. 아래와 같이 자동으로 생성되는 것을 확인할 수 있다.

```shell
> kubectl -n demo-pac get resourcequotas,limitranges
NAME                       REQUEST                                                 LIMIT                                   AGE
resourcequota/demo-quota   pods: 0/20, requests.cpu: 0/2, requests.memory: 0/2Gi   limits.cpu: 0/4, limits.memory: 0/4Gi   13s

NAME                         CREATED AT
limitrange/demo-limitrange   2026-01-17T06:36:33Z
```

---

지금까지 Kubernetes에서 PaC 솔루션을 위한 방법 중 OPA Gatekeeper와 Kyverno에 대해 알아보았다. 필자를 포함한 주변 지인이나 팀 모두 OPA Gatekeeper를 더욱 선호하지만, Kubernetes Native나 Kubernetes 단독으로 적용할 정책/거버넌스/컴플라이언스가 있다면 Kyverno를 도입하는 것도 좋을 것 같다.
