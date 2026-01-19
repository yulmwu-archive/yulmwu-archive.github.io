---
title: '[AWS Networking] EC2 Source/Destination Checking (Feat. NAT Instance)'
description: 'AWS EC2의 Source/Destination Check 옵션 (Feat. EC2 NAT Instance)'
slug: '2026-01-04-aws-source-destination-check'
author: yulmwu
date: 2026-01-04T00:52:31.030Z
updated_at: 2026-01-18T07:59:40.317Z
categories: ['AWS']
tags: ['aws']
series:
    name: AWS
    slug: aws
thumbnail: ../../thumbnails/aws/aws-source-destination-check.png
linked_posts:
    previous: 2026-01-04-aws-s2s-vpn
    next: 2026-01-04-aws-codedeploy-single-ec2
is_private: false
---

# 0. Overview

AWS EC2는 기본적으로 아래와 같은 네트워크 트래픽을 받은 경우, 그 트래픽을 드롭한다.

- **목적지(Destination) IP가 인스턴스(정확히는 ENI) 자신이 아닌 패킷**
- **인스턴스가 직접 생성하지 않은 소스(Source) IP를 가진 패킷을 그대로 포워딩하거나 중계하려는 경우**

이와 같은 동작을 필요로 하는 경우나 장비 등을 잘 생각해본다면, 다른 곳으로 포워딩/라우팅해야 하는 패킷이나 프록시(L3/L4에서 동작하는 TProxy 등), 라우터, 방화벽/IDS 등에서 이러한 동작을 필요로 한다.

하지만 기본적으로 EC2 인스턴스(정확히는 ENI)는 라우터처럼 동작하지 않도록 설계되어 있다.

만약 남의 트래픽을 중계한다면 네트워크 루프 등의 네트워크 트래픽이 꼬이거나 IP 스푸핑과 같은 공격 시나리오가 가능하게 될 수 있기 때문에, 이러한 위험을 방지하기 위해 AWS는 기본적으로 **Source/Destination Check** 기능을 활성화해 두고 있다.

![](https://velog.velcdn.com/images/yulmwu/post/d2a8c8b9-77b0-4de4-9745-888ea37de6d7/image.png)

# 1. When to disable Src/Dst Check?

하지만 반대로, 의도적으로 EC2를 라우터처럼 동작시키도록 해야 할 상황이 있다. 그 경우는 자기 자신이 아닌 다른 엔드포인트의 트래픽을 중계하거나 라우팅 경로의 일부로 동작해야 할 때, 즉 인스턴스가 Transit Node로써 동작해야 할 경우이다.

- NAT Instance를 구성해야할 경우
- StrongSwan, OpenVPN과 같이 VPN 소프트웨어를 EC2에 직접 구성하고, VPN 인스턴스가 VPC 내부의 다른 인스턴스로 라우팅하는 경우
- L3/L4에서 동작하는 Transparent Proxy _(일반적인 L7 리버스 프록시는 애플리케이션 레벨에서 새로운 커넥션을 생성하지만, 원본 IP를 유지하는 TProxy는 Src/Dst Check를 비활성화 해야 함)_
- EC2 기반으로 구성된 가상 라우터, 방화벽, IDS/IPS, 보안 어플라이언스 등등..

## NAT Instance

이 중 NAT Instance에 대해 살짝 다뤄볼까 한다. AWS에선 NAT Gateway를 지원하는데, 과거에는 EC2 기반의 NAT Instance를 직접 프로비저닝하고 사용하였었다. (AMI로 프로비저닝 가능)

![](https://velog.velcdn.com/images/yulmwu/post/057acbf1-e588-42e6-a9ac-6a5106c5f300/image.png)

보안적인 측면, 가용성, 네트워크 대역폭 등의 측면에서 더 뛰어난 NAT Gateway가 나오고 NAT Gateway로의 마이그레이션 또한 권장하고 있지만, 간혹 비용적인 측면으로 NAT Instance를 직접 프로비저닝하기도 한다.

일반적으로 추천되는 아키텍처는 아니지만, 이 포스팅에서는 Source/Destination Check 옵션을 확인해보기 위해 NAT Instance를 프로비저닝하고 실습해보도록 하겠다.

# 2. Demo Practice

앞서 설명한 것과 같이 NAT Instance(퍼블릭 EC2)를 프로비저닝하고 프라이빗 EC2를 만들어 라우팅을 설정한 다음, Source/Destination Check를 ON/OFF 하며 NAT Instance가 동작하는지 실습해볼 것이다.

## (1) VPC

먼저 VPC 구조는 아래와 같다. 전형적인 퍼블릭 서브넷 + 프라이빗 서브넷을 가지고 있는 VPC이고, NAT Instance를 실습해보기 위해 NAT Gateway는 사용하지 않는다.

![](https://velog.velcdn.com/images/yulmwu/post/d6f6a931-61f9-42ac-8cdf-05a324b06148/image.png)

## (2) EC2 Instances

그리고 각각의 퍼블릭, 프라이빗 서브넷에 EC2를 프로비저닝하자. NAT Instance의 경우 AWS에서 지원하는 전용 AMI를 사용해볼 수 있으나, 지원이 끝난 구형 Amazon Linux 기반이니 Amazon Linux 2니 2023을 프로비저닝하고 직접 구성해볼 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/385e4e0b-1c73-4084-bc6f-537d57c49e34/image.png)

NAT Instance에 대한 네트워크 설정에서는 퍼블릭 IP 자동 할당을 활성화하고, 아래와 같은 보안 그룹 설정을 해두자. 프라이빗 서브넷의 CIDR을 사용하면 된다. (`10.0.128.0/20`)

![](https://velog.velcdn.com/images/yulmwu/post/46ad168c-c822-4bc4-be7a-17766f6af534/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/ebc90ef8-8524-4609-9df4-b0ccf1a49d23/image.png)

그리고 Private EC2는 아래와 같이 구성한다. Bastion Host 없이 SSM을 통해 접속해도 된다.

![](https://velog.velcdn.com/images/yulmwu/post/c6c98e0b-1bc4-49d9-ae10-71571921a975/image.png)

그 외의 구성은 기본 값으로 둬도 된다. 만약 Bastion Host를 통한 SSH 접속이 필요하다면 인바운드 규칙 중 SSH를 추가하면 된다.

## (3) NAT Instance

다음으로 NAT Instance에 SSH로 접속하고, 아래와 같은 명령어로 IP Forwarding을 활성화하고 SNAT(MASQUERADE)을 설정한다. (네트워크 인터페이스는 `enX0`를 기준으로 한다. 또는 `eth0` 일 수 있다.)

```shell
sudo yum install iptables-services -y
sudo yum install -y tcpdump

sudo systemctl enable iptables
sudo systemctl start iptables
```

```shell
sudo sysctl -w net.ipv4.ip_forward=1
echo "net.ipv4.ip_forward = 1" | sudo tee /etc/sysctl.d/99-nat-ipforward.conf
sudo sysctl --system

sudo iptables -L FORWARD --line-numbers
sudo iptables -D FORWARD 1

sudo iptables -t nat -A POSTROUTING -s 10.0.128.0/20 -o enX0 -j MASQUERADE

sudo iptables -A FORWARD -s 10.0.128.0/20 -o enX0 -j ACCEPT
sudo iptables -A FORWARD -d 10.0.128.0/20 -i enX0 \
  -m state --state RELATED,ESTABLISHED -j ACCEPT

# 규칙 확인: sudo iptables -t nat -S && sudo iptables -S FORWARD
# 재부팅 시 초기화될 수 있으나, 실습 목적이므로 그 부분에 대해선 생략함
```

![](https://velog.velcdn.com/images/yulmwu/post/ad5ee591-52f3-4cac-b663-d23c820a7157/image.png)

그리고 아래의 명령어를 실행하여 트래픽을 확인할 준비를 하자.

```shell
sudo tcpdump -ni enX0 net 10.0.128.0/20 and not port 22
```

## (4) Route Table

그리고 NAT Gateway를 설정할 때 처럼 프라이빗 서브넷의 라우팅 테이블에 `0.0.0.0/0 -> NAT Instance` 라우팅을 추가해야 한다.

![](https://velog.velcdn.com/images/yulmwu/post/3f795229-d744-4bb3-8985-ea46d7e8df6e/image.png)

## (5) Testing

이제 Private EC2에 Bastion Host나 SSM을 통해 접속하고 `curl`, `ping` 등의 명령어를 통해 `google.com` 접근 시 응답이 오는지 확인해보자.

![](https://velog.velcdn.com/images/yulmwu/post/832f510a-6f11-48af-8fc5-f53acb837366/image.png)

그럼 응답이 오지 않는데, NAT Instance에 대한 EC2 Source/Destination Check를 활성화 해두었기 때문이다.

![](https://velog.velcdn.com/images/yulmwu/post/7e61c5bd-f206-4d62-b451-c6254f83756a/image.png)

NAT Instance에서 해당 옵션을 비활성화 할 수 있다. (Terraform 옵션으로는 `source_dest_check = false`)

![](https://velog.velcdn.com/images/yulmwu/post/bdacbd26-0c53-49f0-8710-dac6df4151f2/image.png)

그리고 다시 Private EC2에서 인터넷과 통신을 해보자. 예시로 `curl -I https://google.com`을 실행해보았다.

![](https://velog.velcdn.com/images/yulmwu/post/99d48b0b-cbb4-4bbd-8271-745176804ecf/image.png)

또한 NAT Instance에서 아래와 같이 tcpdump 로그가 찍히는 것을 확인해볼 수 있다. 만약 다시 EC2 Source/Destination Check를 활상화한다면 Private EC2와 외부의 통신이 불가능할 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/7f3136fa-44f9-4571-bda3-fbd72142d326/image.png)

마지막으로 Private EC2에서 `curl https://checkip.amazonaws.com`을 입력하여 퍼블릭 IP가 무엇인지 확인해보자.

![](https://velog.velcdn.com/images/yulmwu/post/6942e8e3-03a5-4f8c-8549-87f0c22399b3/image.png)

위 `43.202.68.94` 퍼블릭 IP는 NAT Instance의 퍼블릭 IP와 동일한 것을 확인해볼 수 있을 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/45e9f8af-d5ac-4144-810d-d467a31abb2f/image.png)

이렇게 직접 NAT Instance를 프로비저닝하는 것은 추천되지 않고, NAT Gateway를 사용하는 것을 추천한다. 여기선 EC2 Source/Destination Check 기능에 대한 실습 목적으로 진행한 것이다.
