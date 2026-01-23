---
title: '[Kubernetes] Secret Encryption with Sealed Secrets'
description: 'Sealed Secrets를 통한 외부 시크릿 저장소 없이 암호화된 시크릿 사용 방법'
slug: '2025-10-02-kubernetes-sealed-secrets'
author: yulmwu
date: 2025-10-02T02:48:42.263Z
updated_at: 2026-01-21T14:01:14.493Z
categories: ['Kubernetes']
tags: ['kubernetes']
series:
    name: Kubernetes
    slug: kubernetes
thumbnail: ../../thumbnails/kubernetes/kubernetes-sealed-secrets.png
linked_posts:
    previous: 2025-10-02-kubernetes-operator-go
    next: 2025-10-02-kubernetes-istio-envoy
is_private: false
---

# 0. Overview

쿠버네티스에서 API 엑세스 키나 시크릿 키 등의 비밀 키를 사용해야 할 경우가 있다.

설정의 키-값을 저장하는 방법엔 쿠버네티스 네이티브 오브젝트인 ConfigMap과 Secret이 존재하는데, 이 중 Secret은 Base64로 값을 저장하기 때문에 바이너리 파일(인증서 등)도 저장할 수 있다.

```yaml
apiVersion: v1
kind: Secret
metadata:
    name: my-secret
type: Opaque
data: # base64
    username: bXkgdmVyeSBzZWNyZXQgdXNlcm5hbWU=
    password: dG9wIHNlY3JldCBwYXNzd29yZA==
    apikey: em5IaFJZQm1mY2tSRHpuSGhSWUJtZmNrUkQ=
---
apiVersion: v1
kind: Pod
metadata:
    name: my-pod
spec:
    containers:
        - name: my-container
          image: nginx
          envFrom:
              - secretRef:
                    name: my-secret

# kubectl apply -f example.yaml
# kubectl exec -it my-pod -- /bin/

# > env | egrep 'username|password|apikey'
# username=my very secret username
# apikey=znHhRYBmfckRDznHhRYBmfckRD
# password=top secret password
```

그런데 예를 들어보자. GitOps를 통해 쿠버네티스 리소스 매니페스트를 깃 레포지토리에 올려두고 사용한다고 해보자.

그러면 필요한 비밀 키도 같이 배포해야 하는데, Secret 오브젝트는 Base64로 저장되기 때문에 이럴 경우 비밀 키가 노출되기 때문에 보안상 문제가 될 수 있다.

이러한 문제를 방지할 수 있는데, 대표적으로 External Secrets와 Sealed Secrets를 사용할 수 있다.

External Secrets는 외부 저장소(AWS Secrets Manager 등)를 통해 시크릿을 관리하는 것인데, 외부 저장소를 사용할 수 없거나 이러한 시크릿 키를 반드시 깃허브 레포지토리에 포함시켜야 할 경우가 있을 수 있다.

# 1. What is Sealed Secrets?

Bitnami에서 개발한 [Sealed Secretes](https://github.com/bitnami-labs/sealed-secrets)는 시크릿을 암호화하여 저장한다. 그리고 클러스터에선 Sealed Secrets Controller가 복호화 및 실제론 Secret 리소스로 변환하여 사용한다.

때문에 Sealed Secrets Controller만이 가지고 있는 개인 키로만 복호화를 할 수 있고, 제공되는 공개 키를 통해 값을 암호화한다.

![](https://velog.velcdn.com/images/yulmwu/post/b8f8637a-f5e8-4c68-bcc4-2be4b533ed1e/image.png)

Sealed Secrets에선 CRD와 Operator Pattern을 통해 자동화되기 때문에 간단하게 Helm을 통해 설치 및 CR 선언만 하면 된다.

# 2. Example Demo

실습하기 앞서, 먼저 애플리케이션을 배포할 네임스페이스를 만들어두겠다.

```shell
kubectl create ns apps
```

그리고 Helm을 통해 Sealed Secrets Controller(Operator)를 설치해주겠다.

```shell
helm repo add sealed-secrets https://bitnami-labs.github.io/sealed-secrets
helm repo update
helm install sealed-secrets sealed-secrets/sealed-secrets \
  --namespace kube-system
```

```shell
> kubectl -n kube-system get pods -l app.kubernetes.io/name=sealed-secrets
NAME                              READY   STATUS    RESTARTS   AGE
sealed-secrets-54d6d7dc89-4tdnp   1/1     Running   0          32s

> kubectl -n kube-system get deploy sealed-secrets
NAME             READY   UP-TO-DATE   AVAILABLE   AGE
sealed-secrets   1/1     1            1           36s
```

그리고 kubeseal 유틸리티를 설치해주겠다. kubeseal 유틸리티는 SealedSecret CR을 쉽게 만들어주는(변환해주는) 도구이다. 물론 직접 SealedSecret을 작성해도 문제는 없다.

필자는 맥 환경이 때문에 Brew 명령어를 통해 설치해주었다. (`brew install kubeseal`)

혹시나 공개키를 가져와야 할 상황이라면 아래의 kubeseal 명령어를 통해 확인할 수 있다. (다만 kubeseal을 통해 SealedSecret을 만들 경우 자동으로 암호화된다.)

```shell
kubeseal \
  --controller-name=sealed-secrets \
  --controller-namespace=kube-system \
  --fetch-cert
```

사용할 Secret 오브젝트는 개요에서 만들어뒀던 아래의 Secret을 그대로 사용해보겠다. 다만 깃 레포지토리 등에 배포할 경우 이 오브젝트는 `.gitignore`에 추가하거나 올라가지 않도록 주의해야 한다.

```yaml
# secret.yaml

apiVersion: v1
kind: Secret
metadata:
    name: my-secret
type: Opaque
data:
    username: bXkgdmVyeSBzZWNyZXQgdXNlcm5hbWU=
    password: dG9wIHNlY3JldCBwYXNzd29yZA==
    apikey: em5IaFJZQm1mY2tSRHpuSGhSWUJtZmNrUkQ=
```

이제 아래의 명령어를 통해 Secret 오브젝트를 SealedSecret CR 오브젝트로 변환해보겠다.

```shell
kubeseal \
  --format=yaml \
  --scope=namespace-wide \
  --namespace=apps \
  --controller-name=sealed-secrets \
  --controller-namespace=kube-system \
  < secret.yaml > sealedsecret.yaml
```

그럼 `sealedsecret.yaml` 파일이 생성되고, 열어보면 아래와 같이 생성되었을 것이다.

```yaml
# sealedsecret.yaml

apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
    annotations:
        sealedsecrets.bitnami.com/namespace-wide: 'true'
    name: my-secret
    namespace: apps
spec:
    encryptedData:
        apikey: ...
        password: ...
        username: ....
    template:
        metadata:
            annotations:
                sealedsecrets.bitnami.com/namespace-wide: 'true'
            name: my-secret
            namespace: apps
        type: Opaque
```

그리고 `kubectl apply -f sealedsecret.yaml`을 통해 CR을 적용하면 된다. Sealed Secret과 컨트롤러에 의한 Secret 오브젝트가 잘 생성되었는지 확인해보자.

```shell
> kubectl -n apps get sealedsecrets,secrets
NAME                                 STATUS   SYNCED   AGE
sealedsecret.bitnami.com/my-secret            True     2m1s

NAME               TYPE     DATA   AGE
secret/my-secret   Opaque   3      2m1s

> kubectl -n apps get secrets -o json | egrep 'apikey|password|username'
	"apikey": "em5IaFJZQm1mY2tSRHpuSGhSWUJtZmNrUkQ=",
	"password": "dG9wIHNlY3JldCBwYXNzd29yZA==",
	"username": "bXkgdmVyeSBzZWNyZXQgdXNlcm5hbWU="

> kubectl exec -n apps -it my-pod -- /bin/sh
# > env | egrep 'username|password|apikey'
# username=my very secret username
# apikey=znHhRYBmfckRDznHhRYBmfckRD
# password=top secret password
```

이렇게 암호화된 SealedSecrets는 컨트롤러에 의해 복호화될 수 있고, 이로써 깃 레포지토리엔 `sealedsecret.yaml`만 올려도 되게 된다.

Sealed Secrets는 특히 GitOps 환경에서 매우 적합하고, 외부 시크릿 저장소를 사용하지 않기 때문에 추가적인 비용이 발생하지 않는다는 장점이 있고, 사용 방법도 매우 쉬운 걸 볼 수 있다.
