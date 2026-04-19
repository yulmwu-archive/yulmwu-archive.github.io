---
title: "[Cloudflare] Configuring SSH via Cloudflare Tunnel and WARP (Zero Trust)"
description: "Cloudflare ZeroTrust : Tunnel 및 WARP을 통한 SSH 서버/클라이언트 구성하기"
slug: "2026-04-15-cloudflare-zero-trust-ssh"
author: yulmwu
date: 2026-04-15T00:09:24.636Z
updated_at: 2026-04-19T11:14:36.781Z
categories: ["Cloudflare"]
tags: ["Cloudflare"]
series:
  name: Cloudflare
  slug: cloudflare
thumbnail: https://mirror-cdn.swua.kr/thumbnails/cloudflare/cloudflare-zero-trust-ssh_960x540.png
linked_posts:
  previous: 2026-04-15-cloudflare-ddos-protection
  next: 
is_private: false
---

# 0. Overview

최근 집에 굴러다니는 데스크탑에서 윈도우를 날리고 우분투를 설치했었다. 데스크탑을 안쓴지 2년이 넘은 듯 싶은데, 여태 데스크탑 대신 맥북을 클램쉘 모드로 쓰다가 x86-64의 정이 그리워 다시 꺼내들었다.

데스크탑을 들고 다닐 순 없고, 이걸 학교에 가져가서 배치시켜 두는 것 또한 문제가 있어 SSH 서버를 구성했다. 이때 문제가 이를 어떻게 외부에서 접근할 것인가인데, 그 방법으로 필자는 Cloudflare Zero Trust 및 Tunnel을 적극 활용해보기로 하였다. Tunnel에 대해선 아래의 포스팅을 참고해보면 좋을 듯 싶다.

- 2025.11.25 - [[Cloudflare] Expose local servers to the internet with Cloudflare Tunnel
](https://articles.swua.kr/cloudflare/2025-11-25-cloudflare-tunnel)

Cloudflare Zero Trust(One) 관련 서비스엔 ZTNA(Zero Trust Network Access) 뿐만 아니라 SWG(Secure Web Gateway), Tunnel, WARP, OIDC 등의 다양한 기능과 서비스를 제공한다. 

하지만 이 포스팅에선 간단하게 서버측에 Tunnel을 구성하고, ZTNA를 통해 Private Route/WARP 디바이스 등록과 클라이언트 측에서 WARP Zero Trust를 구성하여 내부 CIDR로 라우팅되도록 구성해볼 것이다.

> Zero Trust를 사용하지 않고 Hostname 기반의 구성이 가능하다. 
> 
> 예를 들어 `devssh.swua.kr`에 cloudflared 엑세스 포인트를 등록해주면 된다. 다만 이 경우 ProxyCommand(Bastion)가 필요하고, 권장되는 방식은 아니다. 

# 1. SSH Server — Tunnel Settings (cloudflared)

먼저 아래의 명령어로 Cloudflare 터널링 데몬(Agent)인 cloudflared를 설치한다. (SSH 서버 구성은 언급하지 않겠다.)

```shell
sudo apt update
sudo apt install -y cloudflared
```

다음으로 Cloudflare 로그인이 필요한데, 아래와 같이 CLI 명령어를 사용할 수 있다.

```shell
cloudflared tunnel login
```

이후 브라우저에서 도메인을 선택하고 인증한다.

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/1f19db02-6f05-4f4c-a1b3-a216dd60a2ac.png)

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/0ca873f4-d193-4a29-ba79-392400a552f0.png)

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/0952ece2-8a10-4ee6-a2e4-a6ad30b8926b.png)

이제 다음 명령어를 통해 Tunnel을 생성한다. 이는 웹 UI에서 생성해도 무방하지만, 편의를 위해 CLI를 사용하겠다.

```shell
cloudflared tunnel create devssh
```

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/c11eff9e-60e1-4374-8536-44ce24a4c296.png)

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/e43d35f9-9773-441d-acaa-3a8d0a80a578.png)

생성이 잘 되었다면 보통 `~/.cloudflared/<UUID>.json` 위치에 Credentials 파일이 생성되었을 것이다. Inactive가 뜨는 것은 아직 라우팅 설정과 IP 지정을 해주지 않았기 때문이다.

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/4822e8af-691f-4b55-ab0c-d334573efba2.png)

이와 같이 생성이 확인되었다면 cloudflared 구성이 필요하다. 환경에 따라 다를 수 있지만, 필자의 경우 `/etc/cloudflared/config.yaml` 위치에 구성 파일을 작성하겠다. `credentials-file`는 앞선 인증 정보가 담긴 파일의 절대 경로를 붙여넣으면 된다.

```yaml
tunnel: devssh
credentials-file: /home/user/.cloudflared/<UUID>.json

warp-routing:
  enabled: true

ingress:
  - service: ssh://localhost:22
```

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/6f59ecd8-8fe3-4cbf-8e63-f92746f13906.png)

이때 오로지 프라이빗 네트워크(ZTNA)로만 등록할 예정이기 때문에 `hostname` 및 `http_status` 등의 구성은 추가하지 않았다. ZTNA 네트워크 CIDR을 다르게 하려면 `routes`도 변경해주면 된다.

구성 파일을 저장하였다면 아래의 명령어를 통해 활성화할 수 있다.

```shell
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl restart cloudflared
```

마지막으로 현재 SSH는 localhost로 동작중이라 WARP에서 접근할 주소가 없는데, 이를 위해 루프백 주소를 하나 만들어주겠다.

```shell
sudo ip addr add 10.10.0.1/24 dev lo
```

## Netplan Configuration

하지만 위 `ip` 명령어는 휘발성 명령어라 컴퓨터가 다시 시작될 경우 초기화된다. 때문에 크게 두가지 방법이 있는데, 각각 아래와 같다.

1. Netplan 사용하기 (루프백 설정 등록)
2. Systemd 사용하기 (위 `ip` 명령어를 실행하는 서비스 등록)

필자의 경우 Netplan을 사용하겠다. 필자가 사용하는 Ubuntu 24.04 기준, 일반적으로 `/etc/netplan/` 위치에 YAML 구성 파일들을 위치시키면 된다.

```yaml
# /etc/netplan/90-loopback.yaml

network:
  version: 2
  ethernets: null
    lo:
      renderer: networkd
      addresses:
        # 필자의 경우 아래와 같이 로컬 루프백 주소를 명시해뒀지만, 직접 명시하지 않아도 시스템 기본값이라 자동으로 할당될 것이다.
        # - 127.0.0.1/8  - IPv4 루프백 주소
        # - ::1/128      - IPv6 루프백 주소
        - 10.10.0.1/32
```

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/65ac53cf-8bfc-46ad-87c6-d6fa790703a3.png)

적용 방법은 아래와 같다. 

```shell
sudo chmod -R 600 /etc/netplan
sudo netplan generate
sudo netplan apply
```

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/9687bcf6-7aeb-48b6-8aab-6afbd82250b0.png)

# 2. Clouflare — ZTNA Settings

ZTNA(Zero Trust Network Access)는 Zero Trust를 구현하는 기술 중 하나로, 명시적인 인증과 최소 권한을 통해 네트워크/애플리케이션에 안전하게 접근할 수 있도록 하는 기술이다.

Cloudflare Zero Trust(= One)에선 프라이빗 네트워크를 구성하고 라우팅되도록 할 수 있고, 이를 WARP(Zero Trust)으로 접근할 수 있는 솔루션을 제공한다. 

이를 구성하기 전, Zero Trust(= One) 대시보드에 접속하여 Team을 세팅해줘야 한다. 필자의 경우 무료 플랜을 사용해도 전혀 문제가 없으므로 무료 플랜을 사용하였다.

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/afa8c35a-4c27-4bc0-956f-4d64ddbcc286.png)

이제 다음으로 Team > Resources/Devices로 들어가 WARP 디바이스를 등록해야 한다. 여기서 WARP 클라이언트를 사용할 디바이스 종류와 접근 정책(기본적으로 이메일로 제한 가능) 등을 구성한다.

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/9c2741dd-3bde-4915-b740-a20a5e216117.png)

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/dd518b6f-fcbf-4d60-9cb2-ccd55302832d.png)

Service Mode는 Both Traffic and DNS를 선택하면 된다. 

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/4cb9119f-71e0-4bbc-a2f3-c18babd829ef.png)

이제 Split Tunnel 설정시 적용되는 라우팅을 구성하는데, Exclude Mode와 Include Mode 2가지가 있다. 전자는 모든 트래픽을 Cloudflare를 거치도록 하되 특정 트래픽만 제외하는 옵션이고, 후자는 특정 트래픽만 Cloudflare로 보내도록 하는 옵션이다. 필자는 편의상 전자를 선택하겠다.

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/7026be2b-1678-407b-95d0-9e8701ad1748.png)

Include Mode 선택시 아래와 같이 해당 트래픽의 CIDR을 입력해주면 된다.

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/e9bc0327-2bb1-4ead-ade6-11887b25bd9b.png)

다음으로 라우팅 구성을 해보겠다. 이를 통해 프라이빗 네트워크에서 Tunnel로 라우팅할 수 있다. Network > Routes 탭으로 들어가 생성하면 된다.

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/ea42b60d-5408-48e4-b69f-dd8b6b20d5e5.png)

CIDR은 아까와 같이 `10.10.0.0/24`, Tunnel도 아까 만들어둔 Tunnel을 선택하였다. 여기까지 문제가 없다면 아래와 같이 Healthy한 Tunnel의 모습을 볼 수 있다.

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/18515967-5909-4c24-af6b-374b4cc9234f.png)

# 3. Client — WARP Settings

마지막으로 Cloudflare 프라이빗 네트워크에 연결할 수 있도록 하는 WARP 클라이언트를 구성해보겠다. 기본적으로 1.1.1.1 WARP로 작동하지만, Preferences에서 Zero Trust를 활성화할 수 있다. 

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/451800d3-7930-4835-9e54-82c39b3b0414.png)

이를 위해 Account 탭으로 들어가 로그인을 한다. Team 이름엔 아까 설정한 Zero Trust (One) 팀 이름을 설정해두면 된다.

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/9d47bb70-9e96-46e8-8c6c-e7a28b3a0c6c.png)

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/432e0ab6-975f-40ae-80cf-475d59b3401a.png)

로그인에 성공했다면 아래와 같이 WARP 대신 Zero Trust 문구로 바뀐 것을 확인해볼 수 있다.

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/daa1c44f-1d29-4082-b0c1-f3dfb6b6d66f.png)

이제 아래와 같이 `10.10.0.1`로 SSH 접근이 가능할 것이다. 

![](https://mirror-cdn.swua.kr/images/cloudflare/2026-04-15-cloudflare-zero-trust-ssh/e80f79de-91d9-4fc5-9580-4eed7b52d734.png)

또한 Netplan을 통해 네트워킹 구성도 마쳤기 때문에 Ubuntu 서버를 재부팅해도 잘 동작할 것이다. Cloudflare를 사용하는 이유는 그 무엇보다 무료로도 충분히 서비스를 이용할 수 있다는 점일 것이다. 

필자는 데스크탑에 윈도우를 날리고 Ubuntu 데스크탑(GNOME)을 설치해서 사용하고 있어 GUI 앱을 실행하기엔 어려움이 있지만, SSH를 통해 CLI 명령어를 사용할 수 있는 것만으로도 장점이 워낙 커서 잘 사용하고 있다.