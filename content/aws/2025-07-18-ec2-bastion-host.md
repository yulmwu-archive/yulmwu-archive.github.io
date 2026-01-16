---
title: '[AWS Computing] Configure EC2 Bastion Host'
description: 'AWS EC2 Bastion Host 구성 방법'
slug: '2025-07-18-ec2-bastion-host'
author: yulmwu
date: 2025-07-18T11:55:33.318Z
updated_at: 2026-01-14T08:59:36.167Z
categories: ['AWS']
tags: ['Computing', 'aws']
series:
    name: AWS
    slug: aws
thumbnail: ../../thumbnails/aws/ec2-bastion-host.png
linked_posts:
    previous: 2025-07-18-ecs-deploy
    next: 2025-07-18-aws-deployment-with-ec2-ecs-and-documentdb-elasticache
is_private: false
---

# 0. Overview

하나의 시나리오를 가정해보자.

보안따윈 신경쓰지 않는 상남자 테토남 MZ 사원이 아래와 같은 아키텍처를 쓰자고 제안하였다.

![](https://velog.velcdn.com/images/yulmwu/post/9f6e2c68-a4a4-49e6-a711-c419787a41a9/image.png)

평범한 아키텍처 처럼 보이고, 사내에 DevOps를 할 수 있는 사람이 그 MZ 사원밖에 없었기 때문에 그대로 아키텍처를 적용하여 배포하였다.

그리고 다음날 인터넷 상에 돌아다니는 수많은 봇들에 의해 하나의 EC2가 공격을 받아 뻗어버렸다.

여기에 만약 WAF와 같은 방화벽을 도입한다 해도, ELB(ALB) 앞에 붙이는 것은 무용지물이다.

각 EC2는 퍼블릭 서브넷에 있고 퍼블릭 IP가 부여된 상태이기 때문에 그 IP로 공격하면 그만이기 때문이다.

그럼 EC2마다 WAF를 붙이는 전략은 인스턴스 하나하나 전부 해줘야하기 때문에 비효율적이고, 애초에 EC2 인스턴스에 단독으로 WAF를 붙이는건 불가능하고 ALB나 CloudFront 등에만 붙는다.

이 허점의 보완 방법은 간단하다. 같은 VPC 안에 있고, 앞에 퍼블릭한 ELB(ALB)를 달아뒀으니 EC2는 프라이빗 서브넷에 두면 된다.

![](https://velog.velcdn.com/images/yulmwu/post/3bd677e8-c863-4ec3-bbba-6fe13e87e7c0/image.png)

그럼 위에서 말한 보안 문제도 없어지고, WAF와 같은 방화벽은 로드밸런서에 붙여주면 되는 것이기 때문에 효율적이다.

다만 그럴 경우 프라이빗 서브넷의 EC2 입장에선 외부(인터넷)과 통신 할 방법이 없어지므로(퍼블릭 IP도, IGW도 없음) NAT Gateway 등을 도입해야 한다.

아무튼, 그런데 어떠한 이유로 EC2에 SSH나 SCP 등의 작업으로 프라이빗 서브넷의 EC2에 접근해야 되는 상황이 있을 수 있다.

그런데 EC2들은 프라이빗 서브넷에 위치하여 퍼블릭 IP 없이 프라이빗 IP만 가지고 있기 때문에 VPC 외부에서 직접 접근할 순 없다.

# 1. Bastion Host

그럼 잘 생각을 해보자, VPC 내의 서브넷들은 라우팅 테이블로 인해 서로 연결되어 있고, 그것은 퍼블릭 서브넷이던 프라이빗 서브넷이던 상관 없이 통신할 수 있다.

그럼 간접적으로 EC2 하나를 퍼블릭 서브넷에 둬서 VPC 외부에서 접근할 수 있게 하고, 그 퍼블릭 서브넷에 위치한 EC2로 프라이빗 서브넷의 EC2들에 접근하면 된다.

이게 바로 **Bastion Host(배스천 호스트)**이다. 쉽게 말해 외부에서 내부 네트워크에 접근할 수 있게 하는게 Bastion Host이다.

AWS에선 특별한 기능은 아니고 그냥 퍼블릭 서브넷에 EC2 하나를 둬서 내부의 네트워크에 접근할 수 있도록 한다.

![](https://velog.velcdn.com/images/yulmwu/post/51e82963-f6bf-4590-8ab8-8d23e8bf922d/image.png)

# 2. Configure EC2 Bastion Host

## VPC

먼저 편의상 VPC 하나를 만들어준다.

![](https://velog.velcdn.com/images/yulmwu/post/a0bec2e5-8a20-4026-a27c-b2d86befdb0b/image.png)

## Private EC2

그리고 해당 VPC의 프라이빗 서브넷에 EC2 하나를 만든다.
(예시로 직접 만드는데, ASG를 설정하는 등등 EC2면 된다.)

![](https://velog.velcdn.com/images/yulmwu/post/011accef-5bed-4ad7-878e-584c3f54dce3/image.png)

위와 같이 VPC는 방금 만들었던 VPC로, 그리고 서브넷은 프라이빗 서브넷으로 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/210ab05b-231e-4019-a581-9e32c4645ace/image.png)

그럼 위와 같이 프라이빗 IPv4 주소만 나타나게 된다. 즉 VPC 외부에서 해당 EC2에 직접 접근할 방법은 없다.

## Bastion Host EC2

그럼 위 EC2에 간접적으로 접근할 수 있도록 Bastion Host EC2를 만들어보겠다.

![](https://velog.velcdn.com/images/yulmwu/post/2e73d2fa-0535-44c8-8bab-0fc2d5d206ac/image.png)

Bastion Host를 만들 땐 위와 같이 퍼블릭 서브넷에 만들고, 퍼블릭 IP 할당을 체크한다. (그래야 접속할 수 있다.)

![](https://velog.velcdn.com/images/yulmwu/post/ccd17381-02f5-4e25-9f92-cd5c1a59e633/image.png)

그럼 아까 프라이빗 서브넷과는 다르게 퍼블릭 IPv4 주소가 할당되고, 여기엔 접속할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/d94888ee-f097-4f16-85a6-619baba010c6/image.png)

이렇게 Bastion Host EC2에 접속하였다.

![](https://velog.velcdn.com/images/yulmwu/post/d2bd3124-e94b-4a3c-8d2d-2c49fd9b9d7d/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/8cc1c122-e3a9-4775-9e17-215f8880fe80/image.png)

Bastion Host EC2의 프라이빗 IPv4 주소도 잘 나온다. 그럼 다음으로 여기서 프라이빗 서브넷에 있는 EC2에 접속해보자.

하지만 그 전에 해당 Bastion Host에 키페어 파일(`.pem`)을 가져와야 한다. 간단하게 `scp` 명령어를 사용하여 가져오도록 하자. (SSH 기반의 파일 전송 프로토콜이다.)

![](https://velog.velcdn.com/images/yulmwu/post/4719a550-8314-440c-a52e-6406ede829a3/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/1abc4148-bef5-4f74-8ed5-bf6aa23934c7/image.png)

(같은 키페어 파일을 사용하였기 때문에 위와 같이 복사하였다.)

잘 복사가 되었으니 Bastion Host EC2에서 프라이빗 EC2에 SSH로 접속해본다.

![](https://velog.velcdn.com/images/yulmwu/post/55bc68b6-527f-49bf-9870-20830084e0ba/image.png)

위 사진과 같이 Bastion Host EC2에서 프라이빗 IP를 가지고 프라이빗 서브넷의 EC2에 접속하는 모습을 볼 수 있다. 이게 Bastion Host의 역할이다.

때문에 Bastion Host에 대한 보안은 매우 강력해야 한다. 키페어 파일 관리를 잘 할것, 그리고 필요하지 않은 경우 EC2이기 때문에 꺼둘 수 있다는 점 등을 생각해야한다.

---

참고로 방금 만들어둔 아키텍처의 경우 프라이빗 서브넷의 EC2에선 인터넷과 통신할 수 없는게 정상이다.

![](https://velog.velcdn.com/images/yulmwu/post/8c72be9d-a91d-418d-9a49-1cc58dd1ff29/image.png)

NAT Gateway 등을 달아주지 않았기 때문이다.
