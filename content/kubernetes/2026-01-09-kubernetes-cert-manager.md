---
title: "[Kubernetes w/ EKS] Managing TLS/SSL Certificates with cert-manager"
description: "cert-manager를 통한 쿠버네티스 TLS/SSL 인증서 관리 (Feat. Let's Encrypt, DNS-01 ACME 및 AWS Route53 연동 실습)"
slug: "2026-01-09-kubernetes-cert-manager"
author: yulmwu
date: 2026-01-09T06:37:47.568Z
updated_at: 2026-01-17T11:27:26.392Z
categories: ["Kubernetes"]
tags: ["kubernetes"]
series:
  name: Kubernetes
  slug: kubernetes
thumbnail: ../../thumbnails/kubernetes/kubernetes-cert-manager.png
linked_posts:
  previous: 2026-01-09-kubernetes-eks-max-pods
  next: 2026-01-09-kubernetes-pod-probe
is_private: false
---

# 0. Overview

필요에 따라 Kubernetes Ingress나 Gateway API 레벨에서 **TLS Termination**을 해야할 상황이 있을 수 있다. 여러가지 이유가 있겠지만, 보통 아래의 경우일 것이다.

- Trust Boundary 정책에 TLS Termination이 Kubernetes 보안 경계 내부에 있어야 하거나 End-to-End, mTLS 암호화가 필수적인 경우
- 또는 규제 산업으로 인해 클러스터(조직) 내부에서 TLS/SSL 인증서를 소유해야하는 등등

이 포스팅에서는 Kubernetes에서 TLS Termination을 위한 TLS/SSL 인증서 관리에 대해서 Kubernetes 네이티브 오브젝트를 사용하는 방법과 그 한계와 단점, 그리고 **cert-manager**를 이용한 방법(사실상 표준)에 대해 다뤄보겠다.

> 물론 Ingress나 Gateway API의 Controller를 AWS LoadBalancer Controller로 둔다면 AWS ACM을 사용해볼 수도 있으나, 앞서 설명하였듯 클라우드 벤더가 아닌 Kubernetes에서 TLS Termination이 필요한 경우가 있다.
> 
> 실습에서는 Nginx Ingress Controller를 사용하고, AWS NLB는 TLS Passthrough가 되도록 설정하겠다.
> 
> ![](https://velog.velcdn.com/images/yulmwu/post/f74958ec-ca61-41ba-8460-e364cafd834f/image.png)

# 1. Kubernetes Native Objects

Kubernetes에서 네이티브 오브젝트로 TLS/SSL 인증서를 관리하는 방법은 `kubernetes.io/tls` 타입의 Secret을 사용하는 것이 대표적이다. 이 Secret은 아래와 같이 생겼다.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: tls-demo
type: kubernetes.io/tls
data:
  tls.crt: |
    MIIC2DCCAcCgAwIBAgIBATANBgkqh...
  tls.key: |
    MIIEpgIBAAKCAQEA7yn3bRHQ5FHMQ...
```

인증서 체인(`tls.crt`)과 개인 키(`tls.key`)가 포함된 X.509 인증서를 생성해야 하는데, 특정 도메인(`host`)을 연결하지 않고 NLB 주소로만 간단하게 테스트를 하기 위해 Passthrough NLB를 먼저 프로비저닝하고 X.509 인증서를 생성하도록 하겠다. (NLB 주소를 SAN으로 넣는건 권장하지 않는다.)

## (1) EKS Cluster

사용할 EKS Cluster는 아래와 같이 eksctl로 구성한다. (ClusterConfig)

```yaml
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig
metadata:
  name: demo-cluster
  region: ap-northeast-2
  version: "1.33"
vpc:
  cidr: 10.1.0.0/16
  nat:
    gateway: Single
iam:
  withOIDC: true
managedNodeGroups:
  - name: ng-1
    instanceType: t3.medium
    desiredCapacity: 1
    privateNetworking: false
    iam:
      withAddonPolicies:
        ebs: true
```

```shell
eksctl create cluster -f cluster.yaml
kubectl get nodes -o wide
```

## (2) Deployment, Service

예제로 사용할 Deployment 리소스와 Service 리소스는 아래와 같다.

```yaml
# application.yaml

apiVersion: apps/v1
kind: Deployment
metadata:
  name: echo
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels:
      app: echo
  template:
    metadata:
      labels:
        app: echo
    spec:
      containers:
      - name: echo
        image: ealen/echo-server
        ports:
        - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: echo-svc
  namespace: default
spec:
  selector:
    app: echo
  ports:
  - port: 80
    targetPort: 80
```

```shell
kubectl apply -f app.yaml
```

## (3) Nginx Ingress Controller

> Nginx Ingress Controller에 대한 유지보수는 2026년 3월까지 진행되고, 이후 유지보수가 종료된다. [[참고 1]](https://github.com/kubernetes/ingress-nginx?tab=readme-ov-file#ingress-nginx-retirement) [[참고 2]](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)
> 
> 기존의 Helm Chart나 Nginx Ingress Controller로 운영중이던 서비스가 종료되는건 아니지만 보안 취약점 대응이나 버그 수정 등의 작업이 진행되지 않는다.
> 
> 때문에 [Gateway API](https://velog.io/@yulmwu/kubernetes-gateway)로 마이그레이션을 권장하고 있지만, 이 포스팅에선 실습을 위해 [Nginx Ingress Controller](https://velog.io/@yulmwu/kubernetes-service-ingress)를 그대로 사용할 예정이다.

Nginx Ingress Controller는 Helm Chart를 통해서 설치할 예정인데, values는 아래와 같다.

```yaml
# values.yaml

controller:
  ingressClassResource:
    name: nginx
    enabled: true
    default: true
  service:
    type: LoadBalancer
    annotations:
      service.beta.kubernetes.io/aws-load-balancer-type: "nlb"
      service.beta.kubernetes.io/aws-load-balancer-backend-protocol: "tcp"
      service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: "ip"
      service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"
    ports:
	  http: 80
      https: 443
  config:
    ssl-redirect: "true"
```

여기서 Service를 LoadBalancer, 컨트롤러는 AWS NLB로 구성하고 프로토콜은 TCP로 구성한다. 이렇게 하면 HTTPS 요청이 와도 TLS Termination이 처리되지 않고 Passthrough 된다.

```shell
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install ingress-nginx ingress-nginx/ingress-nginx \
  -n ingress-nginx \
  --create-namespace \
  -f values.yaml
```

명령어 실행이 완료되었다면 아래와 같은 명령어를 통해 NLB 주소를 확인해보자

```shell
> kubectl get svc -n ingress-nginx

NAME                                 TYPE           CLUSTER-IP      EXTERNAL-IP                                                                          PORT(S)                      AGE
ingress-nginx-controller             LoadBalancer   172.20.107.60   a071b61083c384e84819a1d27f4050e9-433acf7b26e84c96.elb.ap-northeast-2.amazonaws.com   80:32028/TCP,443:31307/TCP   34s

NLB_DNS=a071b61083c384e84819a1d27f4050e9-433acf7b26e84c96.elb.ap-northeast-2.amazonaws.com
```

필자는 위와 같은 주소가 나왔는데, 이후 편의를 위해 변수로 만들어주었다. 다음으로 openssl 명령어를 통해 X.509 인증서를 만들도록 하겠다.

## (4) X.509 Certificate

아래와 같은 명령어로 X.509 인증서를 생성하도록 하자. NLB를 먼저 프로비저닝 했던 이유도 인증서 SAN에 NLB 주소를 지정하기 위함이다.

```shell
openssl genrsa -out key.pem 2048
openssl req -new -key key.pem -out csr.pem \
  -subj "/C=KR/ST=Seoul/L=Seoul/O=Lab/OU=TLS/CN=nginx"
openssl x509 -req \
  -in csr.pem \
  -signkey key.pem \
  -out crt.pem \
  -days 365 \
  -extfile <(cat <<EOF
subjectAltName=DNS:$NLB_DNS
EOF
)
```

명령어 실행이 완료되었다면 2개의 파일이 생겼을텐데, 아래의 명령어로 검증해보도록 하자.

```shell
openssl x509 -in crt.pem -text -noout | grep -A2 "Subject Alternative Name"
```

![](https://velog.velcdn.com/images/yulmwu/post/37763e55-f501-43c7-ae20-170c463c433a/image.png)

생성이 완료되었다면 아래의 명렁어로 TLS 타입의 Secret 리소스를 생성하자.

```shell
kubectl create secret tls nlb-tls-secret \
  --cert=crt.pem \
  --key=key.pem \
  -n default # Ingress와 TLS Secret은 동일한 네임스페이스에 존재해야 함

# kubectl get secret nlb-tls-secret -n ingress-nginx # 확인
```

## (5) Nginx Ingress

Ingress 리소스는 아래와 같다. `spec.tls.hosts`와 `spec.rules.host`는 본인의 NLB 주소로 수정하도록 하자.

```yaml
# ingress.yaml

apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: nlb-tls-ingress
  namespace: default
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - a071b61083c384e84819a1d27f4050e9-433acf7b26e84c96.elb.ap-northeast-2.amazonaws.com
    secretName: nlb-tls-secret
  rules:
  - host: a071b61083c384e84819a1d27f4050e9-433acf7b26e84c96.elb.ap-northeast-2.amazonaws.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: echo-svc
            port:
              number: 80
```

```shell
kubectl apply -f ingress.yaml
```

## (6) Testing

이제 브라우저에서 NLB 주소로 접속해보자. 그럼 Nginx로 인해 자동으로 HTTP to HTTPS로 리다이렉트가 된다. 하지만 접속 시 아래와 같이 경고 안내가 나오는 것을 확인해볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/60068c4b-6a83-4610-8380-29dbd485bb58/image.png)

여기서 인증서 세부사항을 보면 아래와 같이 우리가 만들었던(Self Signed) 인증서가 보여지는 것을 확인할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/02e04989-ea72-4329-8a93-440c551b9c2c/image.png)

그럼에도 에러가 발생하는 이유는 Self Signed 인증서이기 때문인데, `openssl s_client -connect $NLB_DNS:443 -servername $NLB_DNS` 명령어를 통해서 테스트해봐도 Self Signed라면서 에러를 반환하는 것을 확인해볼 수 있다. 

![](https://velog.velcdn.com/images/yulmwu/post/7938649a-8914-4a71-9f2d-f7b2f0f43002/image.png)

다만 SSL Handshake는 잘 되는 것도 확인해볼 수 있다. (Kubernetes/Ingress 레벨에서 TLS Termination이 동작하는지 확인하기 위한 PoC 였음)

때문에 Self Signed 인증서가 아닌 공인 CA(인증 기관)를 사용해야 하고, 이는 이후의 cert-manager를 다룰 때 Let's Encrypt CA로 실습해보겠다.

# 2. What is cert-manager ?

앞선 문제는 Self Signed 인증서였기 때문이지만, Kubernetes 네이티브 리소스(TLS Secret 등)로 관리하였을 때 발생하는 여러 문제가 있다.

- 인증서 갱신의 자동화 부재 — 인증서는 비교적 자주 만료가 될 수 있고, 이는 수동으로 갱신해야함.
- CA 연동 시 복잡함 — Let's Encrypt(ACME)나 Vault 등의 외부 발급 기관과 연동하는데 있어 복잡함이 있음.
- 표준화의 어려움 등등..

그래서 Kubernetes에선 일반적으로 직접 TLS/SSL 인증서를 관리하지 않고, **cert-manager**를 사용한다. **cert-manager**는 TLS/SSL 인증서를 발급/갱신/배포 과정을 CRD와 Operator로 자동화하는 도구이다.

- 인증서 발급 자동화 — ACME(Let's Encrypt 등)나 사내 CA, Vault 등의 다양한 Issuer 제공
- 인증서 갱신 자동화 — 만료 이전 자동 재발급 및 Secret 업데이트 등
- ACME 챌린지 처리 자동화 — Order/Challenge 리소스를 통한 도메인 소유권 검증
- `Certificate`, `Issuer/ClusterIssuer`, `CertificateRequest`, (ACME) `Order/Challenge` 등의 CRD 제공

# 3. cert-manager Components

실습을 하기 전 cert-manager의 주요 컴포넌트를 알아보고 넘어가도록 하겠다. 공식적으로 제공하는 쓸만한 다이어그램이 없어서 직접 제작하였고, 각 요소 별 역할을 짧게 적어두었으니 참고하자.

![](https://velog.velcdn.com/images/yulmwu/post/8cc4e9f2-4285-4008-8679-029b5fe2f57b/image.png)

## Webhook, CA Injector

Kubernetes API 서버와 연결된 cert-manager **Webhook**은 cert-manager 관련 CRD 리소스 생성 시 유효성 검사(Validating)나 변환(Mutating)과 같은 Admission Webhook이다. 

Kubernetes 리소스들 중에는 caBundle와 같은 필드에 신뢰할 CA 인증서를 필요로 하는 경우가 있다.

대표적으로 Cert-manager Webhook(정확히는 ValidatingWebhookConfiguration, MutatingWebhookConfiguration)이나 APIService 등에서 Kubernetes 내부적으로 HTTPS 통신을 위해 caBundle이 필요한 경우인데, cert-manager의 **CA Injector**가 이를 자동으로 구성한다. 이는 애플리케이션의 TLS/SSL 인증서(웹 서비스용) 와는 다른 용도이다.

## Controller, CRDs

**cert-manager** 또한 하나의 [Operator](https://velog.io/@yulmwu/kubernetes-operator)이기 때문에 Controller 패턴을 사용한다. cert-manager CRD 리소스를 Reconcile하는데, 최종적으로는 네이티브 오브젝트인 `kuberetes.io/tls` 타입의 Secret 리소스를 생성한다.

CRD 중 어디에서 인증서 발급 방식 정의하는 **Issuer** 또는 **ClusterIssuer**(클러스터 전체)가 있다. 이는 아래와 같은 발급 기관을 사용할 수 있다. 이 포스팅에서는 Let's Encrypt를 사용해보겠다.

- ACME(대표적인 Let's Encrypt 등)
- 사내 CA(Self Signed 또는 자체적인 PKI)
- Vault, Venafi 등등

**Certificate** CRD는 어떠한 도메인에 대한 인증서를 어떠한 스펙으로 구성할지를 정의하는 리소스이다. 어떤 Secret에 저장할지(`spec.secretName`), 어떤 도메인(SAN)으로 발급할지, 어떤 Issuer를 사용할지(`spec.issuerRef`), 갱신 정책 등을 지정한다.

이러한 **Certificate**를 바탕으로 **CertificateRequest** 리소스를 생성하는데, TLS/SSL 인증서를 발급받기 위해 인증 기관(CA)에 제출하는 요청으로 CSR(Certificate Signing Request)과 같은 정보가 포함된다. (자세한 동작 과정은 [공식 문서](https://cert-manager.io/v1.7-docs/concepts/certificate/)를 참고하자.)

마지막으로 ACME 프로토콜 사용 시 도메인 소유 검증을 위한 **Order** 및 **Challenge** 리소스를 생성하게 되고, ACME Challenge에서는 HTTP-01 방식과 DNS-01 방식을 지원한다. 그리고 이 모든 과정을 cert-manager가 컨트롤하게 되는 것이다.

# 4. cert-manager Demo

실습은 마찬가지로 AWS NLB(TLS Passthrough) 및 Nginx Ingress Controller를 사용하며, Issuer는 Let's Encrypt(ACME) 및 DNS-01 방식, 도메인 서버는 AWS Route53을 사용해보겠다. 

Cloudflare(No Proxied, DNS Only)를 사용할 수도 있지만, EKS 환경에선 IRSA를 통해 Route53과 통합되기 쉬우니 Route53을 사용하였다. cert-manager 공식적으로 Route53 및 Cloudflare 등을 지원하니 필요시 참고하자.

![](https://velog.velcdn.com/images/yulmwu/post/d3665fea-7a81-4ec2-b55f-c9efa6a8551a/image.png)

실습에서 사용할 도메인은 `rlawnsdud.shop`이며, FQDN은 `demo.rlawnsdud.shop`이다. 또한 클러스터와 애플리케이션(`application.yaml`), Ingress `values.yaml` 및 설치 방법은 아까와 동일하니 생략하도록 하겠다.

---

## (1) Route53 Hosted Zone and NLB Record

![](https://velog.velcdn.com/images/yulmwu/post/0796037b-0b4a-4475-82c3-d513047ceab0/image.png)

Route53 DNS 서버를 사용하기 위해서는 호스팅 영역(Hosted Zone)이 필요하다. Cloudflare와는 다르게 추가적인 요금이 발생할 수 있으니 참고하도록 하고, 아래와 같이 퍼블릭 호스팅 영역을 생성하자.

![](https://velog.velcdn.com/images/yulmwu/post/d87325c9-9770-42db-9f04-07770a2dc498/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/7167ebea-2180-4d49-91da-fc81c446c084/image.png)

생성이 완료되었다면 아래와 같이 네임 서버 주소를 제공해주는데, 이를 복사하고 도메인 업체에서 네임 서버를 변경하도록 하자. 적용되는데 시간이 오래걸릴 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/7818214a-b74d-4642-bc28-207c4744661f/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/aff7256d-a2a1-4f77-9929-f23e09159e15/image.png)

---

Helm Chart를 통해 Nginx Ingress Controller를 설치하였다면, 마찬가지로 아래의 명령어를 통해 NLB 주소를 얻을 수 있다.

```shell
> kubectl get svc -n ingress-nginx -w          
NAME                                 TYPE           CLUSTER-IP      EXTERNAL-IP                                                                          PORT(S)                      AGE
ingress-nginx-controller             LoadBalancer   172.20.49.176   ae9b30d9bd40447f3a4507cd2bffdc14-f86832c25ee1bbb4.elb.ap-northeast-2.amazonaws.com   80:31605/TCP,443:30486/TCP   30s

NLB_DNS=ae9b30d9bd40447f3a4507cd2bffdc14-f86832c25ee1bbb4.elb.ap-northeast-2.amazonaws.com
```

위 주소를 레코드로 등록하는데, CNAME으로 등록해도 되고 A 레코드에 별칭을 구성하여 등록할 수도 있다. (이는 AWS 자체 기능이다.)

![](https://velog.velcdn.com/images/yulmwu/post/9033a138-52be-4bdd-8ace-d435f56a59ef/image.png)

## (2) cert-manager Helm Chart

![](https://velog.velcdn.com/images/yulmwu/post/b619876b-3632-4f6a-9273-221fbc1d0cd0/image.png)

마찬가지로 cert-manager도 Helm Chart로 설치할 수 있다. 아래의 명령어로 cert-manager를 설치하자.

```shell
helm install cert-manager oci://quay.io/jetstack/charts/cert-manager \
  --version v1.19.2 \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true
```

추가적으로 Route53 레코드를 조작하기 위한 IAM 권한이 필요한데, OIDC에 IAM 권한을 붙이자.

`cert-manager-route53-policy.json`:

```yaml
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "route53:GetChange",
      "Resource": "arn:aws:route53:::change/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "route53:ChangeResourceRecordSets",
        "route53:ListResourceRecordSets"
      ],
      "Resource": "arn:aws:route53:::hostedzone/Z0136818OELW4IM10AE4"
    },
    {
      "Effect": "Allow",
      "Action": "route53:ListHostedZonesByName",
      "Resource": "*"
    }
  ]
}
```

```shell
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

aws iam create-policy \
  --policy-name cert-manager-route53-policy \
  --policy-document file://cert-manager-route53-policy.json

eksctl create iamserviceaccount \
  --cluster demo-cluster \
  --namespace cert-manager \
  --name cert-manager \
  --attach-policy-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:policy/cert-manager-route53-policy" \
  --approve \
  --override-existing-serviceaccounts
  
kubectl -n cert-manager rollout restart deploy cert-manager
  
kubectl -n cert-manager get sa cert-manager -o yaml | yq '.metadata.annotations'
```

![](https://velog.velcdn.com/images/yulmwu/post/85ff5c30-75d3-4e5f-b348-0ab430473046/image.png)

## (3) ClusterIssuer

![](https://velog.velcdn.com/images/yulmwu/post/d2db0dbb-bc2b-48c2-b3c8-a7bde02d9489/image.png)

다음으로 cert-manager CRD인 ClusterIssuer를 아래와 같이 구성하자. `< >` 필드는 직접 수정해야 한다. ClusterIssuer(또는 Issuer)에서 CA를 구성할 수 있다. 여기서는 ACME Let's Encrypt를 사용하였다.

```yaml
# clusterissuer-staging.yaml

apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-staging
spec:
  acme:
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: <메일 주소>
    privateKeySecretRef:
      name: letsencrypt-staging-account-key
    solvers:
    - selector:
        dnsZones:
        - rlawnsdud.shop
      dns01:
        route53:
          region: us-east-1
          hostedZoneID: <Route53 호스팅 영역 ID>
```

```shell
kubectl apply -f cert-manager/clusterissuer-staging.yaml
# kubectl -n cert-manager get secret letsencrypt-staging-account-key
```

## (4) Ingress

![](https://velog.velcdn.com/images/yulmwu/post/2b90b901-217c-43a1-93d9-d08f94608ab0/image.png)

Ingress 매니페스트에서 변경할 부분은 `metadata.annotations`의 `cert-manager.io/cluster-issuer` 어노테이션과 `hosts`, `host` 필드이다. 

`cert-manager.io/cluster-issuer` 어노테이션은 `ingress-shim`을 통해 자동으로 TLS/SSL 인증서를 발급받고 관리할 수 있도록 한다. (즉 Certificate 리소스를 자동으로 만들어줌)

```yaml
# ingress.yaml

apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: nlb-tls-ingress
  namespace: default
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-staging # Ingress-shim
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - demo.rlawnsdud.shop
    secretName: demo-rlawnsdud-shop-tls
  rules:
  - host: demo.rlawnsdud.shop
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: echo-svc
            port:
              number: 80
```

```shell
kubectl apply -f cert-manager/ingress.yaml
```

이제 `kubectl get certificate,certificaterequest,order,challenge -A` 명령어를 통해 cert-manager 관련 CRD 리소스 상태를 확인해보자.

![](https://velog.velcdn.com/images/yulmwu/post/b630fe14-8536-4f6a-8e76-7a32d806fd70/image.png)

필자는 DNS 네임 서버 변경 및 전파 시간으로 인해 Pending 상태가 오래 지속되었는데, 보통은 2~3분이면 Valid 상태로 된다. 중간에 `_acme-challenge` TXT 레코드가 추가되는데, 검증 후 바로 삭제된다.

![](https://velog.velcdn.com/images/yulmwu/post/e1a60fbe-5638-43a3-97c0-74d08e5e8a3f/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/2d361ff6-7a82-42ac-ae1b-fb937f43e33c/image.png)

## (5) Testing

이제 `demo.rlawnsdud.shop`으로 접속해보자. HTTP로 접속해도 Nginx에 의해 자동으로 HTTPS로 리다이렉트되는데, 스테이징(`acme-staging-v02`) 인증서라서 경고 메시지가 나타난다. (`curl -k` 옵션으로 무시 가능)

![](https://velog.velcdn.com/images/yulmwu/post/32077031-b9d2-42d0-999a-4ee56fff38b8/image.png)

스테이징 환경을 분리해둔 이유는 Let's Encrypt의 프로덕션 환경에서는 발급/실패 제한이 있고, 이를 반복하면 발급에 제한이 걸릴 수 있다. 

하지만 스테이징은 그 제한이 없지만 Fake 체인을 사용하기 때문에 위와 같은 경고 메시지가 나타나는 것이다. 이는 아래와 같은 ClusterIssuer 리소스를 만들고, 프로덕션 환경으로 변경하면 된다.  발급 제한이 있으므로 스테이징 환경에서 동작하는지 확인 후 변경하자.

```yaml
# clusterissuer-prod.yaml

apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: <메일 주소>
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
    - selector:
        dnsZones:
        - rlawnsdud.shop
      dns01:
        route53:
          region: us-east-1
          hostedZoneID: <Route53 호스팅 영역 ID>
```

```shell
kubectl apply -f cert-manager/clusterissuer-prod.yaml
kubectl -n default annotate ingress nlb-tls-ingress \
  cert-manager.io/cluster-issuer=letsencrypt-prod --overwrite
```

![](https://velog.velcdn.com/images/yulmwu/post/2d1dd230-1117-48bd-9a81-20d932ceb167/image.png)

이제 다시 테스트해보자. 그러면 HTTPS TLS/SSL 인증서가 적용되어 경고 없이 응답되는 것을 확인해볼 수 있을 것이다. (이전과 같이 브라우저에서 접속하여 확인하면 좋겠지만, DNS NS 전파 시간이 너무 오래 걸려 curl로 대신하였다.)

![](https://velog.velcdn.com/images/yulmwu/post/e9daa38c-fad7-4215-9922-702d8012a6d2/image.png)

```shell
openssl s_client -connect demo.rlawnsdud.shop:443 -servername demo.rlawnsdud.shop -showcerts </dev/null
```

![](https://velog.velcdn.com/images/yulmwu/post/a9e39868-dfd9-4ec2-958d-dd14ed28acd8/image.png)

이렇게 Let's Encrypt ACME 인증서를 사용하는 모습을 볼 수 있고, 만료가 되기 전 자동으로 갱신 또한 진행된다.

이로써 사실상 표준인 cert-manager를 실습해보았다. 사실 웬만하면 클라우드 벤더(AWS 예시)에서 제공하는 TLS/SSL 인증서(ACM 등)를 사용하여 로드밸런서 레벨에서 TLS Termination을 진행해도 무방하지만, 온프레미스 환경이나 환경, 정책 등으로 제한된 환경에서는 이러한 아키텍처로 많이 사용된다.