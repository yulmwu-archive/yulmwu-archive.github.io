---
title: '[Cloudflare] Expose local servers to the internet with Cloudflare Tunnel'
description: 'Cloudflare Tunnel을 통한 포트 포워딩이나 Public IP 없이 로컬 서버 인터넷에 노출시키기'
slug: '2025-11-25-cloudflare-tunnel'
author: yulmwu
date: 2025-11-25T12:54:10.291Z
updated_at: 2026-01-22T06:36:39.399Z
categories: ['Cloudflare']
tags: ['Cloudflare']
series:
    name: Cloudflare
    slug: cloudflare
thumbnail: ../../thumbnails/cloudflare/cloudflare-tunnel.png
linked_posts:
    previous:
    next: 2025-11-25-cloudflare-ddos-protection
is_private: false
---

# 0. Overview

필자가 라즈베리파이를 통해 서버를 구축해야 할 일이 있었다.

가용성이 중요하지 않고 트래픽이 유동이지 않고 개인적으로 사용할 서버였기 때문에 집에서 라즈베리파이를 통해 서버를 구축하려고 했었다.

외부에서 Public IP로 접근하기 위해선 포트포워딩을 해야 했었는데, 아래와 같은 조건을 만족했어야 했다.

- CGNAT 환경(ISP가 하나의 Public IP를 받고 여러 사용자(공유기)에게 Private IP를 할당함, 100.64.0.0/10 대역)이 아님
- ISP나 스위치/허브(공유기) 자체적으로 포트 포워딩을 지원함
- 등등..

다행히 필자의 집엔 포트포워딩이 되는 환경이였는데, 몇 가지 문제가 있었다.

일단 동적 IP(DHCP)를 사용하기 때문에 Public IP가 자주 바뀌고, 집 공유기가 오래된 모델인지라 자주 뻗는다. 그리고 집 Public IP가 직접 노출되기 때문에 보안상 문제가 될 수 있었다.

서론이 길었는데, 그래서 필자는 **Cloudflare Tunnel** 서비스를 이용해보기로 했다.

# 1. What is Cloudflare Tunnel?

Cloudflare에서 제공하는 Tunnel 서비스는 내부 네트워크의 서버를 외부에 직접 노출하지 않고 Cloudflare에서 제공하는 연결을 통해 외부에서 접근 가능한 도메인을 만들어주는 서비스이다.

즉 서버의 아웃바운드를 Cloudflare Tunnel에 연결하여 인터넷 노출을 Cloudflare로 대신한다.

![](https://velog.velcdn.com/images/yulmwu/post/73d2402f-e342-4af1-a78e-e3bd8d23deb4/image.png)

얼핏 보기엔 리버스 프록시처럼 보일 수 있으나 리버스 프록시와는 목적과 동작 과정이 다르다.

Cloudflare Tunnel은 서버에 cloudflared라는 데몬 프로세스를 실행시키고, Cloudflare를 통해 들어온 트래픽만 cloudflared가 받아서 서버(로컬 서비스)에 전달하며, 서버에서 다시 cloudflared로 응답을 보내 Cloudflare Tunnel을 통해 외부 사용자에게 전달한다. (cloudflared 연결 유지는 WebSocket 기반)

Cloudflare에서 들어온 요청/응답만 cloudflared를 통해 전달되기 때문에 그 외의 아웃바운드 트래픽은 기존의 NAT Gateway 등으로 보내진다.

---

실제 사용에 있어 Zero Trust Access를 통해 인증된 사용자만 내부 서버에 접근하도록 하거나 여기에 Warp까지 추가하여 Cloudflare 기반의 보안망을 구축할 수 도 있다.

본 포스팅에선 단순히 cloudflared를 설치하여 Public IP가 없거나 포트포워딩이 안되는 환경에서 인터넷 노출이 가능하도록 실습해보겠다.

# 2. Example — Private Server

교내에서 글을 쓰는 필자의 라즈베리파이가 집에 있어 당장 가져올 수 없기 때문에 AWS에서 Private Subnet의 EC2를 하나 만들고, Public IP를 할당하지 않고 NAT Gateway를 추가하여 인터넷 노출이 불가능한 환경을 만들어 보겠다.

이후 간단한 서버를 localhost로 올리고 cloudflared를 설치하여 Tunnel을 통해 인터넷 노출이 가능하도록 해보겠다. 즉 이에 대한 다이어그램은 아래와 같다.

![](https://velog.velcdn.com/images/yulmwu/post/a47a3dd2-844e-4936-a7b4-3d92bd9e05b4/image.png)

## 2-1. Cloudflare DNS

필자는 가비아에서 구매해둔 테스트용 도메인이 있기 때문에 그걸 사용하도록 하겠다.

![](https://velog.velcdn.com/images/yulmwu/post/41794fed-7c8b-4ce0-ba8c-79586bc0013d/image.png)

만약 도메인을 등록한적이 없다면 위와 같이 도메인을 등록하라고 안내한다. 구매한 도메인을 입력하하고 넘어가보면 아래와 같이 2개의 Cloudflare NS를 제공해주는 것을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/7d6b01a6-2e15-44d3-abd8-ac07ed101c1b/image.png)

이를 아래와 같이 NS를 수정하면 된다.

![](https://velog.velcdn.com/images/yulmwu/post/7a215a4c-4be5-4837-b235-8c88b45c723e/image.png)

수정 사항을 전파하는데 시간이 오래걸릴 수 있으니 기다리도록 하자. 등록이 완료되었다면 "Check nameservers now" 버튼을 클릭하여 등록이 됐는지 확인하자.

![](https://velog.velcdn.com/images/yulmwu/post/23dc8b58-2895-4ca9-b53f-af6948b7a4e5/image.png)

확인이 되었다면 위와 같은 화면이 나타난다. 필자는 1~2시간 정도 걸린 것 같다.

## 2-2. EC2 Instance

아래와 같이 Public Subnet에 NAT Gateway, Private Subnet에 EC2 인스턴스를 프로비저닝 하겠다.

![](https://velog.velcdn.com/images/yulmwu/post/977a9788-e99f-4264-8da3-6c872364c43d/image.png)

EC2 보안그룹에서 허용할 인바운드 규칙은 없다. 다만 아웃바운드에서 cloudflared 트래픽이 나갈 HTTPS는 열어둬야 하는데, 보안그룹 기본 값이 모든 아웃바운드 트래픽이 허용(`0.0.0.0/0`)되니 상관하지 않아도 된다.

Public IP와 IGW가 없으니 외부에서 SSH로 접근할 수 없는데, 필자는 [Bastion Host](https://velog.io/@yulmwu/ec2-bastion-host) EC2 인스턴스를 하나 만들어서 접속하도록 하였다.

![](https://velog.velcdn.com/images/yulmwu/post/368238d4-488e-444a-aeb4-bbd320ff174e/image.png)

그리고 Nginx를 설치하자.

```shell
> sudo apt-get update
> sudo apt-get install nginx
> curl -I http://localhost:80

HTTP/1.1 200 OK
Server: nginx/1.24.0 (Ubuntu)
Date: Wed, 26 Nov 2025 09:06:54 GMT
Content-Type: text/html
Content-Length: 615
Last-Modified: Wed, 26 Nov 2025 09:04:03 GMT
Connection: keep-alive
ETag: "6926c283-267"
Accept-Ranges: bytes
```

## 2-3. cloudflared

이제 Cloudflare Tunnel 데몬인 cloudflared를 설치해보자.

![](https://velog.velcdn.com/images/yulmwu/post/50df1b15-f0f1-40e4-8e96-fbf44dd424f1/image.png)

Cloudflare Zero Trust 탭에 들어가면 위와 같이 나타날 것이다. 여기서 왼쪽 사이드바에 Networks > Connectors로 들어간다.

![](https://velog.velcdn.com/images/yulmwu/post/b9b6ea47-465b-403d-bb1b-18bf9e0b04c8/image.png)

Create a tunnel을 클릭하자.

![](https://velog.velcdn.com/images/yulmwu/post/f18f835e-13a3-4290-9b61-e0eb1819ee1f/image.png)

Cloudflared를 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/3c78f3a7-2c7c-4d22-aee1-1705d9522f80/image.png)

이름을 입력하고 Save Tunnel을 클릭한다. 그러면 아래와 같이 설치 명령어가 나오는데, 아래에 인증 명령어까지 나오게 된다.

![](https://velog.velcdn.com/images/yulmwu/post/c136e701-13de-4d7f-bd12-fca714bfccf6/image.png)

_OS 및 아키텍처를 선택하라고 한다면 Linux/Debian 및 64-bit를 선택한다._

```shell
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg | sudo tee /usr/share/keyrings/cloudflare-public-v2.gpg >/dev/null

echo 'deb [signed-by=/usr/share/keyrings/cloudflare-public-v2.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list

sudo apt-get update && sudo apt-get install cloudflared
```

```shell
sudo cloudflared service install eyJhIjoiY2FkNDYxYzQ1YzY1M...
```

![](https://velog.velcdn.com/images/yulmwu/post/e68b88c3-4dd7-47cd-b2c8-27e5e098163d/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/9fe8854f-79cb-4d0d-9422-5cf872fedb3a/image.png)

그럼 위와 같이 Connectors에 추가된 것을 볼 수 있다. 그리고 연결할 Nginx 앱의 주소(`http://localhost:80`)와 연결한 도메인을 선택하자.

![](https://velog.velcdn.com/images/yulmwu/post/c2b00045-513c-47fb-9d31-bc8ce9247359/image.png)

그리고 Complete Setup을 클릭한다. 조금만 기다려보면 아래와 같이 Health 상태가 된 것을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/11065040-826d-479c-9e41-0de0c288653a/image.png)

그리고 필자 기준으로 `test.rlawnsdud.shop` 도메인으로 접속해보자.

![](https://velog.velcdn.com/images/yulmwu/post/408e111c-cc94-4a17-874d-4c112d2e3302/image.png)

그럼 사진과 같이 정상적으로 접속되는 것을 볼 수 있다. 앞서 말했 듯 여기에 Warp이나 AuthN 서비스(Zero Trust Access 등)를 연동해서 쓰는 것이 좋을 것이다.

이렇게 간단하게 사용할 경우 Cloudflare Tunnel 자체는 무료이다. 다만 Cloudflare에서 도메인을 구입하거나 다른 유료 서비스와 함께 사용한다면 요금이 부과될 수 있으니 그 부분에 대해선 따로 참고하시길 바란다.

만약 서버나 cloudflared가 정상적으로 동작하지 않는다면 아래와 같이 DOWN으로 표시되며 접속되지 않을 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/74791c62-aa3c-4865-bba0-eafe4668d81a/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/ff0c02d8-1edf-457d-ad22-2b16efc9a170/image.png)
