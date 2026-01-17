---
title: '[Kubernetes] Operator Implemented using the Go language and Operator SDK'
description: 'Go 언어에서 Operator SDK를 통한 쿠버네티스 Operator 구현 실습'
slug: '2025-10-01-kubernetes-operator-go'
author: yulmwu
date: 2025-10-01T08:16:26.908Z
updated_at: 2026-01-08T08:18:03.446Z
categories: ['Kubernetes']
tags: ['kubernetes']
series:
    name: Kubernetes
    slug: kubernetes
thumbnail: ../../thumbnails/kubernetes/kubernetes-operator-go.png
linked_posts:
    previous: 2025-10-01-kubernetes-operator
    next: 2025-10-01-kubernetes-sealed-secrets
is_private: false
---

> 이전 포스팅의 후속 포스팅입니다.
>
> https://velog.io/@yulmwu/kubernetes-operator

# Example Demo

전에 Prometheus Operator를 Helm을 통해 설치하고 ServiceMonitor CR을 선언하여 실습해보았다면, 이번엔 직접 Operator를 만들어보자.

직접 CRD를 만들고 SDK 등을 사용하여 Controller를 만드는 것은 일반적인 상황에선 쉽지 않은 일이며, 보통은 Prometheus Operator나 (클라우드에서 제공하지 않는 경우) DB Operator 처럼 Third Party로 제공되는 Operator를 사용하는 편이다.

하지만 Operator를 직접 개발하여 사용하는 기업도 있을테고, 직접 만들어보는 것도 좋은 경험이니 이 포스팅에선 Go 언어를 사용해서 제작해보겠다.

우리가 만들고자 하는 Operator는 아래와 같다.

- MyCRD 생성, `replicas` 및 `image` 필드 추가
- Controller는 해당 필드를 보고 Deployment를 생성해줌

## (1) Initiation Project

> `go`, `make`, `operator-sdk` 명령어가 필요하니 적절히 설치해주자. 필자와 같은 맥이라면 `make`는 XCode를 설치하면서 자동으로 설치되고, 나머지는 Homebrew로 간단히 설치할 수 있다.

먼저 아래의 `operator-sdk` 명령어를 통해 프로젝트를 세팅해주자.

```shell
operator-sdk init \
  --domain example.com \
  --repo mycrd-operator
```

여기서 `--domain` 옵션은 apiVersion에서 `group.example.com/v1alpha1`과 같은 API 도메인을 의미하고, `repo`는 Go 프로젝트 명을 의미한다.

위 명령어로 프로젝트를 만들면 아래와 같은 템플릿이 만들어진다.

```
> tree -a
.
├── .devcontainer
│   ├── devcontainer.json
│   └── post-install.sh
├── .dockerignore
├── .github
│   └── workflows
│       ├── lint.yml
│       ├── test-e2e.yml
│       └── test.yml
├── .gitignore
├── .golangci.yml
├── cmd
│   └── main.go
├── config
│   ├── default
│   │   ├── cert_metrics_manager_patch.yaml
│   │   ├── kustomization.yaml
│   │   ├── manager_metrics_patch.yaml
│   │   └── metrics_service.yaml
│   ├── manager
│   │   ├── kustomization.yaml
│   │   └── manager.yaml
│   ├── manifests
│   │   └── kustomization.yaml
│   ├── network-policy
│   │   ├── allow-metrics-traffic.yaml
│   │   └── kustomization.yaml
│   ├── prometheus
│   │   ├── kustomization.yaml
│   │   ├── monitor_tls_patch.yaml
│   │   └── monitor.yaml
│   ├── rbac
│   │   ├── kustomization.yaml
│   │   ├── leader_election_role_binding.yaml
│   │   ├── leader_election_role.yaml
│   │   ├── metrics_auth_role_binding.yaml
│   │   ├── metrics_auth_role.yaml
│   │   ├── metrics_reader_role.yaml
│   │   ├── role_binding.yaml
│   │   ├── role.yaml
│   │   └── service_account.yaml
│   └── scorecard
│       ├── bases
│       │   └── config.yaml
│       ├── kustomization.yaml
│       └── patches
│           ├── basic.config.yaml
│           └── olm.config.yaml
├── Dockerfile
├── go.mod
├── go.sum
├── hack
│   └── boilerplate.go.txt
├── Makefile
├── PROJECT
├── README.md
└── test
    ├── e2e
    │   ├── e2e_suite_test.go
    │   └── e2e_test.go
    └── utils
        └── utils.go

19 directories, 44 files
```

여기서 쿠버네티스 매니페스트 파일들이 위치한 `config` 디렉토리는 CRD 및 Operator RBAC 등의 설정이 위치한 곳으로, 추후 쿠버네티스에 해당 Operator를 적용할 때 사용한다.

이제 아래의 명령어로 MyCRD라는 이름의 CRD API를 생성해보자.

```shell
operator-sdk create api \
  --group demo \
  --version v1alpha1 \
  --kind MyCRD \
  --resource --controller
```

`demo` 그룹에 `v1alpha1` 버전으로 MyCRD API를 생성한다. 그럼 `api` 디렉토리가 생성되었을 것이다.

```
├── api
│   └── v1alpha1
│       ├── groupversion_info.go
│       ├── mycrd_types.go
│       └── zz_generated.deepcopy.go
```

그럼 프로젝트 세팅은 끝났다. 이제 MyCRD의 필드를 수정해보자.

## (2) CRD Defines

`api/v1alpha1/mycrd_types.go` 파일을 아래와 같이 수정해보자.

```go
package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type MyCRDSpec struct {
	// +optional
	Replicas *int32 `json:"replicas,omitempty"`
	// +optional
	Image string `json:"image,omitempty"`
}

// MyCRDStatus defines the observed state of MyCRD
type MyCRDStatus struct {
	// +optional
	AvailableReplicas int32 `json:"availableReplicas,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status
// +kubebuilder:resource:shortName=myc
// +kubebuilder:printcolumn:name="Desired",type=integer,JSONPath=`.spec.replicas`,description="Desired replicas",priority=0
// +kubebuilder:printcolumn:name="Available",type=integer,JSONPath=`.status.availableReplicas`,description="Available replicas",priority=0
// +kubebuilder:printcolumn:name="Image",type=string,JSONPath=`.spec.image`,description="Container image",priority=1
type MyCRD struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   MyCRDSpec   `json:"spec,omitempty"`
	Status MyCRDStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true
type MyCRDList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []MyCRD `json:"items"`
}

func init() {
	SchemeBuilder.Register(&MyCRD{}, &MyCRDList{})
}
```

하나하나 살펴보자. `MyCRDSpec` 구조체는 MyCRD에서 `spec` 필드를 정의한다. `spec.replicas` 및 `spec.image`를 정의하고, `MyCRDStatus`는 해당 CRD의 상태를 정의한다. 여기선 몇개의 파드가 동작하는지를 나타내는 `AvailableReplicas`를 정의하였다.

그리고 `MyCRD` 구조체는 이름 그대로 MyCRD를 정의하는 것으로, 매니페스트에 포함된 내용과 동일하다.

```yaml
apiVersion: demo.example.com/v1alpha1
kind: MyCRD
metadata:
    name: mycrd-sample
    namespace: default
spec:
    replicas: 1
    image: nginx:1.25.3
```

```shell
> kubectl describe mycrd
Name:         mycrd-sample
Namespace:    default
Labels:       <none>
Annotations:  <none>
API Version:  demo.example.com/v1alpha1
Kind:         MyCRD
Metadata:
  Creation Timestamp:  2025-10-05T00:38:36Z
  Generation:          2
  Resource Version:    121148
  UID:                 5e140c60-a65c-4a73-b24b-9dd440584a70
Spec:
  Image:     nginx:1.25.3
  Replicas:  1
Status:
  Available Replicas:  1
```

그리고 `// +kubebuilder:printcolumn:...` 필드를 통해 `kubectl get mycrd/...` 명령어 실행 시 나타나는 컬럼을 설정할 수 있다.

이렇게 CRD를 정의하였으면 Makefile에 포함된 아래의 명령어를 통해 매니페스트 파일을 생성해보자.

```shell
make generate
make manifests
```

그럼 `config/crd/bases/demo.example.com_mycrds.yaml`에 아래와 같은 CRD 매니페스트가 생성된 것을 볼 수 있다.

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
    annotations:
        controller-gen.kubebuilder.io/version: v0.18.0
    name: mycrds.demo.example.com
spec:
    group: demo.example.com
    names:
        kind: MyCRD
        listKind: MyCRDList
        plural: mycrds
        shortNames:
            - myc
        singular: mycrd
    scope: Namespaced
    versions:
        - additionalPrinterColumns:
              - description: Desired replicas
                jsonPath: .spec.replicas
                name: Desired
                type: integer
              - description: Available replicas
                jsonPath: .status.availableReplicas
                name: Available
                type: integer
              - description: Container image
                jsonPath: .spec.image
                name: Image
                priority: 1
                type: string
          name: v1alpha1
          schema:
              openAPIV3Schema: ... # (생략)
```

다음으로 Controller, 즉 Reconcile 로직을 작성해보자.

## (3) Controller

컨트롤러의 코드는 `internal/controller`에 위치해있다. 아래와 같이 코드를 수정해보자.

```go
package controller

import (
	"context"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/log"

	demov1alpha1 "mycrd-operator/api/v1alpha1"
)

type MyCRDReconciler struct {
	client.Client
	Scheme *runtime.Scheme
}

// +kubebuilder:rbac:groups=demo.example.com,resources=mycrds,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=demo.example.com,resources=mycrds/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=demo.example.com,resources=mycrds/finalizers,verbs=update
// +kubebuilder:rbac:groups=apps,resources=deployments,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups="",resources=pods,verbs=get;list;watch
func (r *MyCRDReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	logger := log.FromContext(ctx).WithValues("mycrd", req.NamespacedName)

	var my demov1alpha1.MyCRD
	if err := r.Get(ctx, req.NamespacedName, &my); err != nil {
		if errors.IsNotFound(err) {
			return ctrl.Result{}, nil
		}
		return ctrl.Result{}, err
	}

	var replicas int32 = 1
	if my.Spec.Replicas != nil {
		replicas = *my.Spec.Replicas
	}

	image := my.Spec.Image
	if image == "" {
		image = "nginx:1.25.3"
	}

	deployName := fmt.Sprintf("%s-deploy", my.Name)
	labels := map[string]string{
		"app":   my.Name,
		"mycrd": my.Name,
	}

	var deploy appsv1.Deployment
	deploy.Namespace = my.Namespace
	deploy.Name = deployName

	mutate := func() error {
		if err := controllerutil.SetControllerReference(&my, &deploy, r.Scheme); err != nil {
			return err
		}

		if deploy.Spec.Selector == nil {
			deploy.Spec.Selector = &metav1.LabelSelector{MatchLabels: labels}
		}

		deploy.Spec.Replicas = &replicas
		deploy.Spec.Template.ObjectMeta.Labels = labels
		deploy.Spec.Template.Spec = corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name:  "app",
					Image: image,
					Ports: []corev1.ContainerPort{{Name: "http", ContainerPort: 80}},
				},
			},
		}
		return nil
	}

	op, err := controllerutil.CreateOrUpdate(ctx, r.Client, &deploy, mutate)
	if err != nil {
		return ctrl.Result{}, err
	}
	logger.Info("Deployment reconciled", "operation", op, "replicas", replicas, "image", image)

	var fresh appsv1.Deployment
	if err := r.Get(ctx, types.NamespacedName{Name: deployName, Namespace: my.Namespace}, &fresh); err == nil {
		if my.Status.AvailableReplicas != fresh.Status.AvailableReplicas {
			my.Status.AvailableReplicas = fresh.Status.AvailableReplicas
			if err := r.Status().Update(ctx, &my); err != nil {
				logger.Error(err, "failed to update MyCRD status")
				return ctrl.Result{}, err
			}
		}
	}

	return ctrl.Result{}, nil
}

func (r *MyCRDReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&demov1alpha1.MyCRD{}).
		Owns(&appsv1.Deployment{}).
		Complete(r)
}
```

MyCRD를 가져오고 이를 바탕으로 Deployment를 Reconcile 한다. 다시 아래의 명령어를 통해 실행(빌드)에 필요한 코드와 매니페스트 파일을 생성해보자.

```shell
make generate
make manifests
```

## (4) CRD Testing

이제 `make install` 및 `make run` 명령어로 Controller를 실행시켜보자. 그럼 아래와 같이 Controller가 실행되는 것을 볼 수 있다.

```yaml
> make run
/Users/workspace5/blog-example-demo/k8s-operator-example/go-operator/bin/controller-gen rbac:roleName=manager-role crd webhook paths="./..." output:crd:artifacts:config=config/crd/bases
/Users/workspace5/blog-example-demo/k8s-operator-example/go-operator/bin/controller-gen object:headerFile="hack/boilerplate.go.txt" paths="./..."
go fmt ./...
go vet ./...
go run ./cmd/main.go
2025-10-05T10:52:01+09:00       INFO    setup   starting manager
2025-10-05T10:52:01+09:00       INFO    starting server {"name": "health probe", "addr": "[::]:8081"}
2025-10-05T10:52:01+09:00       INFO    Starting EventSource    {"controller": "mycrd", "controllerGroup": "demo.example.com", "controllerKind": "MyCRD", "source": "kind source: *v1alpha1.MyCRD"}
2025-10-05T10:52:01+09:00       INFO    Starting EventSource    {"controller": "mycrd", "controllerGroup": "demo.example.com", "controllerKind": "MyCRD", "source": "kind source: *v1.Deployment"}
2025-10-05T10:52:01+09:00       INFO    Starting Controller     {"controller": "mycrd", "controllerGroup": "demo.example.com", "controllerKind": "MyCRD"}
2025-10-05T10:52:01+09:00       INFO    Starting workers        {"controller": "mycrd", "controllerGroup": "demo.example.com", "controllerKind": "MyCRD", "worker count": 1}
```

이렇게 Controller를 로컬에서 켜두고, 예시의 MyCRD를 만들어보자. `config/samples/demo_v1alpha1_mycrd.yaml`을 아래와 같이 수정하고 적용해보자.

```yaml
apiVersion: demo.example.com/v1alpha1
kind: MyCRD
metadata:
    name: mycrd-sample
    namespace: default
spec:
    replicas: 1
    image: nginx:1.25.3
```

```shell
kubectl apply -f config/samples/demo_v1alpha1_mycrd.yaml
```

적용 후 상태를 확인해보자.

```yaml
> kubectl get deployment,pods,mycrd
NAME                                  READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/mycrd-sample-deploy   1/1     1            1           15s

NAME                                       READY   STATUS    RESTARTS   AGE
pod/mycrd-sample-deploy-6c87758ddf-jhvlc   1/1     Running   0          15s

NAME                                  DESIRED   AVAILABLE
mycrd.demo.example.com/mycrd-sample   1         1
```

이렇게 CRD가 적용됨에 따라 Deployment가 잘 생성된 것을 볼 수 있다. Controller의 로그도 아래와 같이 확인할 수 있다.

```yaml
2025-10-05T10:54:07+09:00       INFO    Deployment reconciled   {"controller": "mycrd", "controllerGroup": "demo.example.com", "controllerKind": "MyCRD", "MyCRD": {"name":"mycrd-sample","namespace":"default"}, "namespace": "default", "name": "mycrd-sample", "reconcileID": "60dc8e55-df75-4567-b417-98dee8a88521", "mycrd": {"name":"mycrd-sample","namespace":"default"}, "operation": "created", "replicas": 1, "image": "nginx:1.25.3"}
2025-10-05T10:54:07+09:00       INFO    Deployment reconciled   {"controller": "mycrd", "controllerGroup": "demo.example.com", "controllerKind": "MyCRD", "MyCRD": {"name":"mycrd-sample","namespace":"default"}, "namespace": "default", "name": "mycrd-sample", "reconcileID": "b49ba3a0-e178-4378-8c79-a3ba8ae1af37", "mycrd": {"name":"mycrd-sample","namespace":"default"}, "operation": "updated", "replicas": 1, "image": "nginx:1.25.3"}
...
```

이제 `spec.replicas`를 3으로 변경해보자.

```yaml
> kubectl apply -f config/samples/demo_v1alpha1_mycrd.yaml
mycrd.demo.example.com/mycrd-sample configured

> kubectl get deployment,pods,mycrd
NAME                                  READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/mycrd-sample-deploy   3/3     3            3           2m20s

NAME                                       READY   STATUS    RESTARTS   AGE
pod/mycrd-sample-deploy-6c87758ddf-87s5g   1/1     Running   0          1s
pod/mycrd-sample-deploy-6c87758ddf-bhddx   1/1     Running   0          1s
pod/mycrd-sample-deploy-6c87758ddf-jhvlc   1/1     Running   0          2m20s

NAME                                  DESIRED   AVAILABLE
mycrd.demo.example.com/mycrd-sample   3         3
```

```yaml
2025-10-05T10:56:27+09:00       INFO    Deployment reconciled   {"controller": "mycrd", "controllerGroup": "demo.example.com", "controllerKind": "MyCRD", "MyCRD": {"name":"mycrd-sample","namespace":"default"}, "namespace": "default", "name": "mycrd-sample", "reconcileID": "66310913-b7fa-40a0-b2ff-08f39d44bce9", "mycrd": {"name":"mycrd-sample","namespace":"default"}, "operation": "updated", "replicas": 3, "image": "nginx:1.25.3"}
```

이렇게 잘 동작하는 것을 볼 수 있고, 만약 Controller를 종료하게 된다면 CRD를 수정해도 적용되지 않는 것을 볼 수 있을 것이다.

그런데 이러한 Controller를 로컬에서 항상 켜둘 순 없는데, 그래서 이러한 Controller를 컨테이너화해서 쿠버네티스 클러스터에 파드로 올려둔다.

## (5) Deploy Controller Container

Github Container Registry나 ECR 등의 컨테이너 이미지 레지스트리를 사용할 수 있지만, 필자는 Docker Hub를 통해 배포해보겠다.

Docker Hub 로그인 및 아래와 같은 명령어를 통해 빌드 및 Push 해보자. (마찬가지로 Makefile에 포함된 명령어이다)

```shell
make docker-build IMG=docker.io/rlawnsdud/mycrd-operator:v0.1.0 # 본인의 레포지토리에 맞게 수정
make docker-push  IMG=docker.io/rlawnsdud/mycrd-operator:v0.1.0
```

![](https://velog.velcdn.com/images/yulmwu/post/39b38a14-5d57-4c6c-9058-3cfb407b06e0/image.png)

그리고 아래의 Makefile에 포함된 명령어로 클러스터에 배포해보자.

```shell
make deploy IMG=docker.io/rlawnsdud/mycrd-operator:v0.1.0

> kubectl get all -n go-operator-system
NAME                                                  READY   STATUS    RESTARTS   AGE
pod/go-operator-controller-manager-6f9dcd6c98-zgbcb   1/1     Running   0          55s

NAME                                                     TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)    AGE
service/go-operator-controller-manager-metrics-service   ClusterIP   10.98.142.206   <none>        8443/TCP   55s

NAME                                             READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/go-operator-controller-manager   1/1     1            1           55s

NAME                                                        DESIRED   CURRENT   READY   AGE
replicaset.apps/go-operator-controller-manager-6f9dcd6c98   1         1         1       55s
```

그럼 위와 같이 `go-operator-system` 네임스페이스에 Operator Controller가 배포된 것을 확인할 수 있으며, 잘 동작하는지 확인할 수 있다.

```yaml
# spec.replicas: 2로 수정

> kubectl get deployment,pods,mycrd
NAME                                  READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/mycrd-sample-deploy   2/2     2            2           16m

NAME                                       READY   STATUS      RESTARTS   AGE
pod/mycrd-sample-deploy-6c87758ddf-87s5g   1/1     Running     0          13m
pod/mycrd-sample-deploy-6c87758ddf-bhddx   1/1     Running     0          13m
pod/mycrd-sample-deploy-6c87758ddf-jhvlc   0/1     Completed   0          16m

NAME                                  DESIRED   AVAILABLE
mycrd.demo.example.com/mycrd-sample   2         2
```

실제 서비스에선 Operator를 Helm 차트로 만들어 배포하겠지만, 거기까진 복잡하니 Makefile에 포함된 명령어로 클러스터에 배포하는 것 까지만 실습해보았다.

이상으로 Go Operator SDK를 사용한 Operator 실습을 마치겠다. 이러한 Operator SDK에 대한 자세한 문서는 https://book.kubebuilder.io 에서 확인해볼 수 있다.
