---
title: '[AWS Networking] VPC Peering, Transit Gateway and PrivateLink'
description: 'AWS VPC Peering, Transit Gateway 및 PrivateLink를 통한 다중 VPC/계정 간 네트워킹'
slug: '2025-09-09-aws-vpc-peering-transit-privatelink'
author: yulmwu
date: 2025-09-09T23:35:30.426Z
updated_at: 2026-01-14T09:53:44.953Z
categories: ['AWS']
tags: ['aws', 'networking']
series:
    name: AWS
    slug: aws
thumbnail: ../../thumbnails/aws/aws-vpc-peering-transit-privatelink.png
linked_posts:
    previous: 2025-09-09-aws-serverless
    next: 2025-09-09-aws-global-accelerator
is_private: false
---

# 0. Overview

먼저 어떠한 이유로 두개의 VPC, 그리고 온프레미스 네트워크가 통신할 일이 있다고 생각해보자.

![](https://velog.velcdn.com/images/yulmwu/post/d206e2dc-cde3-453b-82e6-f8ccb6d81330/image.png)

AWS에선 VPC, 또는 VPC 내 리소스 끼리 통신하기 위해 아래와 같은 서비스를 제공한다.

- VPC Peering
- VPC Transit Gateway
- VPC PrivateLink
- VPC Lattice

여기서 VPC Lattice는 따로 다뤄보도록 하고, VPC Peering, Transit Gateway, PrivateLink에 대해 다뤄보겠다.

## What is VPC Peering?

VPC Peering은 두 VPC 간의 통신을 위해 일종의 통로를 만들어준다. 아래의 자료를 보자.

![](https://velog.velcdn.com/images/yulmwu/post/fe43e7ee-7ee1-4c5f-82be-a3b994da7b6d/image.png)

VPC A과 VPC B는 VPC Peering으로 서로 통신할 수 있다. 라우팅 테이블의 경우 상대 VPC의 CIDR을 목적지로, VPC Peering 리소스(`pcx-567865678`)를 대상으로 설정한다.

그리고 온프레미스는 B VPC와 Virtual Private Gateway(VGW)로 연결한다. (VPN)

그런데 여기서 문제가 있는데, 만약 서로 통신해야할 VPC가 더 많아지고 통신해야할 경우도 많아지면 어떻게 될까?

![](https://velog.velcdn.com/images/yulmwu/post/6fde7199-e73e-47e4-9d22-1fb6a901f46f/image.png)

위 자료처럼 VPC Peering(PCX) 설정과 VPN Connection(VGW) 설정이 늘어나고, 라우팅 테이블도 설정해야할 것이 많아진다.

이렇게 모든 VPC와 온프레미스가 서로 통신할 수 있기 위해선 Full Mesh 형태로 만들어야한다.

VPC나 온프레미스가 $N$개가 있을 때 모든 VPC를 서로 연결하기 위해 필요한 Peering 연결의 개수는 아래와 같다.

$\frac {N \times (N - 1)}{2}$

예를 들어 2개의 VPC가 있다면 1개의 Peering이 필요하고, 3개라면 3개, 4개라면 6개, 5개라면 10개, 규모가 매우 커져 10개의 VPC를 모두 연결해야 한다면 45개의 Peering이 필요하게 되므로, 이렇게 되면 관리하기가 매우 어려워진다.

## What is VPC Transit Gateway?

위와 같은 이유로 VPC Transit Gateway(이하 TGW)를 사용할 수 있다. 먼저 TGW의 다이어그램을 보자.

![](https://velog.velcdn.com/images/yulmwu/post/a453e3a0-b27f-451d-a11d-6a18bff0e646/image.png)

위 자료와 같이 VPC Peering과 다르게 Transit Gateway라는 서비스를 중앙에 둔다. 이 TGW는 일종의 허브/라우터와 같은 역할인데, 이 TGW가 중앙에서 연결을 관리한다.

이렇게 되면 각 VPC나 온프레미스에선 라우팅 테이블에 목적지 IP와 대상엔 TGW 서비스를 적어두면 된다.

그러면 목적지 IP로 접속 시 Next Hop이 TGW로 가게되고 TGW는 자동으로 알맞은 VPC로 Transitive Routing 된다.

TGW는 자체적으로 라우팅 테이블을 가지게 되는데, 목적지로는 VPC IP CIDR과 VPC Attachment(`atc-*`)를 적어둔다. Attachment는 VPC(또는 온프레미스 VPN)와 TGW를 연결하기 위한 연결을 의미한다.

이렇듯 VPC Transit Gateway는 Hub and Spoke 구조로 중앙에서 여러 VPC나 온프레미스로 라우팅을 해주는 것이다.

## What is PrivateLink?

상황을 조금 다르게 생각해보자. 예를 들어 어느 SaaS 서비스 제공 업체(프로바이더)가 VPC 내 하나의 서비스를 운영하고 있고, 소비자(컨슈머)가 그 서비스를 인터넷을 통하지 않고 Private하게 AWS 백본망을 통해 접근해야 한다.

그런데 그렇다고 그 VPC 전체를 노출하면 문제가 될 수 있다.

물론 노출용 VPC를 만들어서 보안그룹이나 NACL를 잘 설정하면 VPC를 노출시켜도 괜찮을 수 있지만, 유지보수 측면에서 효율적이지 못하고 CIDR이 중복되면 안되는 등 단점이 있다.

그래서 아래와 같이 내부적으로 통신하기 위해 프로바이더는 엔드포인트 서비스를 생성하는데, 보통 NLB 뒤 대상으로 프라이빗하게 노출하고자 하는 서비스를 연결한다.

그리고 컨슈머에선 VPC 엔드포인트를 생성하고 컨슈머 서브넷에 ENI가 생성된다. 이후 ENI IP나 NLB DNS를 통해 접근하면 되고, 생성된 ENI가 프로바이더 서비스와 AWS 백본망을 통해 연결해준다.

![](https://velog.velcdn.com/images/yulmwu/post/a66bea10-c1c4-4f18-97d0-b48e6e07c5f4/image.png)

이렇게 엔드포인트와 엔드포인트 서비스를 통해 AWS 내부적으로 VPC 간 서비스 끼리 통신할 수 있게 하는 것이 PrivateLink이다.

# 1. Examples

아래와 같은 순서로 실습해보겠다.

- VPC Peering 설정 후 두 VPC 간 통신 가능 유무
- VPC Transit Gateway 설정 후 두 VPC 간 통신 유무
- PrivateLink 설정 후 컨슈머에서 NLB DNS를 통한 프로바이더 서비스 접근

## (1) VPC Peering

먼저 2개의 VPC를 만들어주겠다. VPC A는 CIDR `10.1.0.0/16`, VPC B는 CIDR `10.2.0.0/16`으로 설정하겠다.

![](https://velog.velcdn.com/images/yulmwu/post/ee65cc60-66e7-4505-af53-7222f25f7c92/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/955f5401-fc1c-469a-96a9-3aa60e921222/image.png)

다음으로 각 VPC에 테스트용 EC2를 만들자.

![](https://velog.velcdn.com/images/yulmwu/post/f83cd8d6-71b4-42bd-af1e-b59149913a4c/image.png)

그리고 `test-a` 인스턴스에 접속하여 웹 서버를 설치해주겠다.

![](https://velog.velcdn.com/images/yulmwu/post/15e56820-0c75-4727-a1d2-e99efaffa2ec/image.png)

준비가 되었다. 같은 VPC A에선 Private IP를 통해 접근할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/7a973862-f88c-48a7-a8d9-6fab2441faaf/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/fdc17bdd-f206-44b0-b26c-68a146cea011/image.png)

그런데 VPC B에 만들어둔 EC2 인스턴스로 접근해보자.

![](https://velog.velcdn.com/images/yulmwu/post/105a5e46-aa29-45b6-aa9c-a10a36b6623e/image.png)

그럼 접속이 안되는 것을 볼 수 있다. 이제 두 VPC를 Peering 해보자.

![](https://velog.velcdn.com/images/yulmwu/post/b1aa6924-4a11-4f93-aa10-23965578f848/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/cc6acb96-aef2-4e25-89bd-d016dc8601d5/image.png)

Peering 설정에서 요청자와 수락자가 있는데, VPC B의 인스턴스가 VPC A의 웹 서버로 접근을 하려 하는 것이니 요청자는 VPC B, 수락자는 VPC A로 설정해두었다.

![](https://velog.velcdn.com/images/yulmwu/post/dfdd9790-03a6-4a2d-8a12-3fa32a7ab851/image.png)

만들고나면 수락 대기중이라 표시되는데, 작업 버튼에서 수락을 해주자. 그리고 각 VPC의 서브넷 라우팅 테이블에서 Peering이 가능하도록 설정을 해줘야 한다.

먼저 VPC A부터 보자.

![](https://velog.velcdn.com/images/yulmwu/post/51b92211-5c76-4d34-b900-19ab1baa7008/image.png)

목적지는 VPC B인 `10.2.0.0/16`, 대상은 만들어둔 Peering(`pcx-...`)으로 설정해두었다.

그리고 VPC B를 설정해보자.

![](https://velog.velcdn.com/images/yulmwu/post/6dfdf9ee-4d5b-4fec-a0f0-ddf6e273e1b2/image.png)

마찬가지로 목적지는 VPC A인 `10.1.0.0/16`, 대상은 같은 Peering으로 설정하였다. 이제 아까는 안되었던 `curl 10.1.0.288`을 다시 실행해보자.

![](https://velog.velcdn.com/images/yulmwu/post/d11e8d3d-207e-41bb-ae7d-e1134c6f75bb/image.png)

그럼 사진과 같이 다른 VPC 간 통신이 잘 되는 것을 볼 수 있다.

## (2) VPC Transit Gateway

다음으로 TGW 실습을 해보자. TGW 또한 마찬가지로 만들어뒀던 VPC에서 진행하고, Peering 연결과 라우팅 테이블을 처음처럼 만들어주자.

![](https://velog.velcdn.com/images/yulmwu/post/8a8a69b9-1810-4efa-a2d9-d403ac740e59/image.png)

VPC가 다르기 때문에 접근이 안된다. 이제 Transit Gateway를 만들어보자.

![](https://velog.velcdn.com/images/yulmwu/post/fec00859-a6e8-4a84-8aec-c1253d24fef2/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/1afcd3a9-4989-47ff-a5f0-4a5c0603517c/image.png)

그러면 구성에 여러 옵션이 나오는데, 그 중 "기본 라우팅 테이블 연결(Association)"은 VPC Attachment 하나 당 하나의 TGW 라우팅 테이블을 연결한다.

그리고 "기본 라우팅 테이블 전파(Propagation)"는 연결된 VPC Attachment를 바탕으로 한개 이상의 TGW 라우팅 테이블에 해당 VPC CIDR을 자동으로 등록해준다.

이 기능이 옵션으로 있는 점과 여러개의 전파(Propagation)가 가능하다는 점에서 TGW 라우팅 테이블을 여러개 만들어두고 어떤 Attachment는 Association만, Propagation은 제한적으로/수동적으로 설정하고, 다른 Attachment는 여러 TGW 라우팅 테이블에 Propagation를 허용하는 방식으로 운영할 수 도 있다.

간단하게만 알아볼 예정이기 때문에 둘 다 자동으로 되도록 설정했다. (ASN은 BGP에서 사용되는 식별 번호인데, 기본으로 냅두면 64512으로 자동으로 설정된다.)

![](https://velog.velcdn.com/images/yulmwu/post/498f8262-1a46-436e-b8e7-069439e1805a/image.png)

그리고 VPC A, B Attachment를 생성해주자.

![](https://velog.velcdn.com/images/yulmwu/post/a101ca98-2cd8-4dc0-b5ab-f454af38e0dd/image.png)

(VPC 사이드바 메뉴에서 "Transit Gateway 연결" 탭에 있다.)

![](https://velog.velcdn.com/images/yulmwu/post/9abc3e5e-3df8-4c6f-816b-baa84ea9f900/image.png)

Transit Gateway ID는 만들어둔 TGW를, 연결 유형은 VPC를 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/e1ad08fd-6c63-4ce3-a3f0-fa4f69b5d195/image.png)

그리고 VPC 연결에서 VPC A(`10.1.0.0/16`)를 선택해주고, 인스턴스를 만들어둔 서브넷을 선택해주자. 그러면 자동으로 해당 서브넷에 TGW 전용 ENI가 만들어질 것이다. (AZ마다 선택할 수 있는 서브넷은 1개이니 주의하자.)

![](https://velog.velcdn.com/images/yulmwu/post/72dca660-1db4-45a4-aa43-32e0dfa1020b/image.png)

이렇게 Attachment를 만들면 아래와 같이 TGW 라우팅 테이블에 자동으로 Association과 Propagation이 된다.

![](https://velog.velcdn.com/images/yulmwu/post/d8ad91d9-03c2-4413-8498-c95b3a4d3528/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/13108738-36b3-41a8-910c-123ac5202974/image.png)

그리고 각 VPC 라우팅 테이블에도 해당 TGW 라우팅을 해줘야한다. VPC A 인스턴스가 있는 서브넷의 라우팅 테이블을 아래와 같이 수정해보자.

![](https://velog.velcdn.com/images/yulmwu/post/8fe88388-2c4d-403f-be4d-cc00578e272f/image.png)

실습 도중 꼬이지 않았다면 해당 서브넷에서 VPC A Attachment가 떠야한다. 목적지는 VPC B CIDR인 `10.2.0.0/16`으로 설정한다. 마찬가지로 VPC B 라우팅 테이블도 수정해주자.

![](https://velog.velcdn.com/images/yulmwu/post/1061cad3-e0da-4fba-8c0a-9b08d1deb65c/image.png)

설정이 끝났다면 다시 VPC B에 있는 인스턴스로 접속하여 VPC A 인스턴스에 접근해보자.

![](https://velog.velcdn.com/images/yulmwu/post/d236d8ad-6436-40ee-b459-fe2b3b146d34/image.png)

그럼 위 사진과 같이 잘 접속되는 것을 볼 수 있다. TGW 정책 테이블 등의 더욱 세부적인 기능이 있으나, 이 블로그에선 여기까지만 다뤄보겠다.

## (3) PrivateLink

다음으로 PrivateLink 실습을 해보겠다.

마찬가지로 VPC A(CIDR 10.1.0.0/16)와 VPC B(CIDR 10.2.0.0/16)를 사용하고, VPC A(프로바이더)에 EC2 서버와 NLB, 엔드포인트 서비스를 구성하고 VPC B(컨슈머)에 VPC 엔드포인트와 EC2를 열어 VPC A 인스턴스에 접속해보겠다.

![](https://velog.velcdn.com/images/yulmwu/post/a55afa72-2af7-4e59-9a74-760beb0fc681/image.png)

일단 당연히 두 VPC 간 프라이빗 IP로 통신은 안되는 상태이다.

### VPC A (Provider)

먼저 NLB를 만들어주자.

![](https://velog.velcdn.com/images/yulmwu/post/6410a3ba-4b68-457d-a285-89c809eeaa2e/image.png)

내부 NLB로 설정하고, IPv4로 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/bdf8829f-3ce5-4a02-9df1-7b03e54bebdf/image.png)

그리고 네트워크 매핑에서 VPC A를 선택하고 두개 이상의 프라이빗 서브넷을 선택한다. 그리고 대상 그룹(TG)을 만들어야 하는데 타입은 "인스턴스", 프로토콜 80에 VPC A를 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/a1a99654-c56b-40a1-ac1f-7e8fb9c1bd6a/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/2e02c74a-a030-4020-aaad-69ba15ffd23b/image.png)

그리고 실제 서비스에선 오토스케일링 그룹 등으로 자동으로 TG에 포함되게 하겠지만, 실습용으로 인스턴스가 1개 밖에 없으므로 아래와 같이 직접 추가해주자.

![](https://velog.velcdn.com/images/yulmwu/post/f0a40ff2-08a9-4ec6-bd1a-b8f1a1029055/image.png)

다시 NLB 설정으로 돌아가 만든 TG를 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/c4401687-eadf-4e1a-bf2a-0c9b146da8bc/image.png)

NLB를 생성한다.

![](https://velog.velcdn.com/images/yulmwu/post/76fca899-abe4-45fb-a6f6-1df8dcae0e0f/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/b74ee2af-6d9e-410c-b3e4-c525534d3a1a/image.png)

Health Check가 잘 되는 것을 확인하였다면 다음으로 엔드포인트 서비스를 만들어 PrivateLink를 통해 AWS 내부적으로 다른 VPC나 계정으로 노출시키도록 해보자.

![](https://velog.velcdn.com/images/yulmwu/post/bcee2767-92d1-4ff0-83bf-c42c1a25ba85/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/e0719a12-3afc-40fa-b0a8-b6365e4bba2a/image.png)

"지원 리전"은 VPC가 다른 리전에 있을 때 사용하는 옵션인데 현재는 같은 리전(ap-northeast-2)에 있는 VPC 간 통신을 실습하는거니 패스하자.

![](https://velog.velcdn.com/images/yulmwu/post/468eb808-84d6-45bb-82da-9a88e2538e80/image.png)

만들고 나면 VPCE DNS가 보이는 것을 볼 수 있다. 추후 VPC B 인스턴스에서 해당 DNS를 사용하여 VPC A EC2 인스턴스에 접속할 수 있다.

### VPC B (Consumer)

VPC 엔드포인트를 만들어보자.

![](https://velog.velcdn.com/images/yulmwu/post/d5183418-3bdb-49f7-b20f-9f1d8e30a992/image.png)

> 기본적으로 S3 Gateway 엔드포인트가 있다. (VPC 생성에서 옵션 체크 시)
>
> 이는 S3, DynamoDB와 같이 인터넷을 거쳐 퍼블릭 엔드포인트를 통해 접근을 하는 서비스를 IGW/NAT을 거치지 않고 AWS 백본망으로 연결되도록 하는 Gateway 엔드포인트이다.

![](https://velog.velcdn.com/images/yulmwu/post/a297047d-c581-49e4-ba78-217087ffabd4/image.png)

엔드포인트 유형으론 "NLB 및 GWLB를 사용하는 엔드포인트 서비스"를 선택한다. 그리고 만들어뒀던 엔드포인트 서비스의 이름(`com.amazonaws.vpce.*`)를 넣고 서비스 확인을 누른다.

![](https://velog.velcdn.com/images/yulmwu/post/72891d3e-6759-4536-b7ac-a94e158f2b90/image.png)

그리고 VPC는 VPC B를 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/a62defc4-d814-45b9-ac36-6824983e7c31/image.png)

그리고 사진엔 없지만 서브넷과 80번 포트 아웃바운드가 가능한 보안그룹(Default VPC SG 사용)을 선택해주자. 그럼 Pending 상태가 되는데, VPC A 엔드포인트 서비스에 가보면 요청을 수락할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/98a047e1-6e8a-4acb-9017-6a9e786151c5/image.png)

다시 엔드포인트로 돌아가 DNS를 확인해보면 두개 이상의 DNS가 나타난 것을 볼 수 있다. (필자는 ap-northeast-2a 서브넷 하나만 선택해두었기 때문에 2개임.)

![](https://velog.velcdn.com/images/yulmwu/post/997252b8-d499-47a6-824b-7e58544f021a/image.png)

하나는 Region wide DNS, 다른 하나는 Zonal DNS로 전자는 Cross AZ로 내부적으로 자동으로 라우팅된다. 후자는 특정 AZ에 있는 엔드포인트 ENI(NIC)에 직접 라우팅된다. 일반적으로 Region wide DNS를 사용하면 된다.

![](https://velog.velcdn.com/images/yulmwu/post/d3cec582-85b9-4806-91a5-cc58a676c3b2/image.png)

만약 동작하지 않는다면 프로바이더(VPC A) 인스턴스의 SG와 컨슈머(VPC B) 인스턴스나 엔드포인트 ENI SG(또는 기본 VPC SG)에서 80번 포트가 잘 설정되어 있는지 확인하자. (포스팅 내용에선 살짝 생략되어 있음)
