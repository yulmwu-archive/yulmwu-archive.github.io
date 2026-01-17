---
title: '[Cloudflare] DDoS protection with Cloudflare (Feat. AWS Shield)'
description: 'Cloudflare를 사용한 DDoS 방어 (Feat. AWS Shield)'
slug: '2025-12-21-cloudflare-ddos-protection'
author: yulmwu
date: 2025-12-21T12:04:19.600Z
updated_at: 2026-01-17T07:57:05.852Z
categories: ['Cloudflare']
tags: ['Cloudflare', 'aws', 'security']
series:
    name: Cloudflare
    slug: cloudflare
thumbnail: ../../thumbnails/cloudflare/cloudflare-ddos-protection.png
linked_posts:
    previous: 2025-12-21-cloudflare-tunnel
    next:
is_private: false
---

# 0. Overview

웹 서비스를 운영하면서 인프라를 효율적으로 구축하는 것도 중요하지만, 공격에 대해 대응하는 것도 매우 중요하다.

그러한 웹 해킹 공격엔 애플리케이션의 취약점을 악용하는 것도 있지만, 대량의 트래픽을 한번에 유발하게 하여 애플리케이션이나 네트워크를 마비시켜 정상적인 서비스 운영을 방해하는 **DDoS\***(분산 서비스 거부 공격)\*도 웹 해킹 공격에 해당된다.

> 단, DoS의 경우 공격자가 분산되어 있지 않기 때문에 비교적 쉽게 방어가 가능하고, [CVE-2024-47855](https://access.redhat.com/security/cve/cve-2024-47855)와 같이 애플리케이션 내부의 취약점으로 인해 발생되는 경우도 있기 때문에 이러한 점은 이 포스팅에서 다루지 않았다.

DDoS를 방어하기 위해선 여러 솔루션이 있겠지만, 크게 2가지의 솔루션이 있을 것이다.

1. 물리적인 장비(L3/L4 IDS/IPS 장비, L7 방화벽 등)를 사용한 DDoS 방어
2. **클라우드 기반의 DDoS 방어 서비스 사용** (L3/L4, 필요시 L7=WAF 등)

> ### L3/L4, L7 DDoS
>
> DDoS는 L3/L4의 경우 SYN Flood, UDP Flood와 같은 Volumetric 공격이, L7의 경우 리소스를 고갈시킬 수 있는 HTTP Flood, Slowloris와 같은 공격이 있을 수 있기 때문에 L3/L4 및 L7 모두 방어해야 한다.
>
> L3/L4에선 주로 트래픽의 Volume 임계치(PPS, BPS, CPS 등)를 기반으로 하여 DDoS를 방어하고, L7에선 Behavior(행위) 기반으로 분석하거나 Rate Limiting, Challenge 등을 걸어둔다.

> ### WAF(Web Application Firewall)
>
> L7에서 동작하는 공격 방어 시스템(솔루션) 중 대표적인 **웹 방화벽(WAF)**이 존재하는데, 이름 그대로 HTTP/HTTPS 트래픽에서 발생하는 공격을 막는다.
>
> 여기서 HTTP/HTTPS에서 발생하는 공격은 SQL 인젝션이나 XSS 등과 같은 공격이 맞다. 공격 패턴이나 행위를 보고 검사를 하는데, DDoS의 경우 대부분 네트워크의 근간인 L3/L4에서도 공격을 막아야 한다. (단, CSRF와 같은 공격은 주로 애플리케이션 레벨의 방어가 핵심이다.)
>
> WAF를 통해 L7 DDoS를 방어할 수 있지만 이는 방어 솔루션 중 하나이고, 앞서 설명한 Rate Limiting, Challenge 등이나 머신러닝/AI 기반의 Adaptive DDoS Protection 등을 사용하여 방어하기도 한다.

전자의 경우 물리적인 장비를 필요로 한다는 점으로 온프레미스의 단점을 그대로 가지고, 모든 종류의 대규모 DDoS 공격을 막기엔 어려움이 있다. 때문에 보통은 후자인 클라우드 기반의 DDoS 방어 서비스를 이용하는데, 그러한 서비스로 트래픽을 리버스 프록시 형태로 우회시켜 정상 트래픽만 전달 받는 방식을 사용한다.

클라우드 기반의 DDoS 방어 서비스에는 여러 서비스가 있으나, 대표적으로 **Cloudflare**, Akamai나 클라우드 벤더사인 AWS의 **AWS Shield** 등이 있다.

이 포스팅에서 실습할 내용으로 AWS Shield는 다루지 않고, Cloudflare를 통한 L7 DDoS 방어 방법 중 하나인 Rate Limiting을 적용해보고 Cloudflare의 Under Attack Mode를 실습해볼 것이다.

# 1. Cloudflare DDoS Protection

클라우드 기반의 DDoS 방어 서비스의 대명사인, 그리고 글로벌 CDN 서비스이기도 한 **Cloudflare**를 사용해볼 수 있는데, Cloudflare를 포함한 대부분의 클라우드 기반의 DDoS 방어 서비스는 아래와 같이 동작한다.

![](https://velog.velcdn.com/images/yulmwu/post/d18f94a9-a00a-4d64-8987-46708802fc19/image.png)

Cloudflare의 경우 전세계 여러 곳에 서비스를 운영하는데, 때문에 글로벌 CDN과 같은 것이 동작하기도 하고, 이렇게 각 위치에서 운영 중인 개별적인 Cloudflare 서버를 **엣지(Edge) 서버**라고 한다.

이 엣지 서버는 Cloudflare에서 제공되는 Anycast IP를 통해 접근할 수 있고, 도메인 레코드에 해당 IP를 등록하면 가장 가까운 위치의 가용할 수 있는 엣지 서버로 전송된다.

_(이러한 동작은 후술할 AWS도 비슷하게 있는데, AWS 백본망을 사용하는 많은 글로벌 서비스 중 CloudFront나 [Global Accelerator](https://velog.io/@yulmwu/aws-global-accelerator) 등이 이에 해당되며, AWS에선 엣지 로케이션이라 명칭한다.)_

![](https://velog.velcdn.com/images/yulmwu/post/c54d12cd-cc5b-46c4-9959-0f2758db0d8d/image.png)

_[출처: Cloudflare | Global Network](https://www.cloudflare.com/network/)_

이렇게 리버스 프록시 형태로 Cloudflare 엣지 서버를 거치면서 CDN을 가능케하기도 하고, 이 엣지 서버에서 이번 포스팅의 주제인 DDoS 방어 및 WAF 등이 동작한다.

Origin 서버를 어떻게 두느냐에 따라 다르겠지만, 보통은 클라이언트가 직접 Origin 서버에 접근할 수 없다.
_(여기서 Origin 서버는 온프레미스가 될 수도 있고, 클라우드의 로드밸런서 등일 수 있다. Origin 서버를 어떻게 두느냐는 이 포스팅에서 자세히 다루진 않겠다.)_

![](https://velog.velcdn.com/images/yulmwu/post/19b505c5-e14e-47e8-bb2a-32c2b8cc953b/image.png)

Cloudflare 엣지 서버에선 기본적으로 L3/L4 DDoS 공격을 방어한다. 이는 기본적으로 적용되어 있고, DDoS 방어가 트리거되는 임계값은 상대적(평균 트래픽 대비 이상치 등)으로 결정된다. _(세부적인 조정이 가능한 Magic Transit 등의 서비스는 엔터프라이즈 플랜에서만 제공한다.)_

대신 이는 L3/L4에서 발생할 수 있는 DDoS Flood 기준이고, L7의 경우 **WAF**나 **Rate Limiting**, **Challenge**, **Adaptive DDoS Protection**(L3/L4, L7) 등을 직접 구성할 수 있다. 이 포스팅에선 Rate Limiting을 구성하고 L7 DDoS(HTTP Flood 등)를 방어하는 것을 실습해보겠다. _(물론 무료 플랜에서 제공하는 IP 기반의 Rate Limiting이기 때문에 분산된 대규모 DDoS 방어에는 한계가 있다.)_

> DDoS 실습의 경우 법적으로 문제가 될 수 있음을 명심해야 한다. 아무리 실습용 Origin 서버라 해도 Cloudflare의 ToS와 ISP 정책 등의 법적 문제가 발생할 수 있기 때문이다.
>
> 때문에 그 임계값을 낮춰서 PoC(개념 증명) 정도의 테스트를 권장하며, Cloudflare를 비롯한 AWS Shield 등의 대부분의 L3/L4 DDoS 방어 시스템은 이 임계값을 직접 조정할 수 없으므로 L7에서 Rate Limiting 등을 실습하는 것으로 타협하겠다.

## 1-1. Adaptive DDoS Protection

하지만 위와 같이 정적으로 WAF Rule이나 Rate Limiting 등을 설정해두면 우회 방법이 나타날 수도 있고, Challenge의 경우 유저의 UX를 떨어트릴 수 있다.

요즘 기업에서 DDoS를 방어하는 추세는 머신러닝/AI 기반의 실시간으로 트래픽을 분석하여 학습하고, 공격 패턴을 감지하고 완화하는 **Adaptive DDoS Protection** 기술을 사용한다.
_(DDoS를 완벽하게 방어 할 기술은 현재로썬 존재하지 않기 때문에 "완화한다" 라는 표현을 사용한다.)_

Cloudflare에서도 엔터프라이즈 등급에서 L3/L4 및 L7 트래픽을 모두 방어할 수 있는 Adaptive DDoS Protection를 제공한다.

## 1-2. Cloudflare Under Attack Mode

상시로 활성화 해두는 L3/L4 DDoS 방어(기본)와 WAF/Rate Limiting/Challenge 등을 통한 L7 DDoS 방어, Adaptive DDoS Protection 등 외에도 Cloudflare에선 **Under Attack Mode(UAM)**을 지원한다.

이는 이름 그대로*(Under Attack)* DDoS 공격을 받고 있을 때 수동으로 활성화할 수 있는 기능이다. 이를 활성화하면 모든 L7 HTTP/HTTPS 요청에 대해 JS Challenge를 강제하고, 정상적인 사용자의 브라우저만 필터링한다.

> JS Challenge는 브라우저에서만 JavaScript 엔진을 사용할 수 있다는 것을 이용한 Challenge로, JavaScript 실행 가능 여부나 쿠키 설정 가능 여부 등을 체크한다.

다만 이는 일부 API나 모바일 앱의 트래픽을 차단할 수 있고, SEO를 위한 크롤러에게 영향을 주거나 (요즘에는 거의 없다만) JavaScript 엔진을 지원하지 않는 클라이언트의 경우 문제가 생길 수 있다. 때문에 이는 비상용으로 단기간 사용하는 기능이라고 생각하면 될 것이다.

이 포스팅에서 Under Attack Mode도 간단하게 실습해보도록 하겠다.

# 2. AWS Shield DDoS Protection

> 이 포스팅에선 Cloudflare을 통한 L7 DDoS 방어를 중점으로 다루고, AWS Shield 및 AWS WAF에 대한 실습은 다루지 않겠다.
>
> 그럼에도 AWS의 Shield와 WAF에 대한 이론을 다룬 이유는 Cloudflare 뿐만 아니라 AWS에서도 DDoS 방어 서비스를 제공한다는 점을 강조하고 싶었기 때문이다.

클라우드 네이티브 인프라를 구성하면서 대표적인, 그리고 가장 많이 사용되는 클라우드 벤더가 AWS이다. 이러한 AWS에서도 Cloudflare와 비슷한 동작의 DDoS 방어 시스템(솔루션)을 제공하는데, 크게 **AWS Shield**와 **AWS WAF**로 구성된다. 눈치가 좋다면 알 수 있겠지만 Shield는 L3/L4, WAF는 L7 트래픽을 담당하는 것이다. (Shield Standard 기준)

대신 **Shield**는 **Standard**와 **Advanced** 요금제를 제공하는데, 전자의 경우 백본망을 사용하는 AWS 글로벌 서비스(CloudFront, Route 53 등)와 리전 레벨의 서비스에선 ELB 및 EIP에서 기본적으로 적용된다.

글로벌 서비스인 CloudFront와 Route 53 DNS 등은 각 엣지 로케이션에서 동작하기 때문에 Cloudflare와 비슷하게 동작한다.

![](https://velog.velcdn.com/images/yulmwu/post/8140a7bd-26f9-422d-9064-4dd01d45ae1f/image.png)

리전 서비스인 ELB(ALB, NLB) 및 EIP도 Shield Standard가 적용되는데, 엣지 로케이션 레벨에서 Shield + WAF로 방어하는 것이 ELB에 대해 보안상 더 유리할 수 있기 때문에 CloudFront를 CDN 서비스 뿐만 아니라 엣지 레벨에서 보호하는 수단으로도 자주 사용된다. (ELB까지 오기 전에 방어하는 최전방 부대라 생각하면 편하다.)

Shield의 경우 무료인 Standard 요금제와 **Advanced** 요금제로 나뉘는데, Advanced의 경우 대규모의 L3/L4 및 L7 DDoS 공격을 방어한다.

Shield Standard에는 DDoS 공격에 대한 세부적인 Observability를 제공하지 않는 반면, Advanced는 공격 감지/유형/지속 시간 등을 실시간으로 제공하고 DRT(DDoS Response Team)을 지원하여 24시간 365일 AWS 보안팀의 지원을 받을 수 있다.
_(추가적으로 Shield Advanced가 완화하지 못한 DDoS 공격에 대한 초과 비용을 환급해줄 수도 있다고는 하는데, 필자가 직접 사용해보진 못해서 잘 모른다는 점 양해 부탁드린다.)_

![](https://velog.velcdn.com/images/yulmwu/post/ea669600-cebf-45b1-b97e-75ae77a472d0/image.png)

다만 Shield Advanced의 경우 월 3,000달러 부터 시작하기 때문에 엔터프라이즈 급이 아닌 개인이나 작은 팀에서 사용하기엔 어려움이 있다.

# 3. L7 DDoS(DoS) Protection Demo

실습은 간단하게 Rate Limiting을 구성하고, 실제 운영 환경보다 임계값을 낮춰 PoC(개념 증명) 형태로만 간단히 테스트해볼 것이다. 이에 대한 Best Practices는 아래의 공식 문서에서 확인해볼 수 있고, Expression에 대해 자세히 다루지는 않을 것이다.

https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices

> 앞서 말했 듯 실제 DDoS를 실습하는 것은 법적으로 문제가 될 수 있고, Cloudflare의 무료 플랜에서 진행하는 실습 상 Rate Limiting을 구성하는 것을 중점으로 둘 것이다. 무료 플랜에서도 제한적으로 IP 기반의 Rate Limiting을 구성해볼 수 있다.
>
> 하지만 실제 운영 환경에선 봇넷 등을 통해 분산된 DDoS의 경우 IP 당 Rate Limiting을 두는 것은 비교적 효과가 없을 수 있다.
>
> 이를 위해 API Key/쿠키/세션/ASN 등과 같은 값으로 그룹핑 할 수 있는 Advanced Rate Limiting을 유료로 제공하고, 같은 엔터프라이즈 플랜의 Adaptive DDoS Protection을 사용할 수도 있다.
>
> DDoS 방어의 목적 보단 봇/크롤러 판별을 위해서라면 Managed Challenge나 Turnstile 등을 도입해볼 수 있다.

Cloudflare를 실습하기 위해선 도메인을 가지고 있는 것이 편리하다. 필자는 가비아에서 테스트용도로 구매해둔 도메인이 있기 때문에 초반에선 가비아를 기준으로 설명하겠다. DNS 서버 설정의 경우 대부분의 도메인 제공 업체에서 비슷한 UI로 제공한다.

![](https://velog.velcdn.com/images/yulmwu/post/4d6a5112-8c41-49e2-a050-a7075ab23e47/image.png)

플랜의 경우 무료 플랜으로도 이 실습을 진행할 수 있다.

_(필자가 취미로 있는 팀에선 프로 플랜을 사용하고 있어 계정을 빌려 Cloudflare OWASP CRS를 포함하는 WAF까지 실습해보려 했으나 실패하였다.)_

![](https://velog.velcdn.com/images/yulmwu/post/e0b337e3-11e8-45fe-a1b0-c337c2b966bf/image.png)

다음으로 DNS 네임 서버를 설정해야 하는데, 도메인을 등록하고 나면 아래와 같이 네임 서버를 제공해준다. 도메인 설정에서 이 네임 서버로 바꿔주면 된다.

![](https://velog.velcdn.com/images/yulmwu/post/adc0154d-8cfb-4808-8a04-af3e73953aa6/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/df2794a7-bb84-4124-955a-060dd66dd669/image.png)

수정 후 캐싱 때문에 적용되기 까지의 시간이 오래 걸릴 수 있다. 필자의 경우 하루 정도 여유롭게 기다렸다. 아래와 같이 Cloudflare DNS 서버와 Recursive Resolver 서버(1.1.1.1)가 설정되는지 확인한다.

```shell
> dig rlawnsdud.shop

; <<>> DiG 9.10.6 <<>> rlawnsdud.shop
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 57171
;; flags: qr rd ra; QUERY: 1, ANSWER: 0, AUTHORITY: 1, ADDITIONAL: 1

;; OPT PSEUDOSECTION:
; EDNS: version: 0, flags:; udp: 1232
;; QUESTION SECTION:
;rlawnsdud.shop.			IN	A

;; AUTHORITY SECTION:
rlawnsdud.shop.		1800	IN	SOA	matias.ns.cloudflare.com. dns.cloudflare.com. 2391907498 10000 2400 604800 1800

;; Query time: 73 msec
;; SERVER: 1.1.1.1#53(1.1.1.1)
;; WHEN: Tue Dec 23 15:29:41 KST 2025
;; MSG SIZE  rcvd: 107
```

![](https://velog.velcdn.com/images/yulmwu/post/f46af3da-571a-4520-8978-d1721e2479f5/image.png)

Cloudflare DNS 서버로 설정을 하였다면 Origin 서버의 레코드를 만들어줘야한다. 이는 DNS 레코드 설정에서 확인해볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/0a7a34c1-1968-4a04-a1d8-cae1b86c3fe5/image.png)

> Origin 서버는 필자의 경우 간단히 AWS EC2를 프로비저닝하고 Nginx를 올린 뒤 EIP를 적용하였다.
> 실제 운영 환경에선 ELB나 CloudFront 등의 서비스를 앞단에 붙이는 것이 좋고, 보안 그룹에서 [Cloudflare IP 대역](https://www.cloudflare.com/ko-kr/ips/)만 허용하는 등의 방법을 사용하자.
>
> Nginx 구성은 아래와 같다. (Nginx에서도 Rate Limiting을 구성할 수 있다. 단, 프록시*(Cloudflare 엣지)* 레벨에서 Rate Limiting을 적용하는 것이 핵심이다.)
>
> ```shell
> # /etc/nginx/nginx.conf
>
> user www-data;
> worker_processes auto;
>
> events {
>     worker_connections 1024;
> }
>
> http {
>     include       mime.types;
>     default_type  application/json;
>
>     log_format cf_access '$remote_addr - $host [$time_local] '
>                          '"$request" $status '
>                          'cf_ray=$http_cf_ray '
>                          'cf_ip=$http_cf_connecting_ip '
>                          'ua="$http_user_agent"';
>
>     access_log /var/log/nginx/access.log cf_access;
>     error_log  /var/log/nginx/error.log warn;
>
>     sendfile        on;
>     keepalive_timeout 65;
>
>     include /etc/nginx/conf.d/*.conf;
> }
> ```
>
> ```shell
> # /etc/nginx/conf.d/default.conf
>
> server {
>     listen 443 ssl http2;
>     server_name _;
>
>     ssl_certificate     /etc/nginx/certs/cf_origin.pem;
>     ssl_certificate_key /etc/nginx/certs/cf_origin.key;
>     ssl_protocols TLSv1.2 TLSv1.3;
>     ssl_prefer_server_ciphers off;
>
>     real_ip_header CF-Connecting-IP;
>
>     location / {
>         return 200 "OK\n";
>     }
>
>     location /api/test {
>         return 200 "API OK\n";
>     }
>
>     location /health {
>         access_log off;
>         return 200 "Healthy\n";
>     }
> }
> ```
>
> Cloudflare Proxied를 사용할 경우 HTTPS(SSL/TLS 인증서)를 기본으로 사용한다. 때문에 SSL/TLS > Full (strict) 모드 변경 후 Origin Server에 대한 SSL/TLS 인증서를 발급받고 Nginx에서 사용해야 한다.
>
> ![](https://velog.velcdn.com/images/yulmwu/post/fdd3e707-b995-4b87-aa96-18a3f6240134/image.png)
>
> ```shell
> # Ubuntu 기준
>
> sudo apt update
> sudo apt install -y nginx
>
> # SSL/TLS 인증서 추가
> sudo mkdir -p /etc/nginx/certs
> sudo nano /etc/nginx/certs/cf_origin.pem
> sudo nano /etc/nginx/certs/cf_origin.key
> sudo chmod 600 /etc/nginx/certs/*
>
> # 구성파일 작성 후
> sudo nginx -t
> sudo systemctl restart nginx
>
> ```
>
> ![](https://velog.velcdn.com/images/yulmwu/post/e6271edd-54ef-4bba-9910-daf12373be59/image.png)
>
> ![](https://velog.velcdn.com/images/yulmwu/post/70804b17-802f-4830-8c61-d4b4dfbd474d/image.png)

아래와 같이 EIP(또는 EC2)의 Public IP를 A 레코드로 등록해주고, Proxied 상태로 만든다. (그래야 엣지 서버를 프록시하여 Rate Limiting 및 WAF, UAM 등이 적용된다.)

![](https://velog.velcdn.com/images/yulmwu/post/8033be74-5d96-4ef9-b509-1dabb234fe1d/image.png)

마찬가지로 DNS 레코드가 적용될 때 까지 기다려주고, 적용이 되었다면 브라우저에서 접속 후 Nginx의 엑세스 로그를 확인해보자.

```
172.64.217.215 - rlawnsdud.shop [23/Dec/2025:07:28:57 +0000] "GET / HTTP/2.0" 200 cf_ray=9b2625242d4b53cb-LAX cf_ip=59.10.251.237 ua="curl/8.7.1"
```

그럼 위와 같이 Cloudflare Ray ID와 HTTP_CF_CONNECTING_IP 헤더를 확인해볼 수 있다. 이제 Cloudflare에서 Rate Limiting과 Under Attack Mode(UAM)을 적용해보도록 하겠다.

## 3-1. Rate Limiting

Cloudflare 웹 UI에서 Security > Security Rules에 접속해보면 아래와 같이 Custom Rules와 Rate Limiting Rules 및 Pro 플랜에서 사용할 수 있는 Managed Rules를 확인해볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/44f3b56d-7f97-49d9-b39c-177e01a9bda4/image.png)

Create Rule > Rate Limiting Rule을 선택하고 아래와 같이 구성하자. Expression Builder를 사용해도 되지만 [RuleSet 엔진의 표현식(Expression)](https://developers.cloudflare.com/ruleset-engine/rules-language/expressions/)을 직접 작성해도 된다.

![](https://velog.velcdn.com/images/yulmwu/post/8985d090-ae56-48cc-8a0f-cf4b81f6ecc5/image.png)

```shell
http.host eq "rlawnsdud.shop" and
starts_with(http.request.uri.path, "/api/") and
http.request.method eq "GET"
```

무료 플랜에선 아래와 같이 IP Based로 제한된다.

![](https://velog.velcdn.com/images/yulmwu/post/cdffc6b6-2b9a-4d42-9636-497b6f4e1e36/image.png)

마지막으로 PoC를 위해 10초 동안 5개의 요청을 임계값으로 지정하였고, 10초 동안 차단(Block) 한다는 정책으로 설정하였다. (더욱 세부적인 조정은 엔터프라이즈 플랜 이상에서 가능하다.)

![](https://velog.velcdn.com/images/yulmwu/post/4552e60f-037d-4952-aa04-8327d0a7b5a5/image.png)

적용 후 아래와 같이 확인할 수 있다. 테스트로 셸 스크립트에서 루프를 돌려도 되지만, 10초 내에 브라우저에서 `/api/*` 경로에 대해 새로고침을 5번 이상 하면 Block 되는 모습을 확인해볼 수 있을 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/c40cae34-cea9-4d18-ae5f-a4b1ba2bbf81/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/5a00c82a-f49b-4ac9-b085-156f1a3a4b74/image.png)

```shell
> curl -i https://rlawnsdud.shop/api/test

HTTP/2 429
date: Tue, 23 Dec 2025 07:55:11 GMT
content-type: text/plain; charset=UTF-8
content-length: 16
retry-after: 9
cache-control: private, max-age=0, no-store, no-cache, must-revalidate, post-check=0, pre-check=0
expires: Thu, 01 Jan 1970 00:00:01 GMT
referrer-policy: same-origin
x-frame-options: SAMEORIGIN
report-to: {"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=ZBQc9MZoyd31RI0GEZYZNZShv7Y3M28PfLRAS2ujjzoLmj84XucipGl6vBKUL%2FjhG%2B4hcIkonhb0cvqpAXopOnIX%2FR9pCIq5se8bkyLQ"}]}
nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
server: cloudflare
cf-ray: 9b264b956d7751ae-LAX
alt-svc: h3=":443"; ma=86400

error code: 1015%
```

또한 Cloudflare의 Analytics에서도 아래와 같이 Block 여부 및 요청 수 등을 모니터링 해볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/20bc8b18-d904-4738-9fe2-e54da7ab759b/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/2bdaf096-96a7-43a0-8f3d-cb718948bcbe/image.png)

## 3-2. Under Attack Mode

다음으로 Cloudflare Under Attack Mode(UAM)을 실습해보겠다. 활성화 방법은 어렵지 않다. 대시보드 오른쪽 사이드바에서 "Under Attack Mode"를 활성화 해주면 된다.

![](https://velog.velcdn.com/images/yulmwu/post/e432f66e-848e-4e67-84fe-8860748cfd3c/image.png)

활성화를 경고창을 띄우는데, 대충 최후의 수단으로 쓰라는 뜻이다. Enable을 클릭하여 활성화해보자.

![](https://velog.velcdn.com/images/yulmwu/post/b14b6209-7e7e-478e-875e-b62797387a64/image.png)

그럼 접속 시 아래와 같이 JS Challenge가 실행되는 모습을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/4f81b7cb-da08-4d55-8719-9634e4c7b8aa/image.png)

JS Challenge를 통과했을 경우 `cf_clearance` 라는 쿠키가 생기는데, 그 쿠키 또한 확인해볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/e541fce1-b8cc-4e03-832b-6872093400c5/image.png)

만약 curl 등으로 접속 시 403 Forbidden이 먼저 발생하는 것을 확인해볼 수 있다. 물론 이를 우회하는 방법이 계속해서 나오고 있긴 한데, 이를 굳이 우회해야 하는 이유를 잘 생각해보길 바란다.

Under Attack Mode는 손쉽게 다시 끌 수 있고, 언제든지 활성화해볼 수 있다. 이상으로 포스팅을 마치겠다.
