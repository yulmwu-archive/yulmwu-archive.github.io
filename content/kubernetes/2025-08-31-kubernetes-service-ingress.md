---
title: '[Kubernetes w/ EKS] Service(ClusterIP, NodePort, LoadBalancer) and Ingress(Nginx, AWS ALB)'
description: '쿠버네티스 Service(ClusterIP, NodePort, LoadBalancer) 및 Ingress(Nginx, AWS ALB) + AWS EKS 실습'
slug: '2025-08-31-kubernetes-service-ingress'
author: yulmwu
date: 2025-08-31T04:04:42.869Z
updated_at: 2026-01-14T03:17:10.537Z
categories: ['Kubernetes']
tags: ['eks', 'kubernetes']
series:
    name: Kubernetes
    slug: kubernetes
thumbnail: ../../thumbnails/kubernetes/kubernetes-service-ingress.png
linked_posts:
    previous:
    next: 2025-08-31-kubernetes-gateway
is_private: false
---

> 예제로 사용한 쿠버네티스 매니페스트 파일과 테스트로 사용한 배포 애플리케이션(NodeJS Express)은 아래의 깃허브 레포지토리에서 확인해보실 수 있습니다.
>
> https://github.com/eocndp/k8s-service-ingress-example

# 1. What is Service?

쿠버네티스에서 각 파드는 고유 IP 주소를 할당 받는다. 그런데 이때 크게 2가지의 문제가 발생한다.

1. 파드에 부여되는 IP는 고정되어 있지 않다.
2. K8s 클러스터 외부에서 접근할 수 없다.
3. 파드가 여러개라 서비스 분산에 어려움이 있다.

아래의 자료를 보자.

![](https://velog.velcdn.com/images/yulmwu/post/58a64353-11f0-414a-a5c8-2adda18c89a9/image.png)

클러스터 내 3개의 파드는 클러스터 CIDR(CNI에서 결정함) 10.244.0.0/16 범위에서 IP를 부여받았다. 하지만 이는 파드가 생성될 때 고정된 IP가 아닌 동적으로 IP가 바뀌며, 파드는 일종의 일회성 소모품과 같은 개념이기 때문에 특정한 파드에 파드 IP로 직접 접근하는 것은 어렵다. (1번 문제)

그리고 이러한 파드들은 기본적으로 외부에서 접근할 수 없으며(2번 문제), CNI에서 할당해준 IP를 개별적으로 가지고 있기 때문에 분산 서비스를 하기도 어렵다.

3번 문제로는 파드가 ReplicaSet(또는 Deployment) 등으로 여러개로 분산되어 있다면 각 파드는 서로 다른 IP를 가지고 있기 때문에 분산 서비스에서 인터페이스 역할을 할 리소스가 없다.

그래서 K8s에선 서비스(Service)라는 리소스를 제공하는데, 서비스는 파드를 네트워크에 노출시키는 역할을 한다. 크게 3가지의 유형을 제공하는데, ClusterIP, NodePort, LoadBalancer를 제공한다.

## ClusterIP

파드에 부여되는 IP는 고정되어 있지 않는다고 했는데, 이는 클러스터 내부에서 파드끼리 통신할때도 문제가 된다.

서로 통신하는 것 자체는 같은 클러스터라면 문제가 되지 않지만 IP를 모르기 때문에 쉽게 통신하기가 어렵다. 그래서 클러스터 안에서 가상 IP를 하나 만들고 ClusterIP:Port <-> 파드 IP:targetPort로 매핑한다.

이때 같은 파드가 여러개로 Replica 되어있다면 내부적으로 분산해주기도 하며, 이러한 작업은 노드에 있는 기본적인 DaemonSet 중 하나인 kube-proxy(iptables/ipvs)가 도와준다.

아래의 예시를 보자.

![](https://velog.velcdn.com/images/yulmwu/post/982ee299-803b-42ee-b3dd-166276bf3c10/image.png)

ClusterIP 서비스를 통해 내부의 파드들은 고정된 IP(또는 DNS)를 통해 서로 통신할 수 있고, 이때 kube-proxy 데몬이 이를 가능하도록 해주며, 여러 파드가 있다면 트래픽을 분산해주기도 한다.

그런데 ClusterIP 서비스는 클러스터 외부로 노출하지 않는데, 때문에 클러스터 내 마이크로서비스 간의 통신 등에서 적합하며 외부로 파드를 노출하려면 NodePort나 LoadBalancer, 또는 Ingress(Ingress Controller)를 사용해야 한다.

## NodePort

NodePort 서비스를 적용하게 되면 클러스터에 있는 모든 노드들에 대해 특정한 포트를 개방시킨다. (노드 포트는 기본적으로 30000~32767 범위로 사용할 수 있다.)

그럼 노드 IP와 랜덤한 포트(직접 지정할 수도 있긴 하다.)를 통해 노드에서 ClusterIP 거쳐 내부의 서비스(파드)에 접근할 수 있다.

NodePort가 클러스터 외부로 파드를 노출시키는데, 여기서 외부로 노출된다는게 일반적인 배포 환경에선 노드에 Public IP를 할당해서 쓰진 않는다.
(물론 로드밸런서나 Ingress 등을 쓰지 않고 노드 포트를 직접 열어 Public IP를 할당하는 특이한 경우가 있긴 할 것이다.)

![](https://velog.velcdn.com/images/yulmwu/post/f7fb2324-b9a4-455a-a6d8-e655d2e15885/image.png)

이처럼 노드들의 특정한 포트를 열어서 클러스터 내부로 접근하는 것이다. 그런데 ClusterIP 다이어그램과 비슷한 모습을 하고 있다. 이는 필자가 잘못 그린게 아닌, NodePort는 내부적으로 ClusterIP를 자동으로 생성하기 때문이다.

즉 클러스터 외부에서도 접근할 수 있고 내부에서도 ClusterIP를 통해 접근할 수 있는 것이다.

> ### externalTrafficPolicy
>
> 기본적으로 요청을 받은 노드의 NodePort가 iptables/ipvs 규칙으로 엔드포인트(파드)를 고르는데, 이때 상황에 따라 다른 노드의 파드가 잡힐 수 있다. (kube-proxy)
>
> 즉 아래와 같은 상황이 발생할 수 있는 것이다.
>
> ![](https://velog.velcdn.com/images/yulmwu/post/e8c81133-9cc9-4eb5-9393-4b681bc32de7/image.png)
>
> 외부의 클라이언트는 Worker Node 1의 IP(또는 DNS)를 사용하여 접근을 시도하였으나 Worker Node 1의 모종의 이유로 Worker Node 2로 트래픽이 다시 보내지게 되었다.
>
> 이때 Worker Node 2로 라우팅되는 네트워크 홉이 발생하게 되고, 심지어 SNAT이 발생(노드 간 리다이렉트가 발생함)하게 되어 클라이언트의 IP도 보존되지 않는다는 단점이 있다. (Cross AZ 비용도 발생할 수 있음)
>
> 그래서 서비스에 `externalTrafficPolicy` 옵션을 사용할 수 있는데, 기본값인 `Cluster`로 설정 시 위와 같은 문제가 발생할 수 있으며, `Local`로 설정하면 특정한 노드로 예외 없이 전달되기 때문에 설명한 문제가 발생하지 않는다.
>
> 다만 만약 해당 노드나 파드가 정상 작동 하지 않는 경우 해당 트래픽은 폐기된다.
>
> 그리고 해당 옵션은 AWS ALB/NLB에서 IP 대상의 로드밸런서를 사용한다면 크게 의미가 없는데, NodePort 서비스를 경유하지 않고 파드 IP를 통해 직접 파드로 로드밸런싱 하기 때문에 딱히 상관이 없다. (`target-type: ip`)
>
> 이 주제에 대해선 추후 다시 포스팅을 작성해보겠다.

NodePort는 클러스터 외부에서 클러스터 내부로 접근할 수 있다는 의미이고, 실제 배포 환경이라면 노드 포트로 서비스를 외부에 제공하는게 아닌 로드밸런서나 Ingress를 연결하는게 좋다.

애초에 노드 포트를 30000번 아래로 설정하는걸 권장하지도 않고 인증서 적용이나 라우팅 등에서 적용시키기 어렵고, 오토스케일링 등으로 노드 수가 동적으로 변화된다면 로드밸런서 등을 사용하는게 좋다.

## LoadBalancer

> 앞서 말했 듯 대상 그룹 타입을 IP로 설정하면 파드 IP를 직접 대상 그룹에 등록하기 때문에 더욱 많이 사용되지만, 실습에선 Instance 모드로 설정하고 실습해보겠다. (NodePort 등 테스트)
>
> 추후 Ingress 실습에선 대상 그룹 타입을 IP로 설정해두고 테스트해볼 것이다.

NodePort는 노드의 포트를 열어 클러스터 외부에서 접근할 수 있게 하는 서비스라고 설명하였다.

그런데 오토스케일링 등으로 노드가 많아질 수 있고, NodePort의 경우 노드의 IP를 알아야 하는 등 실제 서비스에서 사용하기엔 어려움이 있다.

그래서 로드밸런서를 앞에 두는데, 이 로드밸런서가 각 노드들(특정 NodePort)로 트래픽을 분산하고 로드밸런서 IP를 통해 서비스에 쉽게 접근할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/2dbc8f47-c82a-4357-ab18-afce1082bd24/image.png)

사진의 예시에선 AWS에서 제공하는 로드밸런서(NLB, L4)를 이용하였는데, 쿠버네티스에서 로드밸런서는 물리적인 장비(L4 로드밸런서)가 필요하다. (클라우드 환경에서 로드밸런서 타입의 서비스를 생성하면 자동으로 클라우드의 로드 밸런서가 생성된다.)

그래서 로컬/온프레미스에서 테스트하기엔 어려움이 있고 주로 클라우드 컴퓨팅 환경에서 사용하는 편이다. (온프레미스에서도 MetalLB 등을 사용하면 되긴 하다.)

# 2. What is Ingress?

만약 여러개의 Deployment(배포될 서비스)를 외부에 서비스하려면 어떻게 해야할까? 단순히 로드밸런서 타입의 여러 서비스를 붙인다는 생각이 들 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/a1b957d9-87e4-4197-b815-1b89b9c31754/image.png)

그런데 이러면 문제가 생긴다.

- 각 서비스(배포)마다 로드밸런서를 붙여줘야 하기 때문에 로드밸런서 비용이 발생한다.
- 인증서, 도메인 설정 등의 설정을 로드밸런서 마다 설정해줘야 한다.
- 로드밸런서 엔드포인트 URL이 여러개라 사용하기 복잡하다.

그래서 Ingress라는 리소스롤 사용할 수 있는데, Ingress는 외부에서 내부로 들어오는 HTTP/HTTPS(L7) 트래픽을 호스트/경로 기반 라우팅 규칙을 정의하고, Ingress Controller가 실질적인 L7 로드밸런싱 역할을 한다.

여기서 Ingress Controller는 Nginx Ingress Controller, AWS ALB Ingress Controller 등이 있다. 그 외에도 GCP에서 제공하는 Ingress Controller도 있기 한데, 포스팅에선 Nginx Ingress Controller와 AWS ALB Ingress Controller로 나눠서 설명하겠다.

> 왜 LoadBalancer 서비스는 클라우드에서 제공하는 로드밸런서를 사용하고, 왜 Ingress는 Ingress Controller가 클러스터 안에서 구현되었는지 궁금할 수 있다.
>
> 쿠버네티스의 철학 등의 이유가 있겠지만 기술적인 이유 중 하나는 L4 로드밸런서를 쿠버네티스 클러스터 안에서 구현하기엔 어려움이 있기 때문이다.
>
> 때문에 LoadBalancer 서비스는 외부의 클라우드가 제공하는 로드밸런서를 사용하도록 하고, L7 로드밸런서는 클러스터 안에서 구현할 수 있기 때문에 Ingress Controller가 파드 형태로 L7 로드밸런싱을 해주는 것이다.

## Nginx Ingress Controller

> Nginx Ingress Controller에 대한 유지보수는 2026년 3월까지 진행되고, 이후 유지보수가 종료된다. [[참고 1]](https://github.com/kubernetes/ingress-nginx?tab=readme-ov-file#ingress-nginx-retirement) [[참고 2]](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)
>
> 기존의 Helm Chart나 Nginx Ingress Controller로 운영중이던 서비스가 종료되는건 아니지만 보안 취약점 대응이나 버그 수정 등의 작업이 진행되지 않는다.
>
> 때문에 [Gateway API](https://velog.io/@yulmwu/kubernetes-gateway)로 마이그레이션을 권장하고 있지만, 이 포스팅에선 실습을 위해 Nginx Ingress Controller를 그대로 사용할 예정이다.

클라우드 환경이라면 Nginx Ingress Controller가 아닌 AWS ALB Ingress Controller와 같이 클라우드에서 제공하는 컨트롤러를 사용하여 더욱 간결하게 구성할 수 있으나, 로컬이나 온프레미스에서 Nginx Ingress Controller를 구성한다면 그 앞에 NodePort나 LoadBalancer(L4) 서비스를 붙여야 한다. (Nginx Ingress Controller도 결국엔 파드로 실행됨)

![](https://velog.velcdn.com/images/yulmwu/post/63b98936-87d8-402e-9bc8-0acb900d04c3/image.png)

다만 이때 Nginx Ingress를 거친 트래픽이 NodePort를 통해 들어가지 않는다. 그 이유는 Nginx Ingress Controller는 클러스터 내부에 있고, 굳이 NodePort를 열지 않고 ClusterIP만 생성해둬도 되기 때문이다. (Nginx Ingress 매니페스트에 ClusterIP 서비스를 지정한다.)

하지만 LoadBalancer 서비스에선 NodePort를 자동으로 열렸는데, LoadBalancer 서비스의 로드밸런서는 클러스터 외부에 있는 AWS NLB 등의 리소스이기 때문에 ClusterIP 가지곤 접근할 수 없다. 그래서 자동으로 NodePort를 생성함으로써 노드 IP:포트 대상으로 로드밸런싱 하는 것이다.

## AWS ALB Ingress Controller

만약 AWS EKS에 Ingress를 만든다면 AWS ALB Ingress Controller를 사용할 수 있다.

이때 대상 그룹의 타입을 IP로 설정하면 바로 파드의 IP로 포워딩한다.
(그래서 앞서 말했 듯 이땐 `externalTrafficPolicy`가 무의미 해진다고 하였다.)

하지만 대상 그룹의 타입을 인스턴스로 변경할 수 있는데, 이 경우 파드의 IP로 직접 포워딩하는 것이 아닌 인스턴스(노드)의 NodePort를 거친다. IP로 직접 포워딩하여 네트워크 홉을 줄이는 것이 큰 장점이기 때문에 대부분의 상황에선 대상 그룹의 타입을 IP로 지정한다. (`alb.ingress.kubernetes.io/target-type: ip`)

때문이 이 글에서도 `target-type: ip` 기준으로 설명하겠다.

![](https://velog.velcdn.com/images/yulmwu/post/d3c75701-c916-4f84-aaf8-8608589d04e7/image.png)

보면 Nginx Ingress Controller에 비해 다른 모습을 보이고 있다. 가장 큰 점을 보면 바로 ALB Ingress Controller를 직접 지나지 않는다는 점이다.

즉 Nginx Ingress Controller는 파드가 직접 리버스 프록시 역할을 하며 로드밸런싱을 하는 반면, ALB Ingress Controller는 Ingress 리소스를 모니터링하며 ALB를 업데이트하는 역할이고 AWS ALB가 로드밸런싱을 직접 한다는 것이다.

이때 대상 그룹은 IP 타입이므로 NodePort, ClusterIP 등의 서비스를 경유하지 않고 IP를 통해 대상 그룹의 파드로 직접 로드밸런싱을 해준다. (즉 Nginx Ingress 로드밸런싱 주체: Pod, ALB Ingress 로드밸런싱 주체: ALB)

> 사진상 설명하지 않은 부분이 있는데, 각 서비스(Deployment 등)에 대한 ClusterIP 서비스는 만들어둬야 한다.
>
> ALB Ingress Controller가 ALB에 대상 그룹에 IP를 등록시키기 위해선 엔드포인트 슬라이스를 참조하여 대상 그룹을 수정한다. 이때 엔드포인트 슬라이스는 ClusterIP 등이 서비스가 있어야 생기니 ClusterIP 서비스를 만들어주는 것이다. (직접 사용하진 않음)

# 3. Examples

이제 실습을 해보겠다. 모두 ClusterIP 서비스를 제외하면 Minikube 등의 로컬 환경에서 테스트하기엔 어려움이 있고, 실제 Public IP와 L4, L7 로드밸런서(NLB, ALB)가 있어야 제대로 테스트해볼 수 있기 때문에 AWS EKS에서 진행해보도록 하겠다.

EKS 환경은 공통적으로 똑같고, 각 실습 이후 만들어뒀던 서비스를 삭제하여 꼬이지 않도록 하자. 실습의 내용은 아래와 같다.

- (공통) EKS 클러스터 구성(노드 3개 중 하나는 Public IP 부여)

위 EKS 환경 구축에선 eksctl 명령어와 ClusterConfig 매니페스트 파일로 구축을 해볼 것이다.

- Deployment 앱 배포(ClusterIP, NodePort, LoadBalancer 서비스 공통 사용)
- ClusterIP 실습
- NodePort 실습
- LoadBalancer 실습

그리고 Ingress는 두개의 Deployment를 통해 경로 라우팅 & 로드밸런싱을 테스트해볼 것이다.

- Nginx Ingress 실습
- AWS ALB Ingress 실습

## EKS Cluster

먼저 EKS 클러스터부터 만들어보자. EKS 클러스터는 콘솔로 생성하지 않고 eksctl이라는 도구를 사용하여 만들어 볼것이다.

먼저 아래의 파일을 작성해주자.

```yaml
# cluster-config.yml

apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig

metadata:
    name: eks-test
    region: ap-northeast-2
    version: '1.33' # 표준 지원 기간(초과 시 추가 요금), EOL 확인

vpc:
    cidr: 10.0.0.0/16

managedNodeGroups:
    - name: ng-private
      instanceTypes: ['t3.small']
      desiredCapacity: 2
      minSize: 2
      maxSize: 3
      privateNetworking: true
      labels: { nodegroup: private }

    - name: ng-public
      instanceTypes: ['t3.small']
      desiredCapacity: 1
      minSize: 1
      maxSize: 1
      privateNetworking: false
      labels: { nodegroup: public }
```

그리고 아래의 명령어를 입력하여 EKS 클러스터를 만들고 kubeconfig를 업데이트해보자. (실습 시 요금이 발생할 수 있으니 주의하자.)

```shell
eksctl create cluster -f cluster-config.yml
aws eks update-kubeconfig --name eks-test --region ap-northeast-2
```

![](https://velog.velcdn.com/images/yulmwu/post/b257200a-e0fd-4edd-bc86-4cbade0f0791/image.png)

클러스터가 만들어지는데 시간이 좀 걸릴 수 있다. 10분~15분 정도 기다리면 CloudFormation 스택을 통해 EKS 클러스터가 만들어진다.

![](https://velog.velcdn.com/images/yulmwu/post/2a97ed3c-8554-435c-aa3d-7e231cd15469/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/c1da69d9-8b87-4291-b45b-f6a8e864e439/image.png)

그럼 사진과 같이 kubectl을 통해 EKS를 관리할 수 있고, 노드 목록을 확인해보면 하나의 노드에 Public IP가 부여된 것을 볼 수 있다. EKS 클러스터 세팅은 완료되었다.

## Common Deployment

여기선 2개의 `app1`, `app2` Deployment를 만들건데, 서비스 실습은 `app1` 하나만 사용해보고 Ingress 실습에서 2개의 Deployment를 사용해볼 것이다.

```yaml
# testapp-deployment.yml

apiVersion: apps/v1
kind: Deployment
metadata:
    name: app1-deploy
spec:
    replicas: 3
    selector:
        matchLabels:
            app: app1
    template:
        metadata:
            labels:
                app: app1
        spec:
            containers:
                - name: app1
                  image: rlawnsdud/testapp
                  ports:
                      - containerPort: 8080
                  env:
                      - name: HOST
                        value: '0.0.0.0'
                      - name: PORT
                        value: '8080'
                      - name: APP_NAME
                        valueFrom:
                            fieldRef:
                                fieldPath: metadata.name
---
apiVersion: apps/v1
kind: Deployment
metadata:
    name: app2-deploy
spec:
    replicas: 3
    selector:
        matchLabels:
            app: app2
    template:
        metadata:
            labels:
                app: app2
        spec:
            containers:
                - name: app2
                  image: rlawnsdud/testapp
                  ports:
                      - containerPort: 8080
                  env:
                      - name: HOST
                        value: '0.0.0.0'
                      - name: PORT
                        value: '8080'
                      - name: APP_NAME
                        valueFrom:
                            fieldRef:
                                fieldPath: metadata.name
```

이제 kubectl을 사용하여 적용해보자.

![](https://velog.velcdn.com/images/yulmwu/post/ed226fa2-c8bd-47b0-891a-1a27a672e797/image.png)

필요 시 클러스터에 curl 명령어 테스트용 파드를 하나 만들 수 있다. 팔자는 아래와 같이 구성하였다.

```shell
kubectl run testbox --rm -it --image=alpine -- sh
> apk add curl

# 랜덤한 파드 IP 가져와서 테스트
> curl 10.0.115.25:8080
```

![](https://velog.velcdn.com/images/yulmwu/post/0f46af7e-193d-41db-8fe1-fe4c9c56be5f/image.png)

잘 된다. 이제 각 서비스들과 Ingress를 테스트 해보겠다.

## ClusterIP Service

먼저 사용할 서비스 매니페스트 파일은 아래와 같다.

```yaml
# cluster-ip.yaml

apiVersion: v1
kind: Service
metadata:
    name: app-clusterip-svc
spec:
    type: ClusterIP
    selector:
        app: app1
    ports:
        - name: http
          port: 3000
          targetPort: 8080
```

적용하고 서비스를 조회해보자.

![](https://velog.velcdn.com/images/yulmwu/post/7018bdec-0e02-491b-a71d-7276131a0a4a/image.png)

그럼 `app-clusterip-svc`가 보여지고 CLUSTER-IP에 우리가 원하는 클러스터 IP가 나타난다. (기존적으로 있는 `kubernetes` 서비스는 K8s API를 위한 서비스이므로 냅두자.)

해당 ClusterIP(`172.20.145.82`)를 가지고 접속했을 때 파드들에 접근이 되며 분산까지 되는지 확인해보자. (클러스터 내부에서 테스트해야 한다. 필자는 아까 만들어둔 curl 테스트용 파드에서 진행한다.)

```shell
for i in $(seq 1 10); do curl '172.20.145.82:3000'; echo; done
```

![](https://velog.velcdn.com/images/yulmwu/post/1b9a396c-a781-4856-a527-55fdabb08913/image.png)

이렇게 잘 분산되어 나오는 것을 볼 수 있다.

## NodePort Service

NodePort는 아래와 같은 매니페스트 파일을 작성한다. `nodePort`가 있는 것 빼곤 비슷하다. (없을 경우 랜덤한 30000~32767 포트로 자동으로 붙는다.)

```yaml
# nodeport.yaml

apiVersion: v1
kind: Service
metadata:
    name: app-nodeport-svc
spec:
    type: NodePort
    selector:
        app: app1
    ports:
        - name: http
          port: 3000
          targetPort: 8080
          nodePort: 30001
```

적용 후 서비스 목록을 보자.

![](https://velog.velcdn.com/images/yulmwu/post/fa47c9cd-f220-49d7-98e9-1d0f66fcc471/image.png)

아까와 동일하게 CLUSTER-IP가 보여진다. NodePort는 노드의 특정 포트를 열어서 인터넷으로 노출하므로 Public IP를 가진 노드로 테스트해봐야 한다. 우리는 Public 노드를 하나 만들어뒀기 때문에 문제가 없다.

![](https://velog.velcdn.com/images/yulmwu/post/f1a12a41-7f7d-44d9-a2f1-b538817d65c9/image.png)

여기서 퍼블릭 노드의 IP는 `13.209.73.50`이다. 즉 `13.209.73.50:30001`으로 외부에서 접속해보면 파드로 접근이 되며 분산까지 될 것이다. (ClusterIP를 포함하니깐)

![](https://velog.velcdn.com/images/yulmwu/post/5570fecc-a0fa-49cc-9e36-646883233c36/image.png)

접속이 안된다. 왜일까? 바로 접속하려는 Public IP를 가진 노드에서 보안 그룹의 인바운드 규칙에 노드 포트를 허용시키지 않았기 때문이다.

![](https://velog.velcdn.com/images/yulmwu/post/0b2422f1-d2f4-4171-b2e1-cadf0e25ea54/image.png)

접속하려는 노드에 사진과 같이 30000~32767 (또는 30001) 포트를 열어주자.

![](https://velog.velcdn.com/images/yulmwu/post/a8f44cef-0d41-4ea9-9350-78f98da488ca/image.png)

그럼 이처럼 외부에서 노드의 Public IP와 NodePort를 통해 접속할 수 있다.

## LoadBanalcer Service

EKS에서 LoadBalancer 서비스를 사용하면 AWS NLB(L4)를 자동으로 생성한다. LoadBalancer 서비스 매니페스트는 아래와 같다.

```yaml
# loadbalancer.yaml

apiVersion: v1
kind: Service
metadata:
    name: app-lb-svc
    annotations:
        service.beta.kubernetes.io/aws-load-balancer-type: 'nlb'
        service.beta.kubernetes.io/aws-load-balancer-scheme: 'internet-facing'
        service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: 'instance'
spec:
    type: LoadBalancer
    selector:
        app: app1
    ports:
        - name: http
          port: 80
          targetPort: 8080
```

테스트를 위해 대상 그룹의 타입을 Instance로 설정한다. 실제 서비스에선 IP 타입으로 설정하는 것을 권장한다.

![](https://velog.velcdn.com/images/yulmwu/post/be1f6e5c-3f37-448d-aacf-2b2fbb2658f3/image.png)

서비스 목록을 조회해보면 LoadBalancer 서비스에 EXTERNAL-IP에 ELB(NLB) 주소가 나타난다. 바로 접속은 안되는데, 프로비저닝 되기 까지 조금만 기다리자.

![](https://velog.velcdn.com/images/yulmwu/post/8f0428f2-ff7e-469a-ac94-6f15a3a5e04e/image.png)

그럼 NLB가 생성이 되었고, 접속해보면 아래와 같이 잘 로드밸런싱 되는 것을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/914bbd92-42fa-41b8-9458-4cd392b96a08/image.png)

보여지는 모습 자체는 ClusterIP, NodePort와 비슷하지만, 로드밸런싱은 노드들을 대상으로 로드밸런싱 한다는 점이 있다.

또한 대상 그룹이 인스턴스이기 때문에 내부적으로 NodePort를 통하지만, 대상 그룹 타입을 IP로 설정하면 바로 파드로 이동된다.

로드밸런서 서비스를 삭제하면 자동으로 ELB(NLB) 또한 삭제된다.

![](https://velog.velcdn.com/images/yulmwu/post/73f92fb1-2852-4337-b092-cbd06f9b0f40/image.png)

## Nginx Ingress

helm 패키지 메니저로 `ingress-nginx`를 설치해주자.

```shell
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install ingress-nginx ingress-nginx/ingress-nginx \
    --set controller.service.type=NodePort
```

여기서 컨트롤러에 연결될 서비스는 NodePort로 지정한다. (NLB L4 LoadBalancer 서비스를 둬도 좋지만 빠르게 진행하기 위해 NodePort로 실습한다.)

그럼 아래와 같이 Nginx Ingress Controller에 대한 서비스가 생기게 된다.

![](https://velog.velcdn.com/images/yulmwu/post/e1ac99c6-8c19-42a0-94fe-ba59a52f0d94/image.png)

이제 Nginx Ingress Controller 설치는 되었고, Ingress와 연결하기 위해 Deployment 앱들에 대해 ClusterIP 서비스를 만들어주자.

```yaml
# app-clusterip.yaml

apiVersion: v1
kind: Service
metadata:
    name: app1-svc
spec:
    type: ClusterIP
    selector:
        app: app1
    ports:
        - name: http
          port: 3000
          targetPort: 8080
---
apiVersion: v1
kind: Service
metadata:
    name: app2-svc
spec:
    type: ClusterIP
    selector:
        app: app2
    ports:
        - name: http
          port: 3000
          targetPort: 8080
```

이제부터 두개의 Deployment를 모두 사용하니 서비스도 두개를 만들어주자.

그리고 IngressClass를 통해 Ingress Controller 구성을 정의한다.

```yaml
# nginx-ingress-class.yaml

apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
    name: nginx
spec:
    controller: k8s.io/ingress-nginx
```

그리고 Ingress 오브젝트를 아래와 같이 작성하자.

```yaml
# nginx-ingress.yaml

apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
    name: app-ingress
    annotations:
        nginx.ingress.kubernetes.io/use-regex: 'true'
        nginx.ingress.kubernetes.io/rewrite-target: /$2
spec:
    ingressClassName: nginx
    rules:
        - http:
              paths:
                  - path: /v1(/|$)(.*)
                    pathType: ImplementationSpecific
                    backend:
                        service:
                            name: app1-svc
                            port:
                                number: 3000
                  - path: /v2(/|$)(.*)
                    pathType: ImplementationSpecific
                    backend:
                        service:
                            name: app2-svc
                            port:
                                number: 3000
```

여기서 `rewrite-target`은 대상 서비스로 경로를 보낼 때 어떻게 할지를 정한다. 없다면 `/v1/foo`와 같이 그대로 들어가는데, Express에선 `/`에서 값을 반환하므로 해당 옵션을 사용해주었다.

모두 적용 후, 서비스 목록과 Ingress를 조회해보자.

![](https://velog.velcdn.com/images/yulmwu/post/ad6e2eb1-4b98-4d64-ac77-c0cee54d3b00/image.png)

```
> kubectl get svc,ing -o wide
NAME                                         TYPE        CLUSTER-IP       EXTERNAL-IP   PORT(S)                      AGE     SELECTOR
service/app1-svc                             ClusterIP   172.20.174.124   <none>        3000/TCP                     2m9s    app=app1
service/app2-svc                             ClusterIP   172.20.93.198    <none>        3000/TCP                     2m7s    app=app2
service/ingress-nginx-controller             NodePort    172.20.174.15    <none>        80:30265/TCP,443:30698/TCP   8m33s   app.kubernetes.io/component=controller,app.kubernetes.io/instance=ingress-nginx,app.kubernetes.io/name=ingress-nginx
service/ingress-nginx-controller-admission   ClusterIP   172.20.193.23    <none>        443/TCP                      8m33s   app.kubernetes.io/component=controller,app.kubernetes.io/instance=ingress-nginx,app.kubernetes.io/name=ingress-nginx
service/kubernetes                           ClusterIP   172.20.0.1       <none>        443/TCP                      20m     <none>

NAME                                    CLASS   HOSTS   ADDRESS         PORTS   AGE
ingress.networking.k8s.io/app-ingress   nginx   *       172.20.174.15   80      42s
```

`service/ingress-nginx-controller`에서 HTTPS 30265번 포트로 NodePort가 열렸다고 한다. 그럼 퍼블릭 노드의 IP와 함께 접속해보자.

![](https://velog.velcdn.com/images/yulmwu/post/84f2e995-8757-450f-89c8-8e4a5c5dfc44/image.png)

사진과 같이 경로에 따라 라우팅되면서 로드밸런싱되는 것을 볼 수 있다. (`kpcz9`, `bnpx4`, `sgr9n`은 app1, `t2qdg`, `v967j`, `jlblj`는 app2에 있다)

이렇게 Nginx Ingress를 실습해보았다. 실제 서비스에선 Nginx Controller에 NodePort 보단 LoadBalancer 서비스를 달아두는게 좋은데, 그러면 2개의 로드밸런서(L4 ALB, L7 Nginx Ingress Controller)가 생기니 중복될 수 있다.

다음으로 이러한 문제를 AWS ALB로 라우팅까지 수행하고, 대상 그룹의 타입을 IP로 정하여 NodePort, ClusterIP를 경유하지 않고 파드로 바로 통신할 수 있는 ALB Ingress Controller를 실습해보겠다.

## ALB Ingress

> ALB Ingress Controller를 실습하기 앞서, Deployment 매니페스트를 조금 수정해야한다.
>
> ALB Ingress Controller는 Nginx Ingress Controller 처럼 경로의 정규식/캡처 그룹 등을 인식하지 못하고 rewrite 등의 옵션이 없다.
>
> 그래서 API 서버 애플리케이션에서 엔드포인트에 `v1`, `v2`를 포함하도록 Global Prefix 등을 추가하도록 수정해야 한다.
>
> 때문에 아래와 같은 환경 변수를 추가 후 적용시켜 실습해야 한다. (필자의 `rlawnsdud/testapp` 한정)
>
> ```yaml
> - name: GLOBAL_PREFIX
>   value: '/v1' # app2에 /v2로 변경 후 추가
> ```

ALB Ingress Controller를 사용하기 위해선 따로 설치를 해줘야 한다.

```shell
eksctl utils associate-iam-oidc-provider --region ap-northeast-2 --cluster eks-test --approve

curl -fsSL -o iam-policy.json https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/main/docs/install/iam_policy.json

aws iam create-policy --policy-name AWSLoadBalancerControllerIAMPolicy --policy-document file://iam-policy.json

# {ACCOUNT_ID}에 계정 ID를 넣어줘야 한다.
eksctl create iamserviceaccount \
  --cluster eks-test \
  --namespace kube-system \
  --name aws-load-balancer-controller \
  --attach-policy-arn arn:aws:iam::{ACCOUNT_ID}:policy/AWSLoadBalancerControllerIAMPolicy \
  --override-existing-serviceaccounts \
  --approve

helm repo add eks https://aws.github.io/eks-charts
helm repo update

helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
  --namespace kube-system \
  --set clusterName=eks-test \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller
```

명령어가 복잡한데, ALB Ingress Controller가 AWS ALB 서비스를 직접 다루기 때문에 권한이 필요하기 때문이다.

![](https://velog.velcdn.com/images/yulmwu/post/654f0601-90ac-4921-8df9-81eb936f6538/image.png)

다음으로 Ingress 오브젝트 만들건데, 먼저 ClusterIP 등의 서비스가 Deployment 앞에 붙어야한다. (Ingress에서 서비스 명시, EndpointSlice를 조회하여 대상 그룹에 파드를 등록시키기 위함)

아래 두개의 서비스 매니페스트를 작성하자.

```yaml
apiVersion: v1
kind: Service
metadata:
    name: app1-svc
    annotations:
        alb.ingress.kubernetes.io/healthcheck-path: /v1/health
spec:
    type: ClusterIP
    selector:
        app: app1
    ports:
        - name: http
          port: 3000
          targetPort: 8080
---
apiVersion: v1
kind: Service
metadata:
    name: app2-svc
    annotations:
        alb.ingress.kubernetes.io/healthcheck-path: /v2/health
spec:
    type: ClusterIP
    selector:
        app: app2
    ports:
        - name: http
          port: 3000
          targetPort: 8080
```

다른 점이 있다면 해당 ClusterIP 서비스가 곧 대상 그룹이 되므로, 각각의 서비스에 ALB Health Check 경로를 입력해줘야 한다는 점이 다르다.

그리고 Ingress Controller 구성을 위한 IngressClass를 하나 만들어주겠다.

```yaml
apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
    name: alb
spec:
    controller: ingress.k8s.aws/alb
```

그러면 `ingressClassName: alb`를 통해 해당 ALB Ingress Controller를 사용할 수 있다.

이제 Ingress 오브젝트 매니페스트를 작성하고 적용시키자.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
    name: app-ingress
    annotations:
        kubernetes.io/ingress.class: alb
        alb.ingress.kubernetes.io/scheme: internet-facing
        alb.ingress.kubernetes.io/target-type: ip
spec:
    ingressClassName: alb
    rules:
        - http:
              paths:
                  - path: /v1/*
                    pathType: Prefix
                    backend:
                        service:
                            name: app1-svc
                            port:
                                number: 3000
                  - path: /v2/*
                    pathType: Prefix
                    backend:
                        service:
                            name: app2-svc
                            port:
                                number: 3000
```

그리고 조금 기다리면 아래와 같이 ALB가 프로비저닝이 된걸 볼 수 있다. 해당 로드밸런서를 자세히 보자.

![](https://velog.velcdn.com/images/yulmwu/post/ace4b46a-501d-4efb-a1fb-047809246395/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/84bd7a1a-a1f7-4c72-acbb-2b49ccbb7750/image.png)

HTTP(80)만 설정해주었기 때문에 리스너엔 HTTP:80만 보여진다. 대상 그룹을 보자.

![](https://velog.velcdn.com/images/yulmwu/post/2aeed709-d8ca-49d0-8b7e-7bb498e5d75e/image.png)

노드(인스턴스)가 아닌 파드의 프라이빗 IP가 등록된걸 볼 수 있다. (대상 그룹 타입이 IP)

또한 Health Check도 잘 되고, 설정해뒀던 Health Check 경로도 잘 나타난다.

![](https://velog.velcdn.com/images/yulmwu/post/90fdcfba-4b3d-41cd-8d14-e67d85b9fad8/image.png)

이제 로드밸런싱이 잘 되는지 테스트해보자.

![](https://velog.velcdn.com/images/yulmwu/post/3481c518-d2bf-4611-b5ad-00983dd98e25/image.png)

이처럼 경로에 따라 서비스 분산도 되고, 로드밸런싱도 잘 되는 모습을 볼 수 있다.

이상으로 쿠버네티스(EKS)에서 3개의 서비스(ClusterIP, NodePort, LoadBalancer)와 2개의 Ingress(Nginx, ALB) 실습을 해보았다.

실습 후 AWS 리소스를 삭제해주는데, eksctl로 EKS 클러스터를 만들었기 때문에 `eksctl delete cluster -f cluster-config.yaml`을 실행해주자.

혹시라도 남아있는 리소스가 있을 수 있으므로 AWS 콘솔에서 남아있는 리소스가 있는지 확인해보자.
(VPC NAT Gateway, EIP, ELB, EC2 등등)
