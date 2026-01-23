---
title: "[Kafka Producer] About Producer's Message Delivery Time "
description: 'Kafka 프로듀서의 send(ProducerRecord) 호출 부터 브로커의 응답까지의 전송 시간에 대하여'
slug: '2025-12-01-kafka-producer-message-delivery-time'
author: yulmwu
date: 2025-12-01T01:34:12.283Z
updated_at: 2026-01-22T02:38:56.774Z
categories: ['Data Streaming']
tags: ['kafka']
series:
    name: Data Streaming
    slug: data-streaming
thumbnail: ../../thumbnails/data-streaming/kafka-producer-message-delivery-time.png
linked_posts:
    previous:
    next: 2025-12-01-flink-late-event-handling
is_private: false
---

# 0. Overview

필자가 Kafka를 사용하면서 협업에 있어 주로 Producer 쪽을 다루는데, 다른 팀원들의 이러한 Producer에서 브로커까지의 메세지 전달에 대해 이해력이 부족하다고 생각하여 포스팅을 쓰게 되었다.

프로듀서를 중점으로 다루는 포스팅이지만 Kafka를 전반적으로 이해하는데 있어 중요한 개념과 관련 옵션이 포함되어 있기 때문에, 이해하고 넘어가는 것이 좋다고 생각한다.

# 1. Message(Record) Batch

먼저 설명하기 앞서, Kafka Producer에선 브로커에 메시지를 보낼 때 메시지 하나하나를 보내지 않고 여러 메시지를 묶어 배치 형태로 브로커로 전송한다.

이때 Producer의 동작은 아래와 같다.

![](https://velog.velcdn.com/images/yulmwu/post/7cfa6cc4-eb43-403f-aeed-9035e5b02ea1/image.png)

먼저 Kafka Producer가 위치한 애플리케이션에서 `send()` 함수를 통해 ProducerRecord 객체에 토픽과 키(옵션), 값을 넣고 보내면 첫번째로 카프카가 처리할 수 있도록 하는 바이트의 배열로 Serializing이 된다.

그리고 Partitioner를 거쳐 적절한 파티션에 배치되도록 파티션을 지정하고, 이러한 메시지는 Record Batch, 즉 Record Accumulator라는 내부적인 버퍼에 저장되는데, 옵션에 따라 gzip, snappy, lz4, zstd와 같은 메시지 압축이 가능하기도 하다.

이렇게 모인 Record들은 ProduceRequest 객체에 포함되어 배치로 Kafka 브로커로 전송된다.

(ack 옵션을 1이라고 가정) 만약 Broker에 성공적으로 보내지고 토픽의 파티션에 저장되었다면 Producer 애플리케이션으로 응답이 반환되고, 실패했다면 에러가 재시도 시 해결이 가능할 수 있는 경우(예: 리더 재선출) `retires` 옵션 만큼 재시도한다. (`retires > 0`)

# 2. Message Delivery Time

첫번째 차례에서 Producer에서 브로커까지의 처리 과정을 살펴보았다면, 다음으로 Producer에 설정할 수 있는 몇가지 옵션과 해당 옵션이 미치는 영향에 대해 다뤄보겠다.

이는 Kafka가 성공적인 응답을 보낼때 까지 대기하거나 재시도, 또는 실패를 받아들이는 시간에 영향을 끼치는 옵션들인 것이다. _(포스팅에선 아래 다이어그램에 포함된 옵션만 간단하게 다루겠다.)_

![](https://velog.velcdn.com/images/yulmwu/post/ffe811e9-3397-4a24-9b77-f33126164181/image.png)

먼저 `send()`를 호출한 시점부터 리턴이 될때까지 해당 스레드가 블록되고, 리턴이 되었다면 Kafka의 응답을 받을 때 까지(즉 콜백이 호출될 때 까지) 걸리는 시간이 발생하게 된다.

## 2-1. `max.block.ms` and `linger.ms`

![](https://velog.velcdn.com/images/yulmwu/post/a852fe24-d3a8-465b-9779-13212fc51d89/image.png)

먼저 `max.block.ms` 옵션은 `send()` 함수를 호출했을 때 Record Accumulator 버퍼에 공간이 없다면 대기, 또는 메타데이터를 가져올 때 까지 대기하는데 이러한 대기 시간에 대한 타임 아웃을 지정한다.

만약 이를 초과한다면 `send()` 메서드 자체에서 예외가 발생하게 된다.

그리고 `linger.ms`와 다이어그램엔 포함하지 않았지만 `batch.size` 옵션이 있는데, `linger.ms`는 Kafka Producer가 메시지를 묶어 배치 형태로 보내기 위해 대기하는 최대 시간이다.

여기서 "최대"라는 단어를 선택한 이유는 이 옵션 말고 다른 옵션도 이러한 대기 시간에 영향을 미친다는 뜻으로, `batch.size`라는 옵션은 이름에서도 유추할 수 있듯이 배치의 최대 사이즈(바이트)를 지정하고, 이를 초과할 경우 즉시 배치가 Kafka 브로커로 전송된다.

_(이 외에도 어떠한 이유로 배치에 대한 백그라운드 스레드에서 Flush가 발생했을 경우에도 배치가 전송될 수 있다.)_

## 2-2. `request.timeout.ms`

![](https://velog.velcdn.com/images/yulmwu/post/1081c0bc-5b0a-441a-854b-ff6722763934/image.png)

이 옵션은 Producer가 데이터(배치)를 전송한 "뒤" 서버로 부터 응답을 받기 위해 얼마나 기다릴지를 지정하는 옵션이다. 즉 앞선 실제 전송 이전에 소요되는 시간과 설명할 재시도 등은 포함하지 않는다.

`ack` 옵션이 0일 경우 응답을 받지 않는, 즉 Fire and Forget 방식이기 때문에 이 시간은 무의미하다. 만약 이때 타임아웃이 발생한다면 아래의(#2-3) 옵션에 따라 재시도 되거나 타임아웃 예외와 함께 콜백을 호출한다.

여기서 In-Flight Requests 라는 용어가 등장하는데, 이는 아직 브로커의 응답을 받지 못한 요청, 즉 아직 응답을 대기중인 Producer 요청을 의미한다.

다른 용어로 Outstanding Requests(대기중인 요청)라고도 하고, 추후 살펴볼 `max.in.flight.requests.per.connection` 옵션이 직접적으로 관여한다.

## 2-3. `retries` and `retry.backoff.ms`

![](https://velog.velcdn.com/images/yulmwu/post/34617fbb-fd61-4f74-8074-7b751484fc5c/image.png)

앞서 언급한 듯 만약 In-Flight 요청에 대해 에러를 받게 되었는데, 이것이 일시적인(Transient) 오류(예시로 Timeout/Network 오류나 리더 브로커의 다운타임 등이 해당됨)일 경우 판단하게 재시도(재전송)를 할 수 있다.

_(여기서 일시적인 오류는 메시지의 최대 크기를 초과하는 등의 오류는 해당하지 않는다.)_

이때 `retries` 옵션이 이러한 재시도(재전송) 횟수를 지정하고(기본값은 무한이다), 이마저도 넘기게 된다면 예외와 함께 콜백이 호출된다.

`retry.backoff.ms` 옵션은 이 재전송 간격을 조정하고, 기본 값은 100ms이다. 단 이 값들을 직접 조정하는 것 보단 아래의 `delivery.timeout.ms` 옵션을 증가시키는 방식으로 접근하는 것이 더욱 더 이득일 수 있다.

## 2-4. `delivery.timeout.ms`

![](https://velog.velcdn.com/images/yulmwu/post/52db2f4c-f0f6-4ff8-9113-c1cdf965e27d/image.png)

마지막으로 이 옵션은 `send()` 비동기 함수가 성공적으로 리턴되었고, 레코드가 배치에 저장되며 브로커의 응답을 대기하는 전체 시점을 나타내는 것으로, 즉 `linger.ms` 및 `request.timeout.ms`를 포함하며, 재시도(재전송)을 고려하여 이들보다 큰 값을 가져야 한다.

만약 이 옵션을 초과하게 된다면 마찬가지로 타임아웃과 같은 예외와 함께 콜백이 호출된다.

## 2-5. `max.in.flight.requests.per.connection`

다이어그램엔 없지만, 이 옵션도 Producer의 동작에 있어 매우 중요한 옵션 중 하나이다.

이 옵션은 In Flight, 즉 아직 응답을 받지 못한 상태에서 하나의 TCP 커넥션을 통해 보낼 수 있는 최대 배치 요청의 수를 의미하며, 즉 응답을 받기 전 동시에 보낼 수 있는 최대 요청의 수를 의미한다.

이 옵션을 늘리면 더욱 더 많은 요청을 보낼 수 있어 높은 처리량을 기대할 수 있지만 그 만큼 메모리 사용량도 증가하는 트레이드 오프가 있다. (보통 2~5 정도로 설정함)

이 옵션의 `max.in.flight.requests.per.connection > 1`일때 경우 순서가 배치의 보장되지 않을 수 있고 멱등성의 문제가 발생할 수 있는데, 아래와 같은 상황을 예로 들어보자.

```js
Batch A (seq=0) -> 전송됨 (ack 대기 중)
Batch B (seq=1) -> 전송됨 (ack 대기 중)
```

그러나 이 과정에서 네트워크 문제로 인해 Batch A가 유실되었고, Batch B는 정상적으로 Kafka 브로커에 저장되고 ack 응답을 받았다고 치자.

이때 Kafka Producer는 Batch A에 대해 실패를 했다고 판단, 때문에 Batch A에 대해 재전송이 되었다. (`retries > 0`)

결론적으로 Kafka 브로커엔 `B, A` 형태와 같이 저장될 수 있는 것이다. 또한 Batch A가 브로커에 저장은 되었으나 응답 과정에서 유실되었다면 그 또한 재전송을 할 수 있기 때문에 `A, B, A`와 같이 멱등성의 문제가 발생할 수 있다.

(같은 키를 가지고 파티션 수의 변화가 없다고 가정했을 때) 순서의 보장은 `max.in.flight.requests.per.connection = 1`로 설정하고(다만 성능 저하가 있을 수 있음) 멱등성은 `enable.idempotence` 옵션을 `true`로 설정하면 된다. (Kafka 3.x 부터 기본 값)

`enable.idempotence` 옵션을 활성화하게 되면 동일한 Producer ID와 배치에 대한 Sequence Number(seq)를 부여하여 중복이 발생하는 경우 이를 Drop 한다. (단 B가 A보다 먼저 도착할 경우는 Kafka에서 A가 먼저 도착할 수 있도록 보장한다)

`enable.idempotence` 옵션에 대해선 추후 멱등성과 관련하여 따로 포스팅으로 다뤄보도록 하겠다. 그리고 `enable.idempotence=true` 일 때 멱등성 보장의 안정성을 위해 `max.in.flight.requests.per.connection`를 최대 5로 제한한다. 이 또한 추후 포스팅에서 다뤄보도록 하겠다.

---

이상으로 Kafka Producer에서 메시지(Record)를 보낼 때의 과정과 그 사이 발생하는 시간, 관련 옵션들에 대해 다뤄보았다.

얕게 다뤄보았지만 Kafka Producer의 기본적인 동작 과정이기 때문에 따로 포스팅하였다. 사실 세부적인 설정을 할게 아니라면 기본 값 그대로 사용해도 무방하긴 하다. 오히려 잘 모르는 상태에서 만졌다고 그에 따른 트레이드 오프가 심하게 발생할 수 있다.
