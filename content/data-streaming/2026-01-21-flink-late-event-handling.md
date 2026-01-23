---
title: '[Flink] Late Event Handling with WatermarkStrategy and Allowed Lateness'
description: 'Flink Late Event 완화/핸들링을 위한 WatermarkStrategy 전략과 Allowed Lateness 옵션'
slug: '2026-01-21-flink-late-event-handling'
author: yulmwu
date: 2026-01-21T12:45:55.620Z
updated_at: 2026-01-23T04:30:54.050Z
categories: ['Data Streaming']
tags: ['flink']
series:
    name: Data Streaming
    slug: data-streaming
thumbnail: ../../thumbnails/data-streaming/flink-late-event-handling.png
linked_posts:
    previous: 2026-01-21-kafka-producer-message-delivery-time
    next:
is_private: false
---

# 0. Overview

데이터 스트림을 처리(Stream Processing)하는 애플리케이션이나 플랫폼(대게 Apache Flink 등), 에서 중요한 것은 시간(Timing)이지 않을까 싶다.

단순한 배치 처리(Batch Processing)에선 정확한 결과를 어렵지 않게 예상할 수 있는데, 입력되는 데이터가 고정적이며 배치 내의 이벤트는 순차적인 형태를 가지기 때문에 설계 원칙 상 결정론적인(Deterministic) 구조를 가져야한다.
(다만 항상 그런 것은 아니다. 여러 비결정론적인 변수로 인해 실제 구현 시 그 결과가 달라질 수 있다.)

하지만 **스트림 처리**(**Stream Processing**)를 다룬다면 이야기가 달라지는데, 처리에 이용되는 입력 데이터가 무한하고(Unbounded) 이벤트는 비순차적인 **Out of order** 이벤트 또는 일부 이벤트는 지정된 시간보다 늦게 도착하는 **Late Event(Data)**가 충분히 발생할 수 있다.

스트림을 처리할땐 일반적으로 정확성을 요구하기 위해 후술할 이벤트의 실제 발생 시간(**Event Time**)을 기준으로 처리되는데, 이 경우 앞서 이야기한 Out of order나 Late Event로 인한 문제가 발생할 수 있다.

---

예를 들어 1분 단위로 윈도우를 집계(Window Aggregation)하는 결제 서비스가 있다고 가정해보자. 10:00:30에 발생한 이벤트는 10:00에 시작된 윈도우에 포함되었어야 하지만, 네트워크 문제로 인해 10:01:10에 도착했다.

이 경우 이미 10:00에 시작된 윈도우는 10:00:59에 종료되어 집계를 끝낸 상태이다. 이로 인해 실제 매출보다 집계 금액이 더 적게 계산되기 때문에, 적절한 시간 제어 전략이 없다면 잘못된 정산 처리나 잘못된 리포트가 보고될 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/ff2dd33c-20c8-4742-9881-4d2e6349e867/image.png)

이러한 문제를 해결하고자 Flink에서는 WatermarkStrategy의 `forBoundedOutOfOrderness`와 Allowed Lateness 등으로 완화할 수 있다. (여기서 '완화'라는 표현한 이유는 이 개념들을 도입하였을때 Late Event가 실제 이벤트 발생 시간의 윈도우에 포함된다는 보장이 없기 때문이다. 아무리 허용 시간을 준다고는 하지만 그 사이의 레이턴시는 무한할 수 있기 때문이다.)

## Time Semantics

이 포스팅에서 서술할 내용은 가장 일반적으로 사용되는 **Event Time**을 기반으로 한다. 이러한 **Time Semantics**엔 **Event Time**을 제외하고도 **Processing Time**과 **Ingestion Time**이 존재한다.

**Event Time**은 이벤트가 발생한 실제 시간(Timestamp)를 의미하며, 모든 이벤트가 도착했다는 가정 하에 Out of order 혹은 Late Event가 발생하거나 과거의 데이터를 재처리하는 상황에서도 이벤트의 Timestamp를 기반으로 동작하여 기대대로 동작할 수 있다. 다만 이벤트의 순서를 보장하지 않기 때문에 후술할 Watermark 등으로 이를 완화한다.

예를 들어 이벤트 발생 시간 `eventTime` 멤버를 가지는 Event 객체를 DataStream으로 만들 때 아래와 같이 WatermarkStrategy를 지정한다면 Event Time 방식으로 해석할 수 있다.

```java
DataStream<Event> stream =
    env.fromSource(
        source,
        WatermarkStrategy
            .forBoundedOutOfOrderness(Duration.ofSeconds(5))
            .withTimestampAssigner((event, timestamp) -> event.eventTime),
        "source"
    );
```

**Processing Time**은 관점을 바꿔서 해당 처리를 처리하는 애플리케이션(TaskManager) 시점에서의 시간이다. 다만 Event Time과는 달리 분산/비동기 환경에서 결정성을 보장하지 못한다. 대신 TaskManager의 시스템 Timestamp를 사용하기 때문에 Watermark 등의 복잡한 구성을 필요로하지 않고, 레이턴시가 적어 즉시성을 요구하는 모니터링 메트릭 등에서 활용할 수 있다.

아래와 같이 Watermark를 지정하지 않을 경우(`noWatermarks()`) 기본적으로 Processing Time의 동작이 된다.

```java
DataStream<Event> stream =
    env.fromSource(
        source,
        WatermarkStrategy.noWatermarks(),
        "source"
    );
```

마지막 **Ingestion Time**은 앞선 Event Time과 Processing Time의 중간에 위치한 개념으로, 이벤트가 Flink의 source 연산자에 도착한 시점을 Timestamp로 할당한다. Event Time 보다는 단순하지만 네트워크 레이턴시 등의 변수로 실제 이벤트의 발생 시간과 어긋날 수 있고 의도와 의미가 개념적으로 불분명하기 때문에 사실상 Deprecated 또는 거의 사용하지 않는다.

Event Time과 Processing Time은 이벤트의 발생 시간(Timestamp)을 기반으로 하냐와 TaskManager의 시간을 기반으로 하냐의 차이 뿐만 아니라 Watermark(정확성과 재현성을 보장)를 통해 시간의 불확실성을 모델링하고 책임질 것인가에 대한 설계 철학의 차이이기도 하다.

# 1. Watermark

앞서 언급한 바 있고, 이 글을 읽는 독자라면 Watermark 정도는 이미 알고있는 사전지식이라 생각하겠다. 하지만 그럼에도 Watermark는 이 포스팅의 주제인 Late Event 핸들링을 위한 Allowed Lateness와 연관성이 매우 높으므로 설명하도록 하겠다.

**Watermark**는 스트림 내에서 관측된 Event Time을 기반으로 "이 시각 이전(Event Time <= T, T=Watermark)의 이벤트는 더 이상 고려하지 않겠다고 시스템이 판단하는 시점"을 나타내는 특수한 메타데이터이다.

따라서 Event Time <= T인 구간에 대해 윈도우를 닫고 집계되며, 만약 Event Time <= T인 이벤트라면 그 이벤트는 Late Event가 되는 것이다. 앞서 말하였듯 Out of order 등으로 인한 Late Event를 완화하고자 Watermark 개념을 사용한다.

## How does it work?

![](https://velog.velcdn.com/images/yulmwu/post/60aae107-1a81-4be1-8ad7-50f3b8baca52/image.png)

이러한 Watermark는 아래와 같은 공식으로 동작한다. (`out_of_orderness` = `forBoundedOutOfOrderness` 값)

```shell
current_watermark = max_event_time - out_of_orderness
```

그리고 윈도우는 아래의 조건을 만족하는 순간 트리거되어 집계(Aggregation)된다. (`window_end_time` = 윈도우의 주기를 기반으로 계산된 윈도우가 끝나는 시간)

```
window_end_time <= current_watermark
```

이렇게만 설명하자니 이해에 어려움이 있을 것 같아 몇가지 예시를 들어보겠다. 아래는 5분 간격의 Tumbling Window의 예시이다. (단, Out of order나 Late Event는 존재하지 않는 가상의 시나리오다.)

| 이벤트(Event Time) | max_event_time | watermark | window                          |
| ------------------ | -------------- | --------- | ------------------------------- |
| E1 (10:01)         | 10:01          | 10:01     | W1 `[10:00, 10:05)`             |
| E2 (10:02)         | 10:02          | 10:02     | W1 `[10:00, 10:05)`             |
| E3 (10:04)         | 10:04          | 10:04     | W1 `[10:00, 10:05)`             |
| E4 (10:06)         | 10:06          | 10:06     | W2 `[10:05, 10:10)`             |
| E5 (10:03)         | 10:03          | 10:06     | Late Event (Drop / Side Output) |

4번째(E4 10:06) 이벤트의 경우 공식에 따라 아래와 같이 계산된다.

```
max_event_time = 10:06
current_watermark = 10:06

W1.window_end_time = 10:05, current_watermark = 10:06 이므로
10:05 <= 10:06
```

때문에 조건을 만족한 W1 윈도우는 닫히고 트리거(Fire) 및 집계되며 E4는 W2에 포함된다. 하지만 마지막 이벤트 E5는 이미 W1가 닫힌 상태이기 때문에 Late Event로 Drop되거나 Side Output으로 보내진다.

즉 Event Time에서 윈도우는 윈도우 간격으로 스케줄링되는 것이 아닌 Watermark를 기반으로 동작하는 것이다. 때문에 Watermark는 파티션 기준 단조 증가(Monotonic Increase)로 동작한다.

만약 이벤트 시간이 10:05 이상의 이벤트가 오지 않는다면 윈도우는 지정한 주기가 지나도 닫히지 않을 수 있다. 이는 다음 이벤트로 인해 자동으로 닫히도록 될 수 있지만, 소스에서 주기적으로 이벤트를 발생시키거나 Idle Source 처리를 해야할 수 있다.

# 2. WatermarkStrategy

**WatermarkStrategy**는 Watermark의 방식을 정의한다. 대표적으로 이 포스팅에서 살펴볼 `forBoundedOutOfOrderness` 메서드를 호출할 수 있다. (WatermarkGenerator)

```java
WatermarkStrategy
	.<Event>forBoundedOutOfOrderness(Duration.ofSeconds(10))
```

이는 이 스트림에서는 이벤트가 최대 10초까지 뒤늦게 도착할 수 있다고 가정하고 여유 시간을 만든다. 즉 아까 언급하였던 공식에서 `out_of_orderness`(=`forBoundedOutOfOrderness`)가 포함되었던 것이다.

```
current_watermark = max_event_time - out_of_orderness
```

마찬가지로 아까와 같은 5분 간격의 Tumbling Window에 `out_of_orderness = 2m`으로 설정했다고 가정하여 예시를 보자.

| 이벤트(Event Time) | max_event_time | watermark | window              |
| ------------------ | -------------- | --------- | ------------------- |
| E1 (10:04)         | 10:04          | 10:02     | W1 `[10:00, 10:05)` |
| E2 (10:06)         | 10:06          | 10:04     | W2 `[10:05, 10:10)` |
| E3 (10:03)         | 10:06          | 10:04     | W1 `[10:00, 10:05)` |
| E4 (10:07)         | 10:07          | 10:05     | W2 `[10:05, 10:10)` |

E2에선 10:06의 이벤트가 왔지만 `out_of_orderness = 2m`로 설정해두었기 때문에 `current_watermark`는 10:04가 된다. 때문에 W1는 닫히지 않고(트리거/Fire 되지 않고) 계속된다.

다음으로 E3는 Out of order 이벤트지만, 아직 W1가 이벤트를 받을 수 있기 때문에 E3는 W1에 집계된다.

마지막으로 Event Time 10:07(E4)의 이벤트가 발생한다면 `W1.window_end_time = 10:05, 10:05 <= 10:05` 조건으로 인해 W1는 트리거되어 집계된다. (Watermark가 `window_end_time` 이상이 되는 순간, 해당 윈도우는 트리거되고 집계됨)

## Flink Example

아래와 같은 이벤트 객체가 있다고 가정해보자. 가장 핵심적인 부분이 `eventTime` 멤버이다.

```java
public static class Event {
    public final String name;
    public final long eventTime;

    public Event(String name, long eventTime) {
        this.name = name;
        this.eventTime = eventTime;
    }
}
```

위 이벤트에 대한 임의의 소스 스트림을 아래와 같이 하드코딩하였다. 실제로는 Kafka 등의 스트리밍 플랫폼으로 부터 소스를 받을 것이다.

```java
DataStream<Event> sourceStream = env.fromElements(
    new Event("E1", ts("10:04")),
    new Event("E2", ts("10:06")),
    new Event("E3", ts("10:03")),
    new Event("E4", ts("10:07"))
);
```

이를 `fromElements`으로 하드코딩할 경우 즉시 Emit되는 특성이 있기 때문에 아래와 같이 `SourceFunction<Event>`를 구현하여 소스를 만들었다.

```java
public static class TestSource implements SourceFunction<Event> {
    private volatile boolean running = true;

    @Override
    public void run(SourceContext<Event> ctx) throws Exception {
        emit(ctx, "E1", "10:04");
        Thread.sleep(1000);

        emit(ctx, "E2", "10:06");
        Thread.sleep(1000);

        emit(ctx, "E3", "10:03"); // out of order
        Thread.sleep(1000);

        emit(ctx, "E4", "10:07");
        Thread.sleep(1000);

        emit(ctx, "WM", "10:20"); // W2 Trigger를 위한 Watermarking 용도
        Thread.sleep(1000);

        while (running) {
            Thread.sleep(1000);
        }
    }

    private void emit(SourceContext<Event> ctx, String id, String time) {
        ctx.collect(new Event(id, ts(time)));
    }

    @Override
    public void cancel() {
        running = false;
    }
}
```

그리고 이번 주제의 핵심인 Bounded Out of order는 아래와 같이 구성할 수 있다.

```java
StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
env.setParallelism(PARALLELISM);

DataStream<Event> sourceStream = env.addSource(new TestSource());

DataStream<Event> withWatermarks = sourceStream.assignTimestampsAndWatermarks(
    WatermarkStrategy
        .<Event>forBoundedOutOfOrderness(Duration.ofMinutes(2))
        .withTimestampAssigner((event, ignored) -> event.eventTime)
);

DataStream<String> windowedResult = withWatermarks
    .windowAll(TumblingEventTimeWindows.of(Time.minutes(5)))
    .process(new WindowCollector()) // 따로 설명하진 않겠다. ProcessAllWindowFunction를 상속받은 간단한 클래스이다.
    .returns(Types.STRING);

windowedResult.print();
```

이에 대한 실행 결과는 아래와 같다. 위에서 예시로 들었던 결과와 동일하게 윈도우가 집계되는 것을 확인해볼 수 있다.

```
window [1672567200000 ~ 1672567500000] -> [E1, E3]
window [1672567500000 ~ 1672567800000] -> [E2, E4]
```

만약 `forBoundedOutOfOrderness`를 `Duration.ZERO`로 설정한다면 어떻게 될까? Bounded Out of orderness가 0 이므로 예상과 같이 E3는 Drop 된다.

```
window [1767261600000 ~ 1767261900000] -> [E1]
window [1767261900000 ~ 1767262200000] -> [E2, E4]
```

# 3. Allowed Lateness

기존의 Late Event는 즉시 Drop하거나 Side Output으로 보내졌었다. 하지만 Flink의 **Allowed Lateness**는 Watermark가 이미 윈도우의 종료 시점을 지났더라도 Late Event를 해당 윈도우에 반영해주는 옵션이다. (기본값은 0이기 때문에 윈도우 끝을 지난 Late Event는 Drop되거나 Side Output으로 보내진다.)

즉 Watermark가 `window_end`를 지났더라도 `window_end + allowed_lateness` 까지 들어온 이벤트는 해당 윈도우에 다시 반영되어 해당 윈도우는 state에 누적 반영되어 다시 트리거된다. 즉 Allowed Lateness 기간동안 윈도우의 State를 유지하기 때문에 윈도우가 완전히 정리(Cleanup)되는 시간이 Allowed Lateness 기간 만큼 증가한다.

![](https://velog.velcdn.com/images/yulmwu/post/bc31bdf0-8135-4717-af4a-9901df63bd07/image.png)

(윈도우의 라이프사이클을 다루기엔 블로그의 주제를 벗어날 것 같아 아래의 공식 문서로 대체한다.)

- https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream/operators/windows/#window-lifecycle

이렇듯 Allowed Lateness를 과도하게 늘릴 경우 RocksDB State 증가, JVM Heap GC 증가, Checkpoint로 인한 Backpressure 등의 성능 문제가 될 수 있다. 이는 다운스트림 시스템을 운영할 때 복잡성 등의 문제가 될 수 있을 것이다.

특히나 Sink에서의 Allowed Lateness는 Exactly Once 처리 보장과 의미적으로 충돌할 수 있다. 윈도우의 결과가 시간에 따라 여러번 Emit 되면 다운스트림이 Idempotent 하지 않거나 외부 Side Effect가 발생하는 등의 문제가 있을 수 있다.

이러한 부분을 고려하여 Late Event에 대한 처리를 WatermarkStrategy의 Bounded Out of orderness 전략을 사용하거나 Side Output 전략을 도입해볼 수 있을 것이다.

```java
OutputTag<Event> lateDataTag = new OutputTag<Event>("late-data"){};

DataStream<Event> withWatermarks = sourceStream.assignTimestampsAndWatermarks(
    WatermarkStrategy
        .<Event>forBoundedOutOfOrderness(MAX_OUT_OF_ORDERNESS)
        .withTimestampAssigner((event, ignored) -> event.eventTime)
);

SingleOutputStreamOperator<String> windowedResult = withWatermarks
    .windowAll(TumblingEventTimeWindows.of(WINDOW_SIZE))
    .allowedLateness(Time.minutes(2))
    .sideOutputLateData(lateDataTag)
    .process(new WindowCollector())
    .returns(Types.STRING);

windowedResult.print();

windowedResult.getSideOutput(lateDataTag)
    .map(event -> String.format("Dropped (Side Output): %s", event))
    .print();
```

# 4. Conclusion

지금까지 Out of order나 Late Event로 인한 문제를 완화하고자 WatermarkStrategy 전략이나 Allowed Lateness에 대해 설명하였다.

철학적으로 본다면 단순히 API 옵션이 아니라 "시간의 불확실성을 어디까지 시스템이 책임질 것인가"에 대한 선언에 가깝지 않나 생각한다. 실제로 도입이나 설계 시 각 옵션들에 대해 상황에 맞게 트레이드오프를 고려하여 사용해야 할 것이다.

이 포스팅에서 사용한 예시는 WatermarkStrategy 전략과 Allowed Lateness 옵션의 사용 예시 정도로만 이해하면 좋을 것 같아. 가장 베스트한 예제는 실제로 Kafka 등의 스트리밍 소스를 붙이고 시간 간격을 두어 실제 환경을 재현하는 것이지 않나 싶다.
