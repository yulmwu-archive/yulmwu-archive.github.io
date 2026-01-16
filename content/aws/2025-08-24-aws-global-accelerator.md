---
title: '[AWS Networking] AWS Global Accelerator (AGA)'
description: 'AWS Global Accelerator를 통한 글로벌 서비스의 네트워크 퍼포먼스 올리기'
slug: '2025-08-24-aws-global-accelerator'
author: yulmwu
date: 2025-08-24T05:15:47.274Z
updated_at: 2026-01-09T17:36:18.736Z
categories: ['AWS']
tags: ['aws', 'networking']
series:
    name: AWS
    slug: aws
thumbnail: ../../thumbnails/aws/aws-global-accelerator.png
linked_posts:
    previous: 2025-08-24-aws-vpc-peering-transit-privatelink
    next: 2025-08-24-aws-s2s-vpn
is_private: false
---

# 0. Overview

AWS엔 리전에 의존하지 않는 "글로벌 서비스"라는게 존재한다.

![](https://velog.velcdn.com/images/yulmwu/post/f21937d6-525e-4a6d-95a6-72c03ec84b92/image.png)

대표적으로 CloudFront, Route53 등이 존재하는데, 이들의 특징이 존재하는데, 전 세계에 걸쳐있으며 AWS 내부적으로 백본(Backbone) 네트워크를 자체적으로 구축하여 사용한다는 것이다.

예를 들어 CloudFront를 생각해보자. AWS는 어떻게 빠르게 콘텐츠를 캐싱하고 클라이언트에게 전달될까? 그 배경엔 AWS의 자체적인 백본 네트워크가 존재하기 때문이다.

클라이언트가 CloudFront에 접속하면 가장 가까운 엣지 로케이션(또는 엣지 PoP=Point of Presence)에서 빠르게 데이터를 전송한다.

그리고 이 엣지 로케이션은 AWS의 자체적인 백본 네트워크에 연결되어 있고, 전세계 퍼블릭 인터넷 통신망을 통하지 않고 자체적인 네트워크를 통해 송수신되기 때문에 빠른 속도를 낼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/c262dad1-3401-448e-af33-7ebb144c454a/image.png)

_출처: [Introduction to Network Transformation on AWS](https://aws.amazon.com/ko/blogs/networking-and-content-delivery/introduction-to-network-transformation-on-aws-part-1)_

사진과 같이 전 세계적으로 엣지 로케이션이 존재하고, 서로 링킹되어 있다. 여기서 링킹 되는 전용 회선을 Direct Connect라고 하며, 따로 서비스로 제공하기도 한다.

Direct Connect의 최대 대역폭이 400Gbps임을 생각해보면 엄청나게 빠르게 전송될 수 있음을 알 수 있다.

# 1. What is AWS Global Accelerator(AGA) ?

여기서 클라이언트는 가장 가까운 엣지 로케이션에 접속해 AWS 백본 네트워크를 거쳐 최적의 경로로 빠르게 애플리케이션에 트래픽을 송수신할 수 있는데, 이 서비스를 AWS Global Accelerator(AGA)라고 한다.

> ### CloudFront vs Global Accelerator
>
> 두 서비스 모두 AWS 백본 네트워크를 사용한다는 점과, 클라이언트는 가장 가까운 엣지 로케이션에 접속하여 빠르게 데이터를 송수신할 수 있다는 점이 같다.
>
> 다만 두 서비스는 목적과 동작이 완전히 다르다. CloudFront의 경우 CDN 캐싱 서비스로, 엣지 로케이션에 콘텐츠를 캐싱한다. DNS 기반으로 가장 가까운 엣지 로케이션에 접근하며, 캐싱된 콘텐츠를 가져오거나 캐싱된 콘텐츠가 아닐 경우 오리진 서버에서 데이터를 가져오게 된다.
>
> 이에 반해 Global Accelerator는 OSI 7계층 관점에서 OSI 4계층인 전송 계층에서 TCP/UDP 트래픽을 다룬다. (CloudFront는 HTTP/HTTPS를 주로 다룸, OSI 7계층)
>
> 클라이언트는 Global Accelerator의 Anycast IP에 접근하게 된다면 가장 가까운 엣지 로케이션에 진입한다. 그러면 최적의 경로를 찾게 되고, 최종적으로 애플리케이션의 엔드포인트에 빠르게 접근할 수 있게 된다.
>
> 이때 애플리케이션이 동작하지 않는다면 자동으로 다른 리전의 서비스로 Failover되게 할 수 있다. (2개 이상의 서비스 연결 시)

> ### Anycast IP
>
> AWS Global Accelerator의 엣지 로케이션들은 같은 IP를 가지고, 클라이언트는 그 IP로 접속하여 가장 가까운 엣지 로케이션으로 접근한다.
>
> 이처럼 Global Accelerator의 엣지 로케이션은 Anycast IP를 기반으로 동작하는데, Anycast IP와 Unicast IP를 비교하면 아래와 같다.
>
> ![](https://velog.velcdn.com/images/yulmwu/post/6621d686-71af-4a09-bfd1-92dbef03e159/image.png)
>
> 위 사진처럼 Unicast의 경우 클라이언트에서 목적지를 정했다면, 무조건 해당 IP를 가진 유일한 서버로 접근한다. 반면 Anycast는 아래와 같다.
>
> ![](https://velog.velcdn.com/images/yulmwu/post/bb66f8f4-4837-4a79-8be5-8186337d33da/image.png)
>
> 사진과 같이 여러대의 서버에 같은 IP를 할당한다. 그리고 BGP와 같은 라우팅 프로토콜로 클라이언트가 가장 가까운 서버에 접근할 수 있도록 설정하고, 사진처럼 클라이언트는 여러 서버 중 가장 가까이 있는 서버로 접근하게 되는 것이다.
>
> Global Accelerator는 후자, Anycast IP를 기반으로 엣지 로케이션에 접근하도록 한다.

서론이 길었다. 예를 들어 아래의 경우를 보자.

![](https://velog.velcdn.com/images/yulmwu/post/f6e407b4-0a47-4bbc-ab23-a269473e067a/image.png)

대한민국에 있는 클라이언트가 `ap-northeast-2` 리전에 있는 서버에 접근하는 예시이다. 이때 Public한 인터넷을 통해 서버에 접근하고, 서로 가까이 있으므로 문제가 되지 않는다. 하지만 해당 서비스가 글로벌하게 확장되어 미국에서 트래픽이 유입된다면 어떨까?

![](https://velog.velcdn.com/images/yulmwu/post/001bb724-d585-4fc8-a757-bcc05c646713/image.png)

사진과 같이 물리적으로 멀리 떨어져 있으니 당연히 레이턴시가 생기게 될 것이다. 물론 실제로 느끼기엔 레이턴시가 그리 크지 않을 수 있으나, 게임 서버와 같은 네트워크 속도가 생명인 서비스나 중요한 은행 등의 서비스라면 이야기가 달라진다.

그래서 AWS Global Accelerator를 사용하면 아래와 같다.

![](https://velog.velcdn.com/images/yulmwu/post/e22844fc-f54e-417e-af75-bc46808c7b59/image.png)

사진과 같이 각 클라이언트는 같은 Anycast IP를 가지고 Global Accelerator에 접근한다. 그렇게 되면 자동으로 클라이언트와 가장 가까운 엣지 로케이션을 찾게 되고, 해당 엣지 로케이션을 진입점으로 시작하여 AWS 백본 네트워크를 타서 서버로 데이터가 송수신된다.

각 클라이언트는 가장 가까운 Global Accelerator 엣지 로케이션에 접근하기만 하면 AWS 백본 네트워크를 탈 수 있기 때문에 빠르게 서버에 도착할 수 있다.

내부적으로 자세히 보면 아래와 같다.

![](https://velog.velcdn.com/images/yulmwu/post/2d457814-faa0-4a71-805e-3543398340df/image.png)

앞서 예시로 든 구조에선 단일 서버였으나, 고가용성과 빠른 서비스를 위해 여러 리전에 같은 서버를 두는 경우도 있다. (CloudFront와 헷갈리면 안된다. 서버를 엣지 로케이션에 캐싱하는게 아니다.)

![](https://velog.velcdn.com/images/yulmwu/post/f2d39a5f-676b-40cc-bdb7-4cbbeed943e9/image.png)

이렇게 할 경우 하나의 Anycast IP를 사용하여 가까운 Global Accelerator 엣지 로케이션에 접근하고, 백본 네트워크에서 최적의 경로와 가까운 서버를 찾는다.

여기서 만약 ap-northeast-1 리전에 있는 서버가 다운되면 어떻게 될까? 이 경우엔 Global Accelerator에서 자동으로 남은 가장 가까운 서버인 us-east-1에 있는 서버로 Failover 한다.

![](https://velog.velcdn.com/images/yulmwu/post/034ac739-6377-43bb-8f40-3800672dd328/image.png)

참고로 Global Accelerator에선 2개의 Static Anycast IP를 제공해주는데, 그 이유는 가용성 보장(SLA 보장) 등이 있다.

## Speed Comparison

AWS에서 Global Accelerator를 사용했을 때 어느 정도의 속도를 내줄 수 있는데 테스트할 수 있는 페이지가 있다.

https://speedtest.globalaccelerator.aws

예를 들어 버지니아 북부에서 테스트 해보면 아래와 같다.

![](https://velog.velcdn.com/images/yulmwu/post/b03af6ee-5b38-4ed4-9c9d-094513cce672/image.png)

기존엔 590ms가 걸리던 작업을 Global Accelerator 사용 시 431ms로 27% 정도 더 빠르다고 한다.

좀 극단적인 결과를 보자면, 인도 하이데라바드 리전에선 아래와 같은 결과를 볼 수 있었다.

![](https://velog.velcdn.com/images/yulmwu/post/aac8af4c-137a-4ab5-b491-49058279a757/image.png)

Global Accelerator 사용 시 무려 87% 가량 더 빠르게 송수신될 수 있다고 한다. 그럼 우리가 살고있는 서울에선 어떨까?

![](https://velog.velcdn.com/images/yulmwu/post/4bfca2eb-dae6-4ae3-b25d-47db65e604e2/image.png)

사진과 같이 별 차이가 없는 것을 볼 수 있다. 애초에 한국 내에선 Global Accelerator를 거치나 다이렉트로 인터넷을 거치나 가까우니 별 차이가 없는 것이다.

## When to use?

사실 일반적인 서버라면 잘 사용하지 않는다. 글로벌 서비스라 해도 클라이언트가 육안으로 느끼기엔 별 차이가 없을 수 있다.

하지만 빠르게 처리해야할 작업, 예를 들어 은행 전산 작업 등에선 이러한 Global Accelerator를 적용하여 빠른 데이터 송수신을 가능하도록 하는 경우가 많다.

특히 게임 서버에서 주로 사용되는데, FPS 게임 등에선 네트워크 속도가 생명이기 때문에, Global Accelerator와 더불어 아예 서버 자체를 여러 리전(지역)에 분리시키는 경우도 있다.

이 경우엔 DB와 같은 모든 요소가 분리시키는 경우가 많기 때문에 게임 계정을 만들 때 지역을 선택하도록 한다.

## Downside

물론 단점도 존재한다. 클라이언트는 무조건 Global Accelerator의 Static Anycast IP를 통해 접근하고, 가장 가까운 엣지 로케이션을 통해 통신하기 때문에 근처에서 엣지 로케이션이 없다면 오히려 레이턴시가 심해질 수 있다.

특히 러시아는 엣지 로케이션을 비롯한 AWS 관련 데이터센터 자체가 없고(우크라이나 전쟁 이후 철수함), 중국의 경우 그 수가 적기 때문에 오히려 Global Accelerator를 사용했을 때 불이익이 있을 수 있다.

이러한 특수한 상황의 지역이 아니라면 Global Accelerator를 사용했을 때 더욱 좋은 퍼포먼스를 내줄 수 있다.

# 2. Let's try AWS Global Accelerator

이 포스팅에선 AWS Global Accelerator(이하 AGA) 실습에서 아래와 같이 구축해보고 테스트해볼 것이다.

1. EC2 인스턴스 2개 생성 (ap-northeast-1, us-east-1)
2. AGA 연결
3. AGA 연결 테스트
4. VPN 테스트
5. Failover 테스트

실제 서비스에선 EC2 단독으로 사용하는 것이 아닌 ALB 등의 서비스를 통해 로드밸런싱 하겠지만, 빠른 예시를 위해 2개의 리전에 EC2를 단독으로 띄워보겠다.

## (1) EC2 Instance

먼저 EC2 인스턴스를 `ap-northeast-1` 리전과 `us-east-1` 리전에 EC2를 올리고 웹 서버를 띄워보자. Public IP가 있어야 한다.

![](https://velog.velcdn.com/images/yulmwu/post/e3d6cccc-835d-418a-bd06-8687f75b5c86/image.png)

이렇게 리전 2개에 EC2 인스턴스를 만들자. 그리고 테스트를 위해 Nginx를 실행해서 웹 서버를 띄워보겠다.

SSH로 접속 후 아래의 명령어를 통해 Nginx를 설치하자.

```shell
sudo apt update
sudo apt install -y nginx
sudo systemctl enable --now nginx
```

![](https://velog.velcdn.com/images/yulmwu/post/ccf7c087-632a-4a3d-a62c-37d047eb7bfe/image.png)

그리고 HTML 파일을 하나 만들자.

```shell
cd /var/www/html
sudo chmod +777 .
echo 'Hello from ap-northeast-2' >> index.html
```

그리고 Public IP에 접속하여 잘 나오는지 확인해보자.

![](https://velog.velcdn.com/images/yulmwu/post/9f5257c4-cee6-4f25-9b4a-0fc2645b5a88/image.png)

이제 이걸 us-east-1에 만들어뒀던 인스턴스에도 똑같이 반복하되 HTML 내용만 살짝 바꿔두자.

![](https://velog.velcdn.com/images/yulmwu/post/33deef48-1f97-45e5-a6a2-76faba3d9e32/image.png)

잘 설치되었다. 다음으로 Global Accelerator를 생성해보자.

## (2) Global Accelerator(AGA)

![](https://velog.velcdn.com/images/yulmwu/post/541e0b5a-78ae-454b-922b-0fde77b6adf6/image.png)

IP 주소 유형은 IPv4로 선택한다. 원할 시 IPv4, IPv6 듀얼 스택으로 선택할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/5e210975-0071-4f4c-b07d-f00be7f124ea/image.png)

그리고 리스너는 TCP 80포트(HTTP)로 만들어준다.

![](https://velog.velcdn.com/images/yulmwu/post/aee14425-ea2f-42e9-ae06-28802dd0e835/image.png)

엔드포인트 그룹 추가에선 먼저 리전을 선택해준다. 트래픽 다이얼 항목이 있는데, 해당 리전으로 트래픽을 얼마 만큼이나 보내줄 지 비율을 정해줄 수 있다.

기본 값은 100%로, 해당 리전의 서비스가 가까이 있다면 항상 그 서비스로 보내준다. 만약 50%로 설정하였다면 해당 리전으로 가는 트래픽의 50%는 들어가고, 나머지 50%는 해당 리전을 제외한 가까운 리전의 서비스로 가게 된다.

![](https://velog.velcdn.com/images/yulmwu/post/52494754-5dff-4ebe-a241-d1e2c8f2afea/image.png)

다음으로 해당 리전의 엔드포인트 그룹에 대한 헬스 체크 설정도 해준다. 만약 ALB를 연결하였다면 이 설정은 무시되고 ALB(정확히는 타겟 그룹)의 헬스 체크 설정을 따른다.

![](https://velog.velcdn.com/images/yulmwu/post/6d1db9b2-3543-4d42-ae04-b2c3779ee481/image.png)

같은 설정으로 ap-northeast-2 리전의 엔드포인트 그룹도 만들어둔다.

![](https://velog.velcdn.com/images/yulmwu/post/eaafd99a-5736-4d83-a689-4279b942f1af/image.png)

그리고 엔드포인트는 아까 만들어둔 EC2로 연결하자. 여기서 가중치는 해당 엔드포인트 그룹 안에서 얼마 만큼 트래픽을 분배할지를 정하는데, 하나밖에 없으니 의미는 없다.

클라이언트 IP 보존 기능은 말 그대로 AGA를 거쳐도 클라이언트의 IP를 보존할지를 의미한다. EC2는 기본적으로 보존된다.

![](https://velog.velcdn.com/images/yulmwu/post/2f43e746-f6db-48da-9124-ee76d0eee5ed/image.png)

ap-northeast-2 리전도 똑같이 작업해준다.

![](https://velog.velcdn.com/images/yulmwu/post/b1316ffa-1af3-42c2-8abe-a236c42d384a/image.png)

그럼 생성이 완료 된다. 사용될 수 있을때 까지 시간이 좀 걸릴 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/02a1b646-d487-4892-8697-fbc3587f8e84/image.png)

생성이 완료되었다면 아래와 같은 두개의 Static Anycast IP 주소가 나타난다.

![](https://velog.velcdn.com/images/yulmwu/post/5182d74e-d2f2-43ff-93ae-6db8ce10573c/image.png)

## (3) Testing

아무 IP나 복사해서 접속해보자.

![](https://velog.velcdn.com/images/yulmwu/post/80cd9901-49ca-420a-b7eb-e1fabdee368d/image.png)

그러면 ap-northeast-2에서 생성한 EC2 서버가 잘 나타난다. 그럼 두가지 테스트를 해보자. (AWS 백본 네트워크의 성능 측정은 개요에서 AWS 측정 툴로 측정해봤으니 생략한다. 즉 Anycast IP를 사용한 엣지 로케이션 접근만 테스트한다.)

### Testing with VPN

먼저 VPN을 사용하여 us-east-1 리전과 가까운 지역으로 우회한다.

![](https://velog.velcdn.com/images/yulmwu/post/2f4a3563-679b-4a2c-b3f9-41b10f599cde/image.png)

그리고 아까 Global Accelerator 주소로 접속해보자.

![](https://velog.velcdn.com/images/yulmwu/post/79d914ea-9451-4af6-916e-746ffecd5785/image.png)

그러면 이번엔 us-east-1으로 나타나는 것을 볼 수 있다. 이처럼 Anycast IP를 통해 가장 가까운 엣지 로케이션을 찾고, 가장 가까운 리전의 EC2 서버에 접근하는 실습을 해보았다.

### Failover Test

Global Accelerator의 기능 중 하나로 가까운 리전의 서비스가 다운된다면 그 리전을 제외한 다른 가까운 리전에게 트래픽을 Failover 할 수 있다.

테스트로 ap-northeast-2 서버를 죽여서 us-east-1으로 트래픽 Failover가 되는지 확인해보자.

![](https://velog.velcdn.com/images/yulmwu/post/5b9f7c3b-a770-47c4-9c8a-de8879157680/image.png)

ap-northeast-2에 올린 EC2를 중지시켜보자.

![](https://velog.velcdn.com/images/yulmwu/post/4d845a8f-bcf0-4695-9103-854f3a8972b5/image.png)

그럼 Global Accelerator에서 설정한 헬스 체크가 위 사진처럼 실패하면 트래픽을 us-east-1으로 Failover 시킨다.

![](https://velog.velcdn.com/images/yulmwu/post/2e7fee4d-4620-4f2e-bfdd-ca0e60c77a8c/image.png)

잘 Failover 되는 것을 볼 수 있다. 마지막으로 Global Accelerator의 요금에 대해 알아보고 글을 마무리 하겠다.

# 3. Calculate Price

먼저 켜두기만 해도 시간당 고정적으로 요금이 나간다.

![](https://velog.velcdn.com/images/yulmwu/post/031a5013-bec2-470c-ac6a-f5716c85cd3e/image.png)

시간 당 0.025\$로, 24시간이면 0.6\$, 한달(30일)이면 약 18\$ 정도가 부과된다.

그리고 다른 서비스의 데이터 Transfer 비용과는 별개로 Global Accelerator의 Data Transfer Premium 요금이 붙는다. AWS 백본 네트워크를 사용하여 프리미엄이라는 명칭이 붙은 듯 싶다.

다만 특이하게 양방향 송수신에서 주된 방향, 즉 지배적 방향의 트래픽 용량으로 계산되어 요금이 부과된다.
(일반적으로 클라이언트로 나가는 아웃바운드가 지배적 방향이다.)

단가는 작업을 처리한 리전과 아웃바운드 되는 엣지 로케이션의 조합에 따라 달라지는데, 아래의 표를 보자.

![](https://velog.velcdn.com/images/yulmwu/post/bd7fbf32-33b3-40e2-a694-87a2297cc373/image.png)

여기서 만약 ap-northeast-1(대한민국) 리전에서 처리가 되었고(EC2), 그 데이터가 미국의 엣지 로케이션으로 나간다면 1GB당 0.017\$의 추가 요금(DT Premium)이 부과되는 방식이다.

예를 들어 월 별로 EC2에서 1TB의 아웃바운드 트래픽이 있다면, EC2 Data Transfer 비용과 Global Accelerator 트래픽 비용이 같이 발생한다.

![](https://velog.velcdn.com/images/yulmwu/post/7c14ae27-34fa-41fd-9f9a-c89ae49efc30/image.png)

(EC2 트래픽 아웃바운드 Transfer 비용 중 첫 100GB는 무료지만, 무시하고 1GB 당 0.126$라고 가정해보겠다.)

- EC2 Transfer : $1,000 × 0.126\$ = 126\$$
- Global Accelerator DT Premium (대한민국에서 미국으로) : $1,000 × 0.017\$ = 17\$$
- (또는) Global Accelerator DT Premium (대한민국에서 대한민국으로) : $1,000 × 0.043\$ = 43\$$

그리고 GLobal Accelerator는 기본적으로 고정된 2개의 퍼블릭 IPv4 주소를 할당해준다.
즉 VPC Public IP 요금(시간 당 0.005$)에 따라 아래와 같이 IPv4 요금이 나온다.

- Public IPv4 : $2 × 0.005 × 24 × 30 = 7.2\$$

결과적으로 모두 합산하면 월별로 약 150\$의 요금이 발생하게 된다. 물론 대한민국 소스(리전)에서 미국 엣지 로케이션으로 보내는 기준이고, 리전과 엣지 로케이션에 따라 다르게 부과되니 요금 표를 참고하도록 하자.

이상으로 AWS Global Accelerator에 대한 포스팅을 마치겠다.
