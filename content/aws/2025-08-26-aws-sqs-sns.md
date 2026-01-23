---
title: '[AWS Integration] MSA with SQS & Pub/Sub Pattern with SNS'
description: 'AWS SQS and SNS를 통한 MSA 애플리케이션 간 메시징 솔루션 (+ DLQ)'
slug: '2025-08-26-aws-sqs-sns'
author: yulmwu
date: 2025-08-26T04:24:51.006Z
updated_at: 2026-01-23T04:23:44.253Z
categories: ['AWS']
tags: ['Integration', 'aws']
series:
    name: AWS
    slug: aws
thumbnail: ../../thumbnails/aws/aws-sqs-sns.png
linked_posts:
    previous: 2025-08-26-aws-codepipeline
    next: 2025-08-26-aws-appsync-graphql-serverless
is_private: false
---

> 포스팅에서 사용된 SQS 프로듀서 & 컨슈머 예제는 아래의 깃허브 링크에서 확인하실 수 있습니다.
>
> https://github.com/eocndp/aws-sqs-sns-example

# 0. Overview

요즘 들어 확장성, 유지보수성, 유연성 및 빠른 개발 및 배포라는 장점으로 MSA(MicroService Architecture) 패턴을 자주 사용한다.

필자도 MSA + Serverless 주제로 API Gateway 및 Lambda를 사용한 포스팅을 작성한적이 있는데, MSA에 대한 설명이 있으니 참고해도 좋을 것 같다.

https://velog.io/@yulmwu/aws-serverless

짧게 설명하자면, 하나의 거대한 애플리케이션을 여러개의 작은 서비스(마이크로 서비스)로 분리하는 구조이다.

![](https://velog.velcdn.com/images/yulmwu/post/97b68510-6b41-45cb-9d5a-17b7263a2b65/image.png)

사진과 같이 내부적으로 비즈니스 서비스들을 마이크로 서비스라는 단위로 분리한다.

앞서 설명한 장점들로 요즘들어 자주 사용되는 패턴인데, 그럼 각 서비스 간에 소통은 어떻게 할까?

단순히 마이크로 서비스의 HTTP API를 호출하는 등의 통신을 하기도 하지만, 더욱 좋은 성능을 내기 위해 메시지 브로커(Message Broker)를 쓰기도 한다.

대표적으로 RabbitMQ, Kafka 등의 서비스가 있고, AWS에서도 SQS(Simple Queue Service)라는 서비스로 제공한다.

SQS는 AWS에서 제공하는 완전 관리형 서비스고, RabbitMQ를 사용할 경우 Amazon MQ 서비스를 통해 설정하고 운영할 수 있다.

RabbitMQ나 Kafka에 대한 내용은 나중에 따로 다뤄보도록 하고, 먼저 AWS SQS 서비스 부터 알아보도록 하겠다.

# 1. What is SQS ?

먼저 메시지를 보내는 입장을 프로듀서(Producer), 받는 쪽을 컨슈머(Consumer)라고 부른다.

예를 들어 게시판 서비스에서 게시글을 작성하면 해당 게시자를 구독(팔로우)하는 유저들에게 메일을 보내는 기능을 구현한다고 해보자.

만약 메시지 브로커 없이 한번에 모두 끝낸다고 가정해보자.

![](https://velog.velcdn.com/images/yulmwu/post/59bd64c4-0d24-413d-b427-b7cb3cf4ac79/image.png)

한명의 유저에 메일을 보내는데 예시로 50ms가 걸린다고 가정해보자. 그럼 기존엔 30ms면 끝낼 처리를 메일 전송 때문에 총 230ms가 걸리게 된다.

또한 MSA 구조에서 알림 서비스를 따로 분리시키는 경우도 있기 때문에 이렇게 한번에 로직을 처리하는건 비효율적이다. 그래서 메시지 브로커(SQS)를 사용한다면 아래와 같이 바뀔 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/edaabe62-7946-4ff1-aa18-493ef95e3334/image.png)

알림(이메일)을 보내는 기능 자체를 다른 서비스로 분리시키고, 두 서비스 간엔 SQS 메시지 브로커를 통해 서로 상호작용한다.

이때 SQS 큐를 통해 송수신하고, 이로 인해 Posts 서비스는 게시글을 저장하고 SQS 큐에 메시지를 Publish 하기만 하면 되기 때문에 늦춰지는 부분 또한 없어진다. (구독자 입장에서 알림은 살짝 늦어져도 괜찮다.)

큐는 일종의 버퍼 역할도 하는데, 메시지가 바로 처리되는 것이 아닌 딜레이를 두거나 한번에 가져올 수 있는 메시지 수를 제한하여 백엔드의 부하를 막을 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/0d46a5aa-7818-48a9-8fb5-448af2fa56df/image.png)

사진에서 `DelaySeconds`는 메시지를 보낸 후 컨슈머가 큐에서 읽을 수 있게 노출되기 까지의 딜레이, `MaxNumberOfMessages`는 컨슈머에서 한번에 최대 몇개의 메시지를 Polling 할지 설정할 수 있다.
(SQS는 RabbitMQ와 다르게 브로커에서 Push해서 컨슈머가 소비하는 방식이 아닌 컨슈머가 큐에 Polling하여 메시지를 가져온다.)

> ### Short Polling vs Long Polling
>
> 그 둘을 설명하기 전, Polling과 Pulling은 다른 개념이다. Pulling의 경우 단순히 클라이언트가 데이터를 가져오는 일반적인 상황을 말하며, 그 응답엔 데이터가 있을 수 도 있고 없을 수 도 있다.
>
> 하지만 Polling은 데이터가 없다면 요청을 반복하여 데이터가 있을 때 까지 주기적으로 요청(Pulling)을 한다.
>
> SQS에선 Short Polling과 Long Polling이 있는데, Short Polling은 Pull Polling과 흡사하고, Long Polling은 Pulling을 하는데 메시지가 없다면 특정 시간동안 대기한다. 이후 메시지가 온다면 그대로 반환, 특정 시간 이후에도 메시지가 없다면 빈 응답을 반환한다. (내부적으로 HTTP Keep Alive 사용, 최대 20초)
>
> 그래서 기존의 무한 반복에 계속해서 요청을 날리는 Polling 방식보다 리소스 절약이 가능하다.
>
> 컨슈머 코드에서 Polling과 관련한 옵션을 추후 설명하겠다.

SQS 큐를 만들 때 순서 보장이 없지만 성능이 빠른 Standard와 FIFO(선입선출) 방식의 순서 보장이 있는 두 유형을 선택할 수 있다.

이렇게 두개 이상의 마이크로 서비스로 쪼개어 확장성, 유지보수성 등을 얻는 것을 디커플링이라 하고, 이렇게 쪼개진 서비스 간의 소통을 위해 필요한 것이 SQS, RabbitMQ와 같은 메시지 브로커다.

하지만 RabbitMQ와 다른 점은 SQS는 AWS에서 제공하는 완전 관리형 서비스로, RabbitMQ 처럼 큐와 Exchange를 만들고 바인딩하는 복잡한 과정과 클러스터 세팅 등의 많은 부분을 신경쓰지 않고 빠르게 구축할 수 있다.

다만 소스 코드(프로듀서 또는 컨슈머)를 AWS SDK 등에서 제공하는 코드에 맞게 수정하거나 작성해야 하므로 참고하도록 하자. (SQS 프로듀서 및 컨슈머 코드는 추후 설명하겠다.)

SQS에 대해선 3번째 목차(SQS: Let's build the Infra)에서 살짝 더 다뤄보겠다.

## SQS DLQ

만약 컨슈머가 메시지를 제대로 처리하지 못한다면 어떨까? 이 질문에 대해 답하려면 먼저 메시지 큐잉의 메시지 처리 후 과정을 살펴봐야 한다.

기본적으로 SQS에서 컨슈머가 메시지를 가져갔다면, 해당 메시지는 큐에서 보여지지 않는다. (Visibility)

그리고 컨슈머가 그 메시지를 처리했다면 SQS 큐에서 해당 메시지를 제거한다.

![](https://velog.velcdn.com/images/yulmwu/post/b9ccf7c5-21b6-4039-9e6c-943aa989498f/image.png)

그런데 모종의 이유로 컨슈머에서 실패하거나 컨슈머의 처리 제한 시간(Visibility Timeout, 큐에서 보여지지 않는 시간, 초과되면 실패로 간주함)을 초과하면 어떻게 될까?

정답은 큐에서 다시 보여지는 것이다. 그러면 컨슈머는 해당 메시지를 다시 받을 것이고, 그렇게 되면 계속 실패하였을 경우 무한 반복이 되어 리소스를 상당히 낭비하게 될 것이다. (반복될 때 ReceiveCount를 증가시킨다.)

그래서 특정 반복 횟수(ReceiveCount)를 초과할 경우(maxReceiveCount) 자동으로 DLQ(Dead Letter Queue)라는 별도의 큐로 이동된다.

이제 이 큐에서 실패한(죽은) 메시지를 다른 방식으로 처리한다거나, 혹은 로그를 남기는 등의 작업을 하게 만들면 된다.

이를 이용하여 컨슈머의 무한 재시도를 방지하고, 서비스의 안정성을 유지하면서 문제의 원인을 쉽게 분석할 수 있게 할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/7a75094d-a19f-45f1-9b44-6059969f418a/image.png)

# 2. What is SNS ?

그런데 SQS는 RabbitMQ의 Exchange와 같은 기능은 없다.

Exchange는 RabbitMQ에서 메시지를 어느 큐로 보낼지 라우팅하는 역할로, 라우팅 키에 맞는 하나의 큐로 보내는 Direct 말고도 Topic이나 Fanout 등의 타입이 있다.

Topic 방식은 라우팅 키에 대해 패턴 매칭을 하여 키에 맞는 특정 큐로 메시지를 보내거나 Fanout 방식을 통해 브로드캐스팅 할 수 있다. (헤더 방식도 있으나 자세한 설명은 생략한다.)

![](https://velog.velcdn.com/images/yulmwu/post/d0e3edee-a14b-4716-90e2-16d130fd8d3c/image.png)

그런데 SQS는 이러한 좋은 기능을 기본적으로 탑재하고 있지 않은데, 이와 거의 흡사한 기능을 하는 서비스가 바로 SNS(Simple Notification Service)이다.

SNS는 토픽(Topic)이라는 단위로 관리되고, SNS 토픽에서 SQS를 바인딩할 수 있다. (RabbitMQ에서 Exchange, Queue 바인딩과 흡사함.)

이렇게 SNS 토픽에 SQS 등의 서비스를 바인딩(연결)하는 것을 구독(Subscription)이라 하고, 구독한 서비스들을 구독자(Subscriber)라고 한다.

SQS 말고도 람다 함수나 EventBridge 연결, 이메일 전송 등의 여러 서비스를 구독시킬 수 있으며, 구독 필터 정책(Subscription Filter Policy)을 통해 각 구독자마다 라우팅되는 조건을 걸 수 있다.

필터 정책이 없다면 기본적으로 구독자들에게 브로드캐스팅된다. (RabbitMQ Exchange에서 Fanout과 유사)

만약 어떠한 구독자가 필터 정책으로 아래와 같은 정책을 가지고 있다면,

```js
{
	"eventType": ["order_created"]
}
```

해당 구독자는 메시지의 Message Attributes(헤더와 비슷함) 중 `eventType`이 `order_created`인 메시지만 필터링하여 받게 된다. (RabbitMQ Exchange에서 Direct와 유사)

또한 조건은 가능하나, RabbitMQ Topic Exchange와는 다르게 와일드카드를 사용할 수 없다. 그래서 `[{ "prefix": "order." }]` 등으로 접두사를 체크한다거나, `["order_created", "post_created"]` 등으로 조건과 같은 비교적 단순한 조건만 가능하다.

![](https://velog.velcdn.com/images/yulmwu/post/2bbb6294-734d-4f4f-876d-c096caa14921/image.png)

다만 주의할 점은 RabbitMQ Exchange와 SNS 필터 정책은 겉보기엔 비슷해보이나, 차이가 있다. (애초에 SNS와 SQS는 별개의 서비스라는걸 잊으면 안된다.)

RabbitMQ Exchange는 큐 사이에 바인딩된 라우팅 키를 보고 브로커가 해당 큐로 Push 하지만, SNS는 구독에 걸린 필터 정책을 보고 매칭되는 구독자에게 Push 한다. (이후 SQS 큐에 Push되었다면 그 SQS는 Polling 하여 데이터를 큐에서 가져옴, RabbitMQ는 브로커가 컨슈머를 Push 하는 방식)

더 쉽게 말하자면 RabbitMQ는 끝까지 Push 하는 방식, SNS + SQS는 SNS가 SQS 큐 까진 Push 해주지만, 끝단의 컨슈머는 SQS 큐에서 Polling 방식으로 메시지를 가져오는 방식인 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/7904c8c4-365e-4449-a5a2-a78834a2f669/image.png)

(RabbitMQ 동작 과정)

![](https://velog.velcdn.com/images/yulmwu/post/6c38cb79-e5b3-4437-af12-d2746093709c/image.png)

(SNS + SQS 동작 과정)

RabbitMQ와 비교하느라 말이 길어졌는데, 결론적으로 SNS는 메시지를 받으면 패턴 정책을 바탕으로 구독자들에게 메시지를 다시 전달하는 것이다.

다만 SNS는 일반적으로 Fanout 방식, 즉 필터 정책을 거의 사용하지 않고 같은 메시지를 주로 여러 SQS나 람다 함수 등에 복제하는 방식으로 많이 사용한다.

만약 이벤트 조건이나 필터링이 중요하고 복잡한 Event Driven 아키텍처라면 EventBridge를 사용하는 것도 좋은 방법이다.

# 3. SQS: Let's build the Infra

먼저 SQS 큐를 만들어보자.

![](https://velog.velcdn.com/images/yulmwu/post/9d7ba031-4521-4bae-a4b5-b398f987c4cc/image.png)

"대기열(큐) 생성"을 클릭한다.

![](https://velog.velcdn.com/images/yulmwu/post/298dd614-3947-4193-a65e-ea96c76f9e8f/image.png)

그럼 맨 처음 유형을 선택할 수 있는데, Standard와 FIFO 방식을 선택할 수 있다. Standard는 큐의 순서가 보장되지 않고 최선의 정렬을 해주기 때문에 퍼포먼스가 FIFO 유형보다 더 빠르다.

반면 FIFO 방식은 기존의 큐 방식과 같으며, 선입선출로 순서가 보장된다. 순서가 상관 없다면 Standard를 선택하면 된다.

![](https://velog.velcdn.com/images/yulmwu/post/448a2c54-7988-4d9b-90c1-d9fc42794f9d/image.png)

다음으로 구성에선 위와 같이 여러 항목들이 나온다. 각 항목을 살펴보면 아래와 같다.

- **표시 제한 시간** : 위에서 설명했는데, 컨슈머가 메시지를 가져간 후 처리되기 시작하면 해당 메시지는 큐에서 보여지지 않는다. 이후 이 시간 제한을 초과하면 다시 보여지게 되고, 해당 컨슈머의 결과는 실패로 간주되어 재시작된다. 컨슈머에서 설정할 순 있지만 기본 값으로 설정할 수 도 있다.
- **전송 지연** : 생성된 메시지가 컨슈머에게 바로 노출되는게 아닌 지연 시간을 설정할 수 있다.
- **메시지 수신 대기 시간** : 컨슈머에서 Long Polling을 사용하여 메시지를 수신할 때, 메시지가 없을 때 대기하는 시간을 의미한다.
- **메시지 보존 기간** : 큐에서 메시지가 보존되는 기간을 의미하며, 이 보존 기간을 초과하면 메시지는 영구적으로 삭제된다.

그 외에 IAM 등의 설정은 추후에 해보도록 하고, 큐를 만들어보도록 하자.

![](https://velog.velcdn.com/images/yulmwu/post/b55be278-a719-4fea-a383-cbe6a4a7ceae/image.png)

그리고 "메시지 전송 및 수신" 버튼을 클릭하면 간단하게 메시지를 보내고 Long Polling을 해볼 수 있다.

메시지 수신에서 "메시지 폴링" 버튼을 눌러보자.

![](https://velog.velcdn.com/images/yulmwu/post/4b9950ad-cbf9-4eb3-81ee-3b1cbdf95ae3/image.png)

그럼 큐에 있는 최대 10개의 메시지들을 가져오게 되고, 만약 10개가 되지 않는다면 대기한다.

다만 API 상 Long Polling(ReceiveMessage)은 동작이 다른데, 메시지가 없다면 Polling 기간 동안 대기하는 것은 맞으나 메시지가 하나라도 큐에 있다면 Polling하여 바로 응답한다.

만약 Long Polling 실행 시점 큐에 10개 이상의 메시지가 있다면 최대 10개의 메시지를 반환하는 것이다. (MaxNumberOfMessages)

그래서 처리량을 높이고 싶을 때 MaxNumberOfMessages를 2 이상 설정하게 되면 한번에 여러개의 메시지를 받아 워커 스레드나 비동기로 분배하여 처리할 수 있게 된다.
(서버의 부담이 생길 수 있으니 적절한 동시성 제한을 걸어두는 등의 대책이 필요하다.)

MaxNumberOfMessages 때문에 복잡할 수 있는데, 다시 본론으로 돌아와 테스트를 해보자. "메시지 폴링" 버튼을 클릭한 상태로 아무 메시지를 보내보자.

![](https://velog.velcdn.com/images/yulmwu/post/8921bf40-adef-4ae6-a6b5-c0b148208009/image.png)

그럼 "메시지 수신"에서 보낸 메시지가 도착한 것을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/3a4ed6ff-920d-4c3f-952b-bf0aeee02641/image.png)

그대로 냅두면 처리되지 않은 상태로 다음 Polling 시 다시 가져오니 삭제를 해서 처리를 해주자.

이번엔 Polling 하지 않는 상태에서 메시지를 10개 이상 보내보자. (MaxNumberOfMessages = 10 일때)

그리고 "메시지 폴링" 버튼을 클릭해보자.

![](https://velog.velcdn.com/images/yulmwu/post/8977cdc2-5a2d-4dd3-8a9f-75d756dd7a0a/image.png)

그러면 빠르게 10개의 메시지가 가져와지고, 10개를 모두 가져온 뒤 Polling이 바로 종료된다.

나타난 10개의 메시지를 모두 삭제하고 다시 Polling 해보자.

![](https://velog.velcdn.com/images/yulmwu/post/dfa8f486-29e5-4469-9f4a-80d4e4a482f0/image.png)

그러면 3개의 메시지를 가져온 뒤 대기한다. (실제 API 호출에선 대기하는게 아닌 3개의 메시지를 가져온 뒤 가져온 뒤 바로 종료된다.)

![](https://velog.velcdn.com/images/yulmwu/post/d8fff267-ab5b-4baf-93e1-256988572fb0/image.png)

> **" 컨슈머 메시지 핸들러에서 비동기로 처리하면 큐엔 항상 하나의 메시지와 ReceiveMessage 시 항상 하나의 메시지만 가져오는건 아닐까? (빠르게 비동기 핸들러로 배분되니깐) "**
>
> 이러한 의문이 들 수 있다. 실제로 트래픽이 많지 않은 서비스라면 그럴 가능성이 충분히 있다. 하지만 서비스 규모가 커지거나 Bulk로 메시지를 보내는 경우라면 동시에 큐에 메시지가 들어올 수 있다.
>
> 이럴 경우 Long Polling 시 여러개의 메시지를 응답받게 될 수 있는데, MaxNumberOfMessages를 통해 응답의 메시지 수를 제한하는 것이다.
>
> 여러개의 메시지를 한번에 받으면 네트워크적으로 API 호출이 적어지니 효율이 좋아질 수 있으나 서버에 부담이 갈 수 있으니 적절히 조절하면 될 것 같다.

DLQ에 대해선 따로 다뤄보겠다.

# 4. SQS: Let's write the Code

> 코드는 아래의 깃허브에서 볼 수 있다.
>
> https://github.com/eocndp/aws-sqs-sns-example

이제 SQS 프로듀서 코드와 컨슈머 코드를 작성하여 메시징을 테스트 해보고, SNS와 연동하여 SNS에 메시지를 보냈을 때 SQS 컨슈머가 동작하는 모습과 람다가 실행되는 모습, 그리고 이메일까지 보내보도록 하겠다.

플랫폼은 NodeJS로, AWS SDK v3를 사용하며 NestJS와 연동하여 사용해보도록 하겠다.

먼저 NestJS 프로젝트를 만들어주고, 아래와 같은 라이브러리를 설치해주자.

```shell
npm i @aws-sdk/client-sqs sqs-consumer
```

`sqs-consumer`는 SQS 컨슈머를 쉽게 구현해주도록 하는 라이브러리이다.

그리고 `.env` 환경변수를 아래와 같이 설정해주자.

```env
AWS_REGION=REGION
SQS_QUEUE_URL=https://sqs.ap-northeast-2.amazonaws.com/ACCOUNT_ID/QUEUE
```

그리고 프로듀서 코드부터 보도록 하자.

```ts
// sqs.producer.service.ts

import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'

export interface SqsSendOptions {
	type?: string
	delaySeconds?: number
	groupId?: string
	deduplicationId?: string
	messageAttributes?: Record<string, SqsMessageAttribute>
}

export interface SqsMessageAttribute {
	DataType: 'String' | 'Number' | 'Binary'
	StringValue?: string
	BinaryValue?: Uint8Array
}

@Injectable()
export class SqsProducerService {
	private readonly logger = new Logger(SqsProducerService.name)
	private readonly client: SQSClient
	private readonly queueUrl: string

	constructor(private readonly config: ConfigService) {
		this.client = new SQSClient({
			region: this.config.get<string>('AWS_REGION'),
		})
		this.queueUrl = this.config.get<string>('SQS_QUEUE_URL', '')
	}

	async send(body: any, options?: SqsSendOptions): Promise<string | undefined> {
		const MessageBody = typeof body === 'string' ? body : JSON.stringify(body)

		const cmd = new SendMessageCommand({
			QueueUrl: this.queueUrl,
			MessageBody,
			DelaySeconds: options?.delaySeconds ?? 0,
			MessageGroupId: options?.groupId,
			MessageDeduplicationId: options?.deduplicationId,
			MessageAttributes: options?.messageAttributes,
		})

		const res = await this.client.send(cmd)
		this.logger.debug(`Sent message: ${res.MessageId}`)

		return res.MessageId
	}
}
```

AWS SDK SQS 클라이언트를 사용하여 간단하게 메시지를 보내는 코드이다. 위 서비스만 연결해둔 상태로 실행해보고 AWS 콘솔로 확인해보자.

![](https://velog.velcdn.com/images/yulmwu/post/5c4daa87-ea59-41f4-9c07-8c37bd7266d1/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/473b2383-601c-4cff-b0c6-1943f4108e4b/image.png)

잘 나오는 것을 볼 수 있다. 이제 컨슈머 서비스 코드를 추가하여 잘 처리되는지 확인해보자.

```ts
// sqs.consumer.service.ts

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SQSClient } from '@aws-sdk/client-sqs'
import { Consumer } from 'sqs-consumer'

@Injectable()
export class SqsConsumerService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(SqsConsumerService.name)

	private consumer!: Consumer
	private client: SQSClient
	private queueUrl: string

	constructor(private readonly config: ConfigService) {
		this.client = new SQSClient({
			region: this.config.get<string>('AWS_REGION'),
		})
		this.queueUrl = this.config.get<string>('SQS_QUEUE_URL', '')
	}

	onModuleInit() {
		this.consumer = Consumer.create({
			queueUrl: this.queueUrl,
			sqs: this.client,
			batchSize: 10,
			waitTimeSeconds: 20,
			visibilityTimeout: 10,
			messageAttributeNames: ['All'],
			messageSystemAttributeNames: ['ApproximateReceiveCount'],
			handleMessage: async (message) => {
				const body = this.safeParse(message.Body)

				const ok = await this.dispatch(body, { sqsMessageAttributes: message.MessageAttributes })
				if (!ok) {
					throw new Error(
						`Message handling failed (ReceiveCount: ${message.Attributes?.ApproximateReceiveCount})`,
					)
				}
			},
		})

		this.consumer.on('error', (err) => this.logger.error(`Consumer error: ${err.message}`, err.stack))
		this.consumer.on('processing_error', (err) => this.logger.error(`Processing error: ${err.message}`, err.stack))
		this.consumer.on('message_received', (m) => this.logger.debug(`Received: ${m.MessageId}`))
		this.consumer.on('message_processed', (m) => this.logger.debug(`Processed: ${m.MessageId}`))

		this.consumer.start()
		this.logger.log('SQS consumer started')
	}

	async onModuleDestroy() {
		if (this.consumer) {
			this.consumer.stop()
			this.logger.log('SQS consumer stopped')
		}
	}

	private safeParse(raw?: string) {
		if (!raw) return undefined
		try {
			return JSON.parse(raw)
		} catch {
			return raw
		}
	}

	private async dispatch(payload: any, meta?: any): Promise<boolean> {
		try {
			const parsedPayloadBody = this.jsonParse(payload?.Message)

			switch (parsedPayloadBody?.type || payload?.type) {
				case 'order.created':
					this.logger.log('[order.created]', payload, meta)
					break
				case 'throw.error':
					throw new Error('Test error')
				default:
					this.logger.log('[message]', payload, meta)
			}
			return true
		} catch (e: any) {
			this.logger.error('dispatch error: ' + e?.message)
			return false
		}
	}

	private jsonParse(raw?: string): any {
		if (!raw) return undefined
		try {
			return JSON.parse(raw)
		} catch {
			return raw
		}
	}
}
```

AWS SDK를 직접 사용하지 않고 써드파티 라이브러리를 사용하였는데, 사용 방법은 비슷하다. 컨슈머 객체를 만들 때 `batchSize`(MaxNumberOfMessages), `waitTimeSeconds`(대기 시간), `visibilityTimeout`(큐에 다시 보여지기 까지의 시간) 등을 설정해준다.

그리고 원활한 테스트를 위해 프로세싱 중 발생하는 에러와 받은 메시지, 프로세싱 후 이벤트에 대해 로그를 남기도록 하였다.

그리고 컨슈머의 `handleMessage`는 메시지를 비동기로 처리하는 컨슈머의 메시지 핸들러인데, 에러 없이 반환될 경우 자동으로 성공했다고 가정하여 해당 메시지를 삭제한다. 그리고 `dispatch` 함수에서 페이로드의 `type`에 맞게 핸들링하고, 테스트를 위해 에러를 띄워보도록 하겠다.

Postman에서 아래의 사진과 같이 요청을 보내보자.

![](https://velog.velcdn.com/images/yulmwu/post/f40f5bc3-b63e-4456-8aa5-231b691ae665/image.png)

그러면 서버의 로그에 아래와 같이 찍힐 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/3f2b0120-1fc0-4bb4-a53e-4a6333a7524f/image.png)

성공이다. AWS 콘솔에서 보내는 메시지도 똑같이 테스트할 수 있다.![](https://velog.velcdn.com/images/yulmwu/post/147f9d35-e3d9-4c4a-81d1-9bab5e8eed07/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/4a0dbc3c-11aa-4acf-aae8-d37ddf1c4a33/image.png)

이때 만약 AWS 콘솔에서 Long Polling을 실행한다면 서버의 로그엔 아무것도 남지 않는 것을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/e9eede65-931b-492b-8cbb-38319f1a9e35/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/6081d0ea-6fc0-49fc-8be9-b004354b3f67/image.png)

## DLQ(Dead Letter Queue)

그럼 DLQ는 어떻게 구현할까? 코드로 구현할 필요는 없고 SQS 설정에서 설정할 수 있다. 먼저 DLQ로 사용할 큐를 하나 만들어주자.

![](https://velog.velcdn.com/images/yulmwu/post/039005d5-e244-4590-b4c9-a4419ac690bd/image.png)

"리드라이브 허용 정책"에서 활성화를 해주고 모두 허용을 체크한다. 기본 값이 모두 허용이긴 한데 확실하게 해주기 위해 활성해두자.

![](https://velog.velcdn.com/images/yulmwu/post/2607fbba-c35e-46bc-920b-47d7195fe623/image.png)

그리고 TestQueue에 들어가 "배달 못한 편지 대기열" 메뉴에 들어가보자. (그냥 큐 편집 버튼을 눌러도 된다.)

![](https://velog.velcdn.com/images/yulmwu/post/11207cfc-dcc5-4eef-805e-f85783531cca/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/fab6b4b0-ca78-4f97-9c06-7eedc11f32e2/image.png)

그럼 배달 못한 편지 대기열을 활성화하고 maxReceiveCount를 설정할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/e342f058-d468-412f-9d72-a81f21f5a585/image.png)

테스트를 위해 maxReceiveCount를 짧게 설정해주었다. 이제 서버를 키고 Postman에 들어가 아래와 같은 요청을 보내보자.

![](https://velog.velcdn.com/images/yulmwu/post/a958e4d5-34f9-4da8-a30a-8812ee78c4c3/image.png)

그리고 20초 이상 기다린 후(visibilityTimeout를 10초로 설정해뒀기 때문) 서버의 로그를 보자.

![](https://velog.velcdn.com/images/yulmwu/post/3b7643d3-e79a-4f07-bafd-d2b9eb5f0166/image.png)

원래라면 무한으로 반복될 메시지 핸들링이 2번만 실행되고 멈춘걸 볼 수 있다. maxReceiveCount를 2로 설정해뒀기 때문이다. 이제 TestDLQ에서 확인해보자.

![](https://velog.velcdn.com/images/yulmwu/post/286d99b5-24b6-48e5-8c41-92207f2d24df/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/84d94ff8-6960-43fb-8de8-551561de5696/image.png)

에러가 발생되어 메시지가 컨슈머에 의해 처리(삭제)되지 않았고, maxReceiveCount(=2)를 초과하였기 때문에 TestDLQ로 리드라이브 된걸 볼 수 있다.

이 큐에 람다나 컨슈머 코드를 추가로 연결하여 디버깅을 위해 로그를 남기는 등 적절히 처리하면 된다.

# 5. SNS: Let's build the Infra

SNS는 어려운 개념이 아니니 인프라만 만들어보고 테스트를 해보겠다.

![](https://velog.velcdn.com/images/yulmwu/post/cd922964-d860-468c-8d0a-6a5658ed82cd/image.png)

"주제 생성"을 클릭한다.

![](https://velog.velcdn.com/images/yulmwu/post/765f1ad8-53e5-42a6-bbcc-eec47982f004/image.png)

유형은 똑같이 Standard로 선택하였다. 필요 시 FIFO 유형으로 선택하면 될 것 같다.

![](https://velog.velcdn.com/images/yulmwu/post/71fda693-a94a-418e-a18e-2c1d6f95d93a/image.png)

그러면 구독을 생성할 수 있다. 예시로 아까 SQS TestQueue 큐와 이메일 전송을 구독시키도록 해보자.

![](https://velog.velcdn.com/images/yulmwu/post/d78af942-33b8-4c50-97a8-5162a0183e88/image.png)

그러면 프로토콜을 선택할 수 있고, 엔드포인트를 선택할 수 있다. 프로토콜은 SQS, 엔드포인트는 만들어둔 큐를 선택하자.

![](https://velog.velcdn.com/images/yulmwu/post/2b1c39b5-3123-4745-b521-b68e99641c97/image.png)

그럼 구독이 만들어졌다. 테스트로 SNS에 메시지를 발행해보자.

![](https://velog.velcdn.com/images/yulmwu/post/6d9ad89d-e6ce-44eb-b67c-9170ea94093b/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/ccc8db6a-cba5-4e07-a11d-9c1984b08f1c/image.png)

그리고 메시지 본문을 적어주자. 참고로 각 프로토콜 별로 페이로드를 다르게 할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/0979aa10-33c7-4024-9e04-18149dc7ca88/image.png)

그리고 메시지 속성을 정해줄 수 있다. 필터 정책에 사용할 수 있으니 참고하자.

![](https://velog.velcdn.com/images/yulmwu/post/3db745bf-1d6e-493d-997f-5881d4a8394d/image.png)

이렇게 메시지를 게시해보자.

![](https://velog.velcdn.com/images/yulmwu/post/b3b317a1-9041-44b8-9a5d-fc323d1b6aaa/image.png)

그럼 이렇게 SNS 메시지가 TestQueue SQS 큐로 전달된다. (Type = Notification)

이번엔 본문에서 `type`이 `order.created`인 경우에만 이메일을 보낼 수 있도록 해보자. (필터 정책 적용)

> 본 포스팅에선 단순한 예시와 코드를 위해 페이로드 기반의 필터 정책을 사용하였으나, 요금이 다소 비싸질 수 있다.
>
> 그래서 단순 라우팅 정도라면 메시지 속성 기반의 필터 정책을 사용하는 것을 추천한다. (이 경우엔 무료이다.)

![](https://velog.velcdn.com/images/yulmwu/post/d5ff711e-8ae2-45b5-a772-b76032f58ae1/image.png)

사진과 같이 프로토콜을 정하고 자신의 이메일을 입력해주자.

![](https://velog.velcdn.com/images/yulmwu/post/d804e8c1-cd10-4b20-b708-3aa6abd2b989/image.png)

그리고 위와 같이 구독 필터 정책을 적어주자. 그러면 본문(`Message` 속성)에서 JSON이라면 `type`이 `order.created`에 해당하는지 확인한다. 만약 확인이 된다면 해당 구독자에게 메시지가 보내지게 되는 것이다.

구독을 생성하였으면 아직 대기 상태일 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/87482512-95f5-4f91-8069-74f545e38bbe/image.png)

이메일 인증을 해야하는데, 메일로 도착하였을 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/931aa26c-28e4-4390-a99c-693d414bfafc/image.png)

확인해주자.

![](https://velog.velcdn.com/images/yulmwu/post/e02696af-f53b-4f58-94c0-054edc8ba1bd/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/d8c39ae4-9888-4d63-a277-ae6d030f8b9e/image.png)

그럼 이메일 구독 생성이 완료되었다. 먼저 `type`이 `order.created`가 아닌 SNS 메시지를 보내보자.

![](https://velog.velcdn.com/images/yulmwu/post/c76a9343-968f-4b47-bf9c-33126370e30e/image.png)

그럼 아무런 필터 정책이 없는 SQS 큐엔 그대로 갈 것이고, 이메일은 도착하지 않았을 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/7473f579-4ea0-4ff4-ab85-2770e0647094/image.png)

이제 본문에서 `type`이 `order.created`인 메시지를 보내보자.

![](https://velog.velcdn.com/images/yulmwu/post/b8394875-a59a-4b51-b6f9-914b6aec6ea5/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/692038aa-6d34-41a6-9257-95c9847fa52a/image.png)

그리고 메일을 봐보자.

![](https://velog.velcdn.com/images/yulmwu/post/4fe19d12-9a8e-4dbb-8f83-83e3690b62d7/image.png)

그럼 사진과 같이 본문 내용이 포함된 메일을 받게 된다. SNS에서 프로토콜 별로 메시지 내용을 다르게 하여 보낼 수 있으니 적절히 사용하면 좋을 것 같다.

개념 위주의 기초적인 내용만 다뤘고, 더욱 더 디테일하게 사용하려면 RabbitMQ 등을 사용해보는 것도 좋은 선택일 듯 싶다.

# 6. Calculate Price

## SQS

자세한건 https://aws.amazon.com/ko/sqs/pricing 를 참고해보자. 일단 같은 리전이라면 SQS의 데이터 Transfer 비용은 무료다. 다만 API 요청(SendMessage, ReceiveMessage 등) 수에 따라 요금이 청구된다.

![](https://velog.velcdn.com/images/yulmwu/post/183fa31f-3e05-4453-a4a6-20d5770adc6b/image.png)

그런데 페이로드의 크기에 따라 요청 수가 달라진다.

![](https://velog.velcdn.com/images/yulmwu/post/e06c4d04-23ea-4b86-925f-11e41e687fc5/image.png)

> 2025년 8월 4일 부로 메시지의 최대 크기가 1MB로 변경되었으며, 요청의 페이로드 최대 크기도 1MB로 확장되었다.
>
> 요금에 변동이 있는건 아니지만 참고하도록 하자.
>
> https://aws.amazon.com/ko/about-aws/whats-new/2025/08/amazon-sqs-max-payload-size-1mib/
> https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessageBatch.html

사진과 같이 하나의 요청은 64KB 크기를 기준으로 청구된다. 즉 256KB 크기는 4개의 요청, 1MB의 크기는 16개의 요청으로 처리된다.

요금은 월 요청 수에 따라 달라지고, 예를 들어 월 별로 200만개의 메시지(메시지의 크기는 128KB라고 가정)가 발생하는데, 하나의 메시지를 보내고 처리하는데 아래와 같이 3번의 API가 필요하다. (SQS 단독으로 사용 시)

- SendMessage: 요청의 크기를 64KB의 청크로 나눠서 요청 수를 계산하므로, 2개의 요청으로 계산된다.
- ReceiveMessage: 한번의 요청으로 하나의 메시지를 가져온다고 가정하였을 때 하나의 요청으로 계산된다. (실제론 Long Polling 시 줄어들 수 있음)
- DeleteMessage: 하나의 메시지를 컨슈머가 처리했다면 메시지를 삭제해야 하므로 하나의 요청이 발생한다.

최종적으로 4개의 요청이 발생하고, 월 별로 총 $2,000,000 × 4 = 8,000,000$개의 요청이 발생하게 된다.

Standard 요금(FIFO는 살짝 더 비쌈)을 대입하여 계산하면 $(8 - 1) ×  0.40 = 2.8\$$의 요금이 월별로 발생하게 된다. (처음 백만개의 요청은 무료)

## SNS

SNS 요금 또한 [AWS 공식 문서](https://aws.amazon.com/ko/sns/pricing)에서 자세하게 확인할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/f9e7a973-06c1-4f5c-a19d-66868fdc0c95/image.png)

SNS도 요청에 대한 요금이 발생하고 똑같이 64KB의 청크로 나눠 요금을 계산한다. (백만개의 요청 당 0.5$)

예를 들어 월 별로 200만개의 메시지가 SNS로 Publish 되고, 각 메시지의 크기는 128KB라고 가정했을 때 아래와 같이 계산된다.

- 요청 수 = $2,000,000 × (\frac {128}{64} = 2) = 4,000,000$
- 요금 = $4 × 0.5\$ = 2\$$

SNS는 메시지를 리시브하거나 삭제하는 일은 없고, 구독을 만들어 메시지를 전송하기 때문에 전송 요금 등이 발생할 수 있다.

구독자의 프로토콜에 따라 요금이 다르게 발생하는데, 아래의 사진을 참고하자.

![](https://velog.velcdn.com/images/yulmwu/post/9d667229-58d2-4d06-8fc2-66ecabf4a8ee/image.png)

여기서 같은 리전에 있는 SQS와 람다의 경우 전송 비용 자체는 없다. (사이에 발생하는 데이터 전송 요금은 다른 리전이나 인터넷을 경유하는 경우)

예를 들어 SQS의 경우 SNS에 메시지를 Publish 하면 큐로 메시지가 전달되는 요금은 없고, SNS 메시지 Publish 비용(API 요청)은 발생하게 되는 것이다.

이메일의 경우 10만개당 2$가 청구된다.

그리고 필터 정책도 요금이 발생하는데, 메시지 속성을 바탕으로 한 필터 정책은 요금이 발생하지 않는다.

다만 페이로드 기반 필터 정책은 요금이 발생하는데, 아래와 같다.

![](https://velog.velcdn.com/images/yulmwu/post/91607ad5-e8e0-411d-964c-3cb2e5bcdc26/image.png)

여기서 스캔한 페이로드의 데이터는 곧 SNS에 보내지는 모든 메시지들의 페이로드를 의미하고, 서울 기준으로 GB 당 0.11$가 발생한다. (그래서 메시지 속성 기반의 필터 정책을 사용하는 것을 추천한다.)

만약 월 별로 2백만개의 메시지가 있고 개당 메시지의 크기는 128KB, 필터 정책은 하나가 있다고 가정한다면 아래와 같이 요금을 계산할 수 있다.

- 스캔량 = $2000000 × 128KB = 256GB$
- 요금 = $256 × 0.11\$ = 28.16\$$

이렇게만 보면 비싸보일 수 있는데, 일단 메시지의 크기가 큰 편이고 메시지 속성 기반의 필터 정책을 사용하면 무료이기 때문에 참고하길 바란다.

아까 예시에서 단순 라우팅(`type` = `order.created` 등)의 목적이라면 메시지 속성 기반의 필터 정책을 사용하는 것이 훨씬 유리하다.

끝.
