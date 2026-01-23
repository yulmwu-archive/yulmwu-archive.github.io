---
title: '[일상] 요금 환불 요청기'
description: 'Feat. 공중분해 될 뻔한 20달러 돌려받기'
slug: '2025-07-16-refund-aws'
author: yulmwu
date: 2025-07-16T01:06:24.694Z
updated_at: 2026-01-21T14:12:26.284Z
categories: ['Misc']
tags: ['aws', '일상']
series:
    name: Misc
    slug: misc
thumbnail: ../../thumbnails/misc/refund-aws.png
linked_posts:
    previous:
    next: 2025-07-16-how-to-use-draw-io
is_private: false
---

# 0. Overview

![](https://velog.velcdn.com/images/yulmwu/post/43bc04d1-a919-432a-ab5d-c61bf4debcae/image.png)

필자는 프리티어 계정을 사용하며 최대한 돈이 나가지 않도록 노력하고 있다.

프리티어 범위에 포함되지 않아 돈이 나가는 서비스는 어쩔 수 없이 그냥 사용하고 있는데, 교내에서 프로젝트를 진행하면서 AWS를 좀 오래 켜둘 일이 있었다.

마침 ECS Fargate를 사용하며 좋은 성적을 위해 고가용성 등의 요소를 곁들여서 제작하였다. 그 문제의 아키텍처가 아래와 같다.

![](https://velog.velcdn.com/images/yulmwu/post/bbfd6270-a0f5-4a00-8622-bc1fd8b7c733/image.png)

사실 ECS Fargate에 대한 요금은 어느정도 생각을 하고 있었다.
그런데 문제는 켜두지도 않은 EC2 요금이 나왔다는 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/8a290fc3-030d-4cbf-abb6-eb09f7af84fe/image.png)

범인은 NAT Gateway였다.

![](https://velog.velcdn.com/images/yulmwu/post/9413961f-8b7a-4d81-9c6f-fdab561e6e20/image.png)

왜 VPC 항목이 아닌 EC2에 포함되는건진 솔직히 잘 모르겠다만 아무튼 저것 때문에 요금의 절반이 청구된 것이다.

곰곰히 생각을 해보니 이러한 문제가 있었다.

- 각 VPC마다 2개의 프라이빗 서브넷을 가지고 있었고 둘 다 NAT Gateway를 붙여둠
- 테스트를 위해 그러한 VPC 여러개를 만들어두고 안지우고 있었다. (요금 나온거 보고 바로 지움)
- NAT Gateway가 프로비저닝된 상태에서 요금이 그정도로 비쌀 줄은 몰랐다. (시간당 0.059달러인데 이유는 모르겠으나 실행 시간이 총 170시간이나 됐었음)
- 이러한 상황에서 그나마 대체가 가능한 기능은 VPC 엔드포인트는 필자의 상황에선 사용하기가 어려웠다. (AWS 서비스 이외의 리소스에 접근해야할 일이 있었음)

그래서 일단 서비스는 해야하고, 돈이 아깝기도 해서 가용성이나 보안은 옆지 고양이한테 줘버리고 아래와 같이 바꿨다. (각 ECS 컨테이너에 Public IP 부여하는 식으로)

![](https://velog.velcdn.com/images/yulmwu/post/d7f033e3-760c-4235-9595-ba6c86b32483/image.png)

그리고 Fargate도 요금을 줄이기 위해 최소한의 성능과 스팟 요금으로 변경해뒀는데, 그것도 전엔 꽤나 높은 성능과 일반 요금, 그리고 오토스케일링까지 해둬서 그정도로 나오지 않았나 싶다.

Fargate는 프리티어가 아니란걸 알고 있었긴 했으니 여기에 대해서 따지지는 않았다.

# 1. Contact AWS Support Center

![](https://velog.velcdn.com/images/yulmwu/post/df8502b2-c542-47ea-a479-63be457cb3d4/image.png)

일단 지원센터에 들어가 사례를 생성하도록 하자.

![](https://velog.velcdn.com/images/yulmwu/post/7f929086-ee54-40af-a3fc-bb267c6908d5/image.png)

그리고 필자는 (살짝의 호들갑이 추가된) 글을 번역기로 돌려서 적었다.

![](https://velog.velcdn.com/images/yulmwu/post/f17850f9-72a9-4641-b73a-0f6a26e3bad6/image.png)

내용을 적어주고, 관련 이미지 2개도 첨부하였다.

![](https://velog.velcdn.com/images/yulmwu/post/e69dc713-fdfa-40cf-b48d-4a3bd555d025/image.png)

이제 답장을 기다려보겠다.

## First Reply

정확히 1시간 뒤 답장이 왔다. 그 내용엔 먼저 관련된 서비스들을 삭제하라는 내용였다.

![](https://velog.velcdn.com/images/yulmwu/post/30f791c5-31d5-4374-ac91-2dbda951001e/image.png)

DynamoDB의 경우 자료가 남아있어 지우긴 꺼려졌지만 지워달라니 대충 백업하고 지웠다. 나머지도 다 지웠고, 다음으로 더욱 세부적인 정보를 달라고 하였다.

![](https://velog.velcdn.com/images/yulmwu/post/7a89fa4a-735e-44b1-8a4e-c1859f35bd91/image.png)

항목에 맞게 내용을 작성해서 답장하였다. 먼저 느낀것은 미국 업체 답지 않게 답변이 빨랐다는 것과(한국 시간대인데도) 싸가지 없는 답장이 아니라는 것이다. 역시 대기업은 다르구나 생각을 하기도 하였다.

다음 답장을 기다리도록 하였다.

## Second Reply

첫번째 답변에 응답을 한 뒤 몇분 후 답장이 왔다.

![](https://velog.velcdn.com/images/yulmwu/post/e21e3190-6779-4514-817c-dbc022b7de0d/image.png)

요약: 기다려라

## Third Reply

몇시간 정도 기다리니 이런 답변이 도착했다.

![](https://velog.velcdn.com/images/yulmwu/post/5a348011-9605-4445-9b03-23d1d9097da2/image.png)

NAT Gateway 비용과 ECS Fargate 비용이 환불된 듯 하다.

그저 GOAT...

솔직히 환불 거부를 당해도 경험삼아 이정도 비용쯤이면 그냥 지불해볼 생각이였는데 이렇게 까지나 부분 환불을 해줬다는 것에 매우 감사함을 느낀다.

그리고 교내에서 했던 프로젝트였는데, 공동 2등으로 상금 10만원을 받아 손해는 없었긴 했다.
(팀원이 3명인데 조장이라 4만원을 받기로 했음)
