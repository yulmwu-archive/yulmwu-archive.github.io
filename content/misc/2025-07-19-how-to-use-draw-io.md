---
title: "[Tools] AWS 다이어그램 만드는 방법 (draw.io)"
description: "다이어그램 도구, draw.io 사용법 (AWS 다이어그램 만드는 방법)"
slug: "2025-07-19-how-to-use-draw-io"
author: yulmwu
date: 2025-07-19T06:05:51.558Z
updated_at: 2026-01-12T11:42:45.594Z
categories: ["Misc"]
tags: ["aws"]
series:
    name: Misc
    slug: misc
thumbnail: ../../thumbnails/misc/how-to-use-draw-io.png
linked_posts:
    previous: 2025-07-19-refund-aws
    next: 2025-07-19-memoir-2025
is_private: false
---

# 0. Overview

AWS 아키텍처 다이어그램을 그림판으로 그리는 사람을 보고나서 글을 쓰게 되었다.

검색해보면 레딧 같은 곳에서 사이트들을 추천해주는데 들어가보면 회원가입도 해야하고 유료인 기능들도 꽤나 있는 곳이 있어서 무료 + 간편함 둘 다 가진 사이트를 추천한다.

https://www.drawio.com/

draw.io라는 서비스인데, 사실상 무료에 웹 기반으로 작동한다. (프로그램 설치가 가능한데, 설치하길 권장한다.)

필자가 가장 추천하고, 또 가장 자주 사용하는 서비스이다.
꼭 AWS와 관려된게 아니여도 다이어그램을 그려야 한다면 draw.io를 애용한다.

# 1. How to use?

## Basic Settings

먼저 [draw.io](https://draw.io)에 접속하면 아래와 같은 화면이 나온다.

![](https://velog.velcdn.com/images/yulmwu/post/a57e7cc9-d857-4ffe-90dc-cd566b615197/image.png)

우리가 볼 곳은 왼쪽 사이드바이다.

![](https://velog.velcdn.com/images/yulmwu/post/2d299ec6-dbc4-407a-9280-66b1bf624a1d/image.png)

그런데 찾아보면 AWS 아키텍처와 관련된 다이어그램 도형은 없는데, 아래의 "그 외 도형" 버튼을 클릭하자.

![](https://velog.velcdn.com/images/yulmwu/post/0aacdc47-a4b4-4fed-b1ed-fa2d5290d8d7/image.png)

그리고 "AWS 2025"를 찾아 체크하자. 나머지 AWS17, AWS18, AWS 3D는 필요 없다.

![](https://velog.velcdn.com/images/yulmwu/post/5e7f8402-841c-4f2c-9c2c-ec7ee6952b56/image.png)

그러면 AWS와 관련된 도형들이 생겨난다.

## Example

예시로 아래의 아키텍처를 만들어보자.

![](https://velog.velcdn.com/images/yulmwu/post/34c11f55-d859-4397-ac3e-51ad45c34582/image.png)

### Groups

먼저 그룹 항목에서 AWS Cloud 그룹과 VPC 그룹, AZ 그룹, 서브넷 그룹, ASG 그룹 등을 가져온다.

![](https://velog.velcdn.com/images/yulmwu/post/72dd20d5-02b2-42b1-b07c-6dc705d15c87/image.png)

만들다 보면 가끔 요소들이 서로 붙는데, 그룹 해제를 해주면 된다. 필자는 안쓰는 기능이다.

![](https://velog.velcdn.com/images/yulmwu/post/4db3484c-e35e-4c21-b24c-5442149d8036/image.png)

위 아키텍처 전부를 다시 만들기엔 귀찮아서 대충 해보겠다.

![](https://velog.velcdn.com/images/yulmwu/post/d9e463f7-d6d2-429b-b7d6-2a4d31ded04e/image.png)

이렇게 그룹들을 가져온다. 그리고 제목을 바꾸려면 그룹이나 요소를 더블 클릭하여 제목을 변경할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/a3b96939-3a4f-4380-a06a-b19005cfc609/image.png)

색을 바꾸려면 오른쪽 사이드바에서 변경할 수 있다. (위치나 정렬 등 변경 가능)

![](https://velog.velcdn.com/images/yulmwu/post/dbe2d23a-019d-4f78-85c4-d471008b4bca/image.png)

### Shapes (AWS Services)

다음으로 요소를 가져와보자. 검색을 해도 되는데, 정확한 이름을 넣어야한다. 예를 들어 ALB를 가져오려면 Application Load Balancer를 검색해야한다.

![](https://velog.velcdn.com/images/yulmwu/post/4bf5d6b6-3de9-4342-ba56-e2009003f497/image.png)

EC2를 가져왔는데, 기본적으로 너무 크다. 필자는 40x40 사이즈가 가장 적당하다고 생각한다.

![](https://velog.velcdn.com/images/yulmwu/post/5ac385ac-47dd-4c57-ae99-230abeb8d9a8/image.png)

요소도 더블 클릭하면 이름을 바꿀 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/4ee9e22f-3128-40bb-b6b0-74baeee954f5/image.png)

그런식으로 요소(도형)들을 배치한다.

![](https://velog.velcdn.com/images/yulmwu/post/b6f09147-ee61-48ac-a3e9-79c74985a49e/image.png)

### Wiring

다음으로 각 요소들을 와이어링(선 연결)을 해보겠다. 왼쪽 사이드바에서 와이어를 찾아 직접 연결해도 되지만, 간단하게 요소 위에 마우스를 호버시키면 화살표 표시가 뜬다.

![](https://velog.velcdn.com/images/yulmwu/post/873e5114-9b52-4f41-9b95-e374a7310972/image.png)

그 화살표를 잡은 상태로 다른 요소나 그룹에 접촉시키면 연결이 된다.

![](https://velog.velcdn.com/images/yulmwu/post/9f39c915-9c99-4da3-b3f1-a606e41aba06/image.png)

위치를 바꾸려면 파란 점을 클릭하여 이동시킨다.

![](https://velog.velcdn.com/images/yulmwu/post/ebbc56e9-91b9-4d99-985c-c6898e2dd215/image.png)

그리고 와이어 위에 텍스트를 쓰려면 와이어를 더블 클릭한다. 그럼 텍스트를 쓸 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/233a91c2-c46f-44c8-9e94-e2f8246540c2/image.png)

만약 배경 색을 바꾸고 싶다면 마찬가지로 오른쪽 사이드바에서 변경할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/79d199a3-21fe-4327-b53b-ab42a4c5a661/image.png)

와이어의 색이나 스타일도 변경할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/647199e0-8205-4bae-b2d6-63871896cfa5/image.png)

이런식으로 아키텍처를 만들면 된다. 아키텍처를 만들땐 일관성있게, 가독성있게 만들어야 좋다. 자기 꼴리는대로 만들다보면 나중에 보기도 힘들고 헷갈린다.

### Insert External Image

외부 이미지를 가져올 수 도 있다.

![](https://velog.velcdn.com/images/yulmwu/post/fa3b2684-28f3-4293-8c80-edc5f0128b91/image.png)

다만 현재 웹 버전에선 버그가 좀 있는 듯 한데, 프로그램 설치 후 사용하면 문제 없이 크기를 조정할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/9eef07b5-5ecf-445a-884d-995133bf20a3/image.png)

### Export Image

마지막으로 저장 시 `.drawio` 파일로 저장이 되는데, 이미지를 내보내려면 파일 메뉴에서 내보내기 항목을 클릭하자.

![](https://velog.velcdn.com/images/yulmwu/post/74d0a812-6932-4f57-b21d-a25ba9e09c21/image.png)

여러 형식을 선택할 수 있는데, PNG로 선택해주겠다.

![](https://velog.velcdn.com/images/yulmwu/post/8f23d070-3667-4e5b-91b0-31744bd6f772/image.png)

그리고 배율의 경우 필자는 500%로 설정한다. 100%는 블로그 같은데 올릴 시 이미지가 작아 깨져보인다. 적당히 조절하여 내보내면 아키텍처 이미지가 만들어진다.

그 외엔 직접 몇번 하다보면 익혀진다. 이 글에선 간단한 기능만 살펴보았는데, 솔직히 이게 전부긴 하다.

앞서 말했 듯 AWS 말고도 기본적인 다이어그램 부터 마소 Azure나 구글 GCP 등의 여러 서비스도 지원하니 유용하게 사용하면 되겠다.

끝.
