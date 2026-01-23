---
title: '[AWS Streaming] UI/UX Click Heatmap with AWS KDS, MSF, Glue, and Athena Pipeline'
description: 'AWS Kinesis Data Streams, Flink, Glue 및 Athena를 통한 UI/UX 클릭 히트맵 파이프라인 구축하기 (PoC/MVP)'
slug: '2025-12-28-aws-click-heatmap-with-kds-msf-glue-athena'
author: yulmwu
date: 2025-12-28T10:51:06.968Z
updated_at: 2026-01-23T01:31:41.243Z
categories: ['AWS']
tags: ['aws']
series:
    name: AWS
    slug: aws
thumbnail: ../../thumbnails/aws/aws-click-heatmap-with-kds-msf-glue-athena.png
linked_posts:
    previous: 2025-12-28-aws-appsync-graphql-serverless
    next: 2025-12-28-aws-cloudfront-lambda-image-resizing
is_private: false
---

> 본 포스팅에선 실습을 위한 애플리케이션 및 (필요 시) Terraform 코드를 아래의 깃허브 레포지토리에서 제공한다. (단, 이 포스팅에선 Terraform을 사용하지 않고 AWS 콘솔을 통해 리소스를 생성해볼 것이다.)
>
> https://github.com/yulmwu/aws-click-heatmap-demo

# 0. Overview

필자는 프론트엔드 개발자도 아니고 그쪽 분야로 관심이 있는 것 또한 아니다. 하지만 작은 팀이나 1인 개발 시 어쩔 수 없이 접해야 하고, 또한 최종적으로 실 사용자들에게 보여지는 분야 중 하나이기 때문에 최소한의 학습을 해야 하는 분야가 아닌가 싶다.

팀에서 최근 얼떨결에 프론트엔드와 UI/UX를 담당할 새로운 팀원과 함께하게 되었는데, 여러 이야기를 나눠보던 중 *"UX 개선을 위해 히트맵을 구현해보자."*라는 의견을 나누게 되었다.

---

![](https://velog.velcdn.com/images/yulmwu/post/253194c3-ea04-481d-91fb-c22995c4b8a6/image.png)

---

그리고 이 포스팅에서는 Kafka 대신 AWS의 데이터 스트리밍 플랫폼인 **KDS*(Kinesis Data Streams)***와 AWS에서 매니지드로 관리하는 Flink인 **MSF*(AWS Managed Service for Apache Flink)***, S3 쿼리를 위한 **Glue** 및 **Athena**를 사용하여 PoC/MVP 정도의 페이지 클릭 히트맵을 구현해볼 것이다. 최종적으로 확인해볼 수 있는 히트맵은 아래와 같다.

![](https://velog.velcdn.com/images/yulmwu/post/a3da04bd-7e9c-4969-8595-b67a6a3b6014/image.png)

> 이 포스팅에선 AWS 인프라를 다루며, 클릭 시 데이터가 Kinesis Data Streams에 쌓이도록 하는 애플리케이션(이하 **Click Producer**)과 Athena 쿼리 결과를 응답 받아 히트맵을 렌더링하는 애플리케이션(이하 **Heatmap Viewer**)에 대한 소스코드 설명은 하지 않는다.
>
> 다만 환경 변수 설정 및 빌드/실행 방법만 기술하고, 자세한 소스코드는 제공된 깃허브 레포지토리를 참고하자. PoC 수준이기 때문에 프로덕션 환경에서는 사용하지 않는 것을 극히 권장한다.

# 1. AWS Architecture

이 포스팅에서 구현해볼 AWS 아키텍처는 아래와 같다. 필자가 설계한 아키텍처라 Best Practice는 아닐 수 있지만, 주어진 상황에 가장 적합하다고 생각되었다.

![](https://velog.velcdn.com/images/yulmwu/post/fb9c9367-96a5-4de3-917f-5da36b762ef6/image.png)

---

아키텍처의 흐름은 아래와 같다. 각 서비스의 자세한 내용은 추후 다시 다루도록 하겠다.

1. Click Producer가 AWS Kinesis SDK `PutRecordCommand`를 통해 **Kinesis Data Streams(KDS)**에 레코드를 보낸다. **(A)**
2. Kinesis Data Streams는 2가지 서비스와 연결되는데, **MSF** 및 **Kinesis Data Firehose**로 파이프라인이 이어진다. **(B)**

## (A) Kinesis Data Firehose

**Kinesis Data Firehose**는 Raw 데이터, 즉 Kinesis Data Streams로 부터 데이터를 컨슈밍하여 원본(Raw) 그대로를 S3에 저장한다. 이때 S3를 데이터 레이크로 사용하는 아키텍처인 것이다.

현재 아키텍처에선 Raw 데이터를 그대로 저장하는 것 외엔 Firehose를 Buffering, Lambda Transform 등의 다른 용도로 사용하지는 않는다.

![](https://velog.velcdn.com/images/yulmwu/post/11dfa2b9-1892-4544-87f0-7d0028800761/image.png)

> 추가적으로, 이 포스팅에선 MSF와 Firehose가 동일한 샤드의 읽기 용량을 나눠쓰는 Shared Throughput 방식을 사용하고, 규모가 커질 경우 EFO(Enhanced Fan-Out)를 고려해볼 수 있다.

추가적으로, 이 포스팅에선 KDS의 기본 커슈밍 모델인 **Shared Throughput**(기본 2MB/s 읽기) 방식을 사용한다. 즉 MSF와 Firehose가 동일한 샤드의 읽기 처리량을 공유하며 데이터를 컨슈밍하는데, 트래픽 규모가 커질 경우 **Enhanced Fan-Out(EFO)**를 고려해볼 수 있다.

## (B) Amazon Managed Service for Apache Flink

**MSF(Amazon Managed Service for Apache Flink)**는 Raw 데이터를 큐레이션한다. (이때 Window, S3 FileSink, ParquetWriter 등의 기능이 사용된다. 이는 추후 따로 다루겠다.)

MSF(Flink)를 거친 큐레이션된 데이터는 Raw 데이터와 마찬가지로 S3(데이터 레이크) 버킷에 저장된다. 아키텍처에선 옵션으로 DynamoDB를 Flink 다음으로 붙였는데, 이는 실시간 처리를 위함이다.

![](https://velog.velcdn.com/images/yulmwu/post/be55329f-0126-463f-af50-4fbfcd1af89d/image.png)

이때의 Flink 애플리케이션이 특정 주기(`TumblingProcessingTimeWindows`, 1분으로 지정)마다 데이터를 Window로 나눠 추후 S3 Athena 쿼리 시 특정 시간을 범위로 하는 쿼리문을 작성해볼 수 있다. (본 예제에서는 Event Time 기반 Tumbling Window를 사용하며, Late Event 및 Watermark 처리는 단순화를 위해 고려하지 않았다.)

또한 원본에서는 프론트엔드의 뷰포트가 전부 다르기 찍히기 때문에, 이를 특정 크기의 Grid(20x20으로 지정)로 변환하여 히트맵 뷰어에서 처리한다. (단, 이 동작은 구현하기 나름이다. 필자는 이러한 방식으로 구현했지만, 실제 Flink 애플리케이션은 다를 수 있다.)

마지막으로 MSF(Flink) 애플리케이션은 S3 버킷에 데이터를 저장하고(FileSink), Athena 분석에서 최적화를 위해 Parquet 포맷으로 저장한다. (ParquetWriters)

> **Parquet 포맷**은 주로 빅데이터, 하둡 생태계에서 많이 사용하는 컬럼 기반의 파일 포맷이다.
>
> 행(Row)이 아닌 열(컬럼) 단위로 저장하기 때문에 압축 효율이 높고, 쿼리를 통한 분석 시 데이터 처리 성능에 대해 최적화 할 수 있다.
>
> 대부분의 다양한 처리 엔진 및 분석 서비스에서 호환되는데, AWS Athena 및 Glue에서도 호환되는 포맷이기 때문에 사용하였다.

이렇게 큐레이션된 데이터가 Curated S3 버킷에 저장이 되었다면, **AWS Glue Crawler**를 통해 Athena를 위한 테이블 스키마와 파티션 정보를 Glue Data Catalog로 만든다. (Curated S3엔 `dt='yyyy-MM-dd'/hour='HH"` 형태로 저장됨)

Glue Crawler를 통해 자동으로 테이블의 스키마를 알 수 있고, 파티션(S3 디렉토리 경로)을 자동으로 찾을 수 있다. Glue는 30분 간격으로 스케쥴을 설정하여 스키마 및 파티션 정보를 Catalog로 생성할 수 있도록 한다.

마지막으로 **Athena**는 Glue를 통해 생성된 테이블의 스키마를 활용하여 Curated S3 버킷을 분석 한다. (쿼리) 쿼리 결과는 Athena Results S3 버킷에 따로 저장되며, 최종적으로 이 버킷에 저장된 쿼리 결과를 Heatmap Viewer 애플리케이션에서 화면에 렌더링한다. (단, 실시간 처리를 위함이라면 이 아키텍처 보다는 DynamoDB, Redis 등을 사용하여 서빙 스토어를 구축하는 것이 더 이득일 수 있다.)

---

설명을 길게 하였는데, 각 서비스의 자세한 동작 과정 등은 아키텍처를 구현하면서 개별적으로 설명하도록 하고 다음으로 아키텍처를 구현해보도록 하겠다.

# 2. Demo

실습에선 컴퓨팅 기능을 사용하지 않고, 매니지드 + 서비리스 조합으로 구성을 하였다. 이 중 Kinesis Data Streams (KDS)는 샤드 단위 시간으로 과금되고, Managed Service for Apache Flink (MSF)는 애플리케이션(Job)이 실행되는 시간 만큼 과금이 되므로 실습 시 요금 발생에 주의하길 바란다.

![](https://velog.velcdn.com/images/yulmwu/post/fb9c9367-96a5-4de3-917f-5da36b762ef6/image.png)

## (1) S3 Bucket

버킷의 이름은 다음과 같다. 중복이 되면 안되니 겹친다면 변경하도록 하자.

- Raw S3 Bucket: `heatmap-demo-raw-1230`
- Curated S3 Bucket: `heatmap-demo-curated-1230`
- Athena Results S3 Bucket: `heatmap-demo-athena-results-1230`

![](https://velog.velcdn.com/images/yulmwu/post/f60a7f2f-39a1-4e28-87ec-a76f12789707/image.png)

---

![](https://velog.velcdn.com/images/yulmwu/post/c725b00e-6bb7-4286-88c8-134b08450e8e/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/ec6983d1-aba5-4c3e-8933-a4eef0ad6e91/image.png)

그 외의 구성은 따로 하지 않아도 된다. S3 버킷에 접근할 땐 IAM 정책을 구성하여 접근할 것이다.

## (2) Kinesis Data Streams

![](https://velog.velcdn.com/images/yulmwu/post/c85121f8-bc2a-4da8-9d6f-d15b4f14e3ee/image.png)

Kinesis Data Streams는 앞서 말했 듯 EFO를 구성하지는 않겠다. 다만 필요 시 구성하면 될 것이다. 또한 프로비저닝 모드 시 샤드 별로 활성화 시간으로 요금이 청구되니 참고하자.

![](https://velog.velcdn.com/images/yulmwu/post/8b616e35-4f3c-4620-b3e0-d4512e25b940/image.png)

---

![](https://velog.velcdn.com/images/yulmwu/post/04343cbb-acfc-414b-a3a2-ce56d1516f62/image.png)

필요에 따라 용량 모드로 가변적으로 동작하는 온디맨드를 선택할 수 있지만, 트래픽 양이 일정하다면 프로비저닝 모드가 더 이득일 수 있다. 필자는 프로비저닝 모드에 샤드의 수는 1개로 구성하도록 하겠다.

![](https://velog.velcdn.com/images/yulmwu/post/9ff0171f-4fac-4474-afe3-7837f5bff697/image.png)

그 외의 옵션은 따로 설정하지 않겠다. Retention 기간 변경 등은 위와 같이 KDS가 활성화된 뒤 변경할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/215f801d-82fd-421e-a3bb-2eea2e7bbabb/image.png)

## (3) Kinesis Data Firehose

![](https://velog.velcdn.com/images/yulmwu/post/bc63c34d-88e0-407d-b349-e67914ee408c/image.png)

### IAM Role

현재 아키텍처에서 Kinesis Data Firehose는 S3 버킷 Write 권한과 Kinesis Data Streams에 대한 Read 권한이 필요하다.

먼저 역할을 만드는데, 엔티티 유형은 AWS 서비스 — Firehose로 선택하고, 권한 추가는 넘어가자. 역할 이름은 `heatmap-demo-firehose-role`로 설정하였다. 신뢰 정책은 아래와 같다.

```yaml
{
    'Version': '2012-10-17',
    'Statement':
        [{ 'Effect': 'Allow', 'Principal': { 'Service': 'firehose.amazonaws.com' }, 'Action': 'sts:AssumeRole' }],
}
```

![](https://velog.velcdn.com/images/yulmwu/post/718e5d23-5942-4296-a2b9-284938ef98a1/image.png)

그리고 역할에 붙일 아래와 같은 정책을 만들 것이다. 여기서 `<...>` 안의 내용은 본인이 구성한 서비스 이름에 맞게 수정해야 한다. 정책 이름은 `heatmap-demo-firehose-policy`이다.

```yaml
{
    'Version': '2012-10-17',
    'Statement':
        [
            {
                'Sid': 'S3Write',
                'Effect': 'Allow',
                'Action':
                    [
                        's3:AbortMultipartUpload',
                        's3:GetBucketLocation',
                        's3:GetObject',
                        's3:ListBucket',
                        's3:ListBucketMultipartUploads',
                        's3:PutObject',
                    ],
                'Resource': ['arn:aws:s3:::heatmap-demo-raw-1230', 'arn:aws:s3:::heatmap-demo-raw-1230/*'],
            },
            {
                'Sid': 'KinesisRead',
                'Effect': 'Allow',
                'Action':
                    [
                        'kinesis:DescribeStream',
                        'kinesis:DescribeStreamSummary',
                        'kinesis:GetShardIterator',
                        'kinesis:GetRecords',
                        'kinesis:ListShards',
                    ],
                'Resource': 'arn:aws:kinesis:ap-northeast-2:<ACCOUNT_ID>:stream/heatmap-demo-kds',
            },
        ],
}
```

![](https://velog.velcdn.com/images/yulmwu/post/d32f9982-af3b-472e-b92a-627d3645356b/image.png)

그리고 아래와 같이 역할에 정책을 Attach하면 된다.

![](https://velog.velcdn.com/images/yulmwu/post/6a2d2fdd-cdd3-448f-a53d-ce4546002c87/image.png)

### Kinesis Data Firehose

Firehose의 소스는 KDS(`heatmap-demo-kds`)이며, 대상은 S3를 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/8605bf6b-a7ae-4ce5-a60b-98b432f88db9/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/298341d3-cbb2-4ba6-875c-07a0e27267f3/image.png)

옵션 중 Lambda를 사용하여 데이터를 가공하고 조작, 변경할 수 있는 기능 등이 있으나 생략한다.

![](https://velog.velcdn.com/images/yulmwu/post/0760081e-8a46-4525-8b56-b01af38b263f/image.png)

대상 설정은 위와 같이 Raw S3 Bucket를 선택하고, S3 버킷 접두사는 `raw/`로 설정해두었다.

![](https://velog.velcdn.com/images/yulmwu/post/708a4121-c6c5-426e-80e6-fbe3aa514d61/image.png)

버퍼 크기는 기본값인 5MB로 설정해두었고, 필요에 따라 늘리면 된다. 또한 버퍼 간격은 300초로, 원본(Raw) 데이터는 굳이 빠르게 쌓이지 않아도 되므로 적절히 설정해두자. 압축은 사용하지 않았다.

![](https://velog.velcdn.com/images/yulmwu/post/0f047e23-0544-4fb3-8975-f3c1d36e2227/image.png)

IAM 역할은 위와 같이 만들어둔 `heatmap-demo-firehose-role`을 선택해주었다.

![](https://velog.velcdn.com/images/yulmwu/post/82568989-f70b-4c07-b22b-4aeff29735c7/image.png)

## (4) Managed Service for Apache Flink (MSF)

![](https://velog.velcdn.com/images/yulmwu/post/2868ffe7-7cac-4bc0-a8fb-c53832d07cfb/image.png)

### Building Flink Artifacts (Jar)

MSF를 구성하기 전, MSF(Kafka)에 올릴 애플리케이션을 빌드하고 Jar 아키팩트를 S3(`heatmap-demo-curated-1230`) 버킷에 업로드하자. 애플리케이션은 아래의 깃허브 레포지토리의 `applications/flink-heatmap-job` 디렉토리에 위치한다.

```shell
git clone https://github.com/yulmwu/aws-click-heatmap-demo.git
cd aws-click-heatmap-demo/applications/flink-heatmap-job

mvn clean package

cd target
zip flink-heatmap-job-1.0.2.zip flink-heatmap-job-1.0.2.jar

# S3 경로는 s3://heatmap-demo-curated-1230/artifacts/heatmap-demo-flink로 구성하였으나, 변경해도 괜찮다.
aws s3 cp ./flink-heatmap-job-1.0.2.zip s3://heatmap-demo-curated-1230/artifacts/heatmap-demo-flink/flink-heatmap-job-1.0.2.zip
```

![](https://velog.velcdn.com/images/yulmwu/post/6173cc05-e8cc-4bcb-9683-7f376e26bb90/image.png)

애플리케이션에서 필요한 환경 변수(프로퍼티)는 MSF 구성에서 설정할 수 있는데, `KINESIS_STREAM_ARN`, `CURATED_S3_PATH`, `AWS_REGION` 프로퍼티를 요구한다.

### IAM Role

Firehose와 마찬가지로 IAM 역할과 역할에 Attach할 정책을 만들어줘야 한다. (`heatmap-demo-msf-role`, `heatmap-demo-msf-policy`) 각 신뢰 정책과 정책의 JSON은 아래와 같다.

```yaml
{
    'Version': '2012-10-17',
    'Statement':
        [
            {
                'Effect': 'Allow',
                'Principal': { 'Service': 'kinesisanalytics.amazonaws.com' },
                'Action': 'sts:AssumeRole',
            },
        ],
}
```

![](https://velog.velcdn.com/images/yulmwu/post/7774d34d-1b65-4cc3-9290-b40b6979898f/image.png)

> Kinesis Analytics는 Managed Service for Apache Flink(MSF)의 이전 이름이다. 즉 MSF이다.

![](https://velog.velcdn.com/images/yulmwu/post/5c9d75e7-b0ab-4cdb-81a1-569c19c4a306/image.png)

```yaml
{
    'Version': '2012-10-17',
    'Statement':
        [
            {
                'Sid': 'S3Access',
                'Effect': 'Allow',
                'Action':
                    [
                        's3:AbortMultipartUpload',
                        's3:GetObject',
                        's3:ListBucketMultipartUploads',
                        's3:PutObject',
                        's3:ListBucket',
                        's3:DeleteObject',
                        's3:ListMultipartUploadParts',
                    ],
                'Resource': ['arn:aws:s3:::heatmap-demo-curated-1230', 'arn:aws:s3:::heatmap-demo-curated-1230/*'],
            },
            {
                'Sid': 'KinesisRead',
                'Effect': 'Allow',
                'Action':
                    [
                        'kinesis:DescribeStream',
                        'kinesis:DescribeStreamSummary',
                        'kinesis:GetRecords',
                        'kinesis:GetShardIterator',
                        'kinesis:ListShards',
                        'kinesis:ListStreams',
                        'kinesis:SubscribeToShard',
                    ],
                'Resource': 'arn:aws:kinesis:ap-northeast-2:<ACCOUNT_ID>:stream/heatmap-demo-kds',
            },
            {
                'Sid': 'CloudWatchLogs',
                'Effect': 'Allow',
                'Action': ['logs:PutLogEvents', 'logs:CreateLogStream', 'logs:DescribeLogStreams'],
                'Resource': 'arn:aws:logs:*:*:log-group:/aws/kinesis-analytics/heatmap-demo-flink:*',
            },
            {
                'Sid': 'CloudWatchLogsCreateGroup',
                'Effect': 'Allow',
                'Action': ['logs:CreateLogGroup'],
                'Resource': '*',
            },
        ],
}
```

아직 MSF 애플리케이션을 생성하지는 않았으나, 애플리케이션의 이름은 `heatmap-demo-flink`를 넣어두면 된다. 원할 경우 애플리케이션의 이름을 바꿀 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/5b383d82-f561-4337-8b73-35f72139c6e3/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/9f207d2e-aa5b-4aff-aaf7-26779c8e0cac/image.png)

### Cloudwatch Log Group

이 부분은 옵션이긴 한데, MSF 애플리케이션 실행 시 발생하는 에러를 디버깅하기 위해 Cloudwatch 로그 그룹을 구성할 것이다. 로그 그룹의 이름은 `/aws/kinesis-analytics/heatmap-demo-flink`이다.

![](https://velog.velcdn.com/images/yulmwu/post/1d0e19ad-3eb6-42bc-826c-99fc97ae53ad/image.png)

그리고 해당 로그 그룹 안에 `application` 로그 스트림을 생성해주자.

![](https://velog.velcdn.com/images/yulmwu/post/c563c24a-1fe1-435b-b0b7-72caf5d138ef/image.png)

> 확인해보니 MSF 생성 시 자동으로 Cloudwatch 로그 그룹 및 스트림을 만드는 옵션이 있다. 이 방식을 사용해도 무방하다.

### MSF

MSF 애플리케이션의 이름은 `heatmap-demo-flink`, Flink 버전은 1.18(FLINK-1_18)을 선택하였다. 포스팅을 작성하는 시점의 가장 최신 버전인 1.20을 선택해도 문제는 없겠지만, 1.18을 기준으로 Flink 애플리케이션을 작성하였기 때문에 1.18로 선택하였다.

![](https://velog.velcdn.com/images/yulmwu/post/154195be-5e95-47a3-a9ea-bf277d960756/image.png)

IAM 역할도 Firehose와 마찬가지로 만들어뒀던 역할을 사용한다.

![](https://velog.velcdn.com/images/yulmwu/post/6f92fbaf-4a94-4092-90f3-422bec1f805c/image.png)

일단은 위와 같이 구성하고, Flink 애플리케이션을 만든다. 그리고 최소한의 요금 발생을 위한 Flink 설정과 애플리케이션 코드, 환경 변수 등을 설정해야한다.

![](https://velog.velcdn.com/images/yulmwu/post/00770d3d-91c7-4e98-a3c3-1fc3ab4d4961/image.png)

애플리케이션 코드의 위치는 위와 같이 Jar 파일이 업로드된 S3 버킷의 위치과 경로를 입력한다. Jar 파일을 지정하라고 하는데, ZIP 파일을 사용해도 괜찮다.

![](https://velog.velcdn.com/images/yulmwu/post/ca912f0c-fcc6-4602-9102-45d80fa6e7c0/image.png)

그리고 병렬 처리(Parallelism) 옵션은 Parallelism = 1, Parallelism Per KPU = 1로 구성한다. 필요에 따라 늘리면 되지만, 최소한의 비용으로 실습해보기 위해 모두 1로 구성하였다.

![](https://velog.velcdn.com/images/yulmwu/post/1a0a0933-a7c7-43df-a672-da8beaea8404/image.png)

그리고 Cloudwatch 옵션은 위와 같이 구성하였다. 에러나 경고만 확ㅇ니하려면 "경고"를 선택하면 된다.

![](https://velog.velcdn.com/images/yulmwu/post/1b86583a-365b-45d5-94ee-e3e80b686e24/image.png)

마지막으로 런타임 속성은 위와 같이 구성하자. 아래의 값을 사용하면 된다.

```
Property Group = FlinkApplicationProperties (공통)

Key = KINESIS_STREAM_ARN
Value = arn:aws:kinesis:ap-northeast-2:<ACCOUNT_ID>:stream/heatmap-demo-kds

Key = CURATED_S3_PATH
Value = s3://heatmap-demo-curated-1230/curated/

Key = AWS_REGION
Value = ap-northeast-2
```

그 외의 옵션은 필요에 따라 구성하면 되고, 이와 같이 업데이트 후 Flink 애플리케이션을 실행하면 된다.

![](https://velog.velcdn.com/images/yulmwu/post/83199b5c-b908-48aa-9fa5-1a83048d68ef/image.png)

또는 아래와 같은 AWS CLI 명령어를 사용해도 된다. 실행이 완료되었다면 Cloudwatch에 로깅이 되어야 할 것이다.

```shell
aws kinesisanalyticsv2 start-application \
  --application-name heatmap-demo-flink \
  --run-configuration '{}'
```

![](https://velog.velcdn.com/images/yulmwu/post/a7e503d1-6386-4c01-8f09-7d05f4185811/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/2231a4b1-c93a-4c03-a9dc-b567879f6267/image.png)

## (5) Athena Workgroup

![](https://velog.velcdn.com/images/yulmwu/post/f659fc11-17d8-45f7-b765-264ab6b2a872/image.png)

Athena Workgroup은 아래와 같이 생성할 수 있다. 분석 엔진은 Athena SQL을 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/f3bcc30c-4a28-4f1d-9010-4fdee010662a/image.png)

그리고 아래와 같이 Athena 쿼리 결과의 위치를 S3 버킷에 `s3://heatmap-demo-athena-results-1230/athena-results/`으로 구성한다.

![](https://velog.velcdn.com/images/yulmwu/post/c3fe4009-add1-4d53-b7c2-6a847d652c7e/image.png)

## (6) Glue Crawler

![](https://velog.velcdn.com/images/yulmwu/post/f774d625-27f2-4664-abf0-ca674e982ca8/image.png)

### IAM

Glue Crawler를 위한 IAM 역할과 정책을 생성해주도록 하자. 이는 S3에 대한 권한과 Glue Catalog, CloudWatch에 대한 권한이 포함된다. (`heatmap-demo-glue-role`, `heatmap-demo-glue-policy`)

```yaml
{
    'Version': '2012-10-17',
    'Statement': [{ 'Effect': 'Allow', 'Principal': { 'Service': 'glue.amazonaws.com' }, 'Action': 'sts:AssumeRole' }],
}
```

```yaml
{
    'Version': '2012-10-17',
    'Statement':
        [
            {
                'Sid': 'S3ReadCurated',
                'Effect': 'Allow',
                'Action': ['s3:GetObject', 's3:ListBucket'],
                'Resource': ['arn:aws:s3:::heatmap-demo-curated-1230', 'arn:aws:s3:::heatmap-demo-curated-1230/*'],
            },
            {
                'Sid': 'GlueCatalogAccess',
                'Effect': 'Allow',
                'Action':
                    [
                        'glue:CreateTable',
                        'glue:UpdateTable',
                        'glue:GetDatabase',
                        'glue:GetTable',
                        'glue:GetTables',
                        'glue:BatchGetPartition',
                        'glue:BatchCreatePartition',
                        'glue:CreatePartition',
                        'glue:UpdatePartition',
                        'glue:GetPartition',
                        'glue:GetPartitions',
                    ],
                'Resource':
                    [
                        'arn:aws:glue:*:*:catalog',
                        'arn:aws:glue:*:*:database/heatmap_demo',
                        'arn:aws:glue:*:*:table/heatmap_demo/*',
                    ],
            },
            {
                'Sid': 'CloudWatchLogs',
                'Effect': 'Allow',
                'Action': ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                'Resource': 'arn:aws:logs:*:*:log-group:/aws-glue/crawlers:*',
            },
        ],
}
```

![](https://velog.velcdn.com/images/yulmwu/post/c64de77b-ad3b-4646-bff1-d9d15563beff/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/2b804872-e461-4aae-812d-020e14ff6698/image.png)

Glue 데이터베이스와 테이블의 이름은 `heatmap_demo`으로 미리 설정하였다. 마찬가지로 필요 시 변경하면 된다.

### Glue Crawler

먼저 Glue 데이터베이스를 생성하자. 이 데이터베이스에 직접 데이터가 포함되는 것은 아니고, 스키마나 파티션 정보 등이 포함되는 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/a6eecbad-aa2a-4b71-82e3-ce8a0a0b4228/image.png)

다음으로 Glue Crawler는 아래와 같이 구성한다.

![](https://velog.velcdn.com/images/yulmwu/post/89b4fd52-48d4-4bc7-b467-f79d0584ee1d/image.png)

데이터 소스는 S3로, 경로는 `s3://heatmap-demo-curated-1230/curated/curated_heatmap/`을 입력한다.

![](https://velog.velcdn.com/images/yulmwu/post/fb196b37-3868-4094-a3af-725731112f41/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/95fa4da3-5bfd-40fb-a8aa-b2874598e78f/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/bcfaa08e-3f5d-4b5c-afbb-e129fb041885/image.png)

스케쥴링 설정은 `cron(0/30 * * * ? *)`으로, 30분 간격으로 Glue 크롤러가 실행될 수 있도록 한다.

![](https://velog.velcdn.com/images/yulmwu/post/7730db61-892f-49d5-8aeb-cd307772ca0e/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/1f44bc98-cfd7-4417-8b94-90fe62cdfabd/image.png)

이렇게 Glue Crawler를 구성하였다면, Glue Crawler를 실행하면 되지만 Curated S3에 데이터가 쌓여있는 상태에서 실행해야 정상적으로 동작하므로, 이는 추후 테스팅 단계에서 실행해보도록 하겠다.

## (7) Applications

Click Producer와 Heatmap Viewer 애플리케이션 모두 마찬가지로 [깃허브 레포지토리](https://github.com/yulmwu/aws-click-heatmap-demo)에서 확인해볼 수 있으며, 각각 `applications` 디렉토리의 `heatmap-click-producer`와 `heatmap-athena-viewer` 디렉토리에 위치한다.

### Click Producer

![](https://velog.velcdn.com/images/yulmwu/post/a9da2e62-3ebd-4854-8a86-1b51dfc96ece/image.png)

Click Producer 애플리케이션에서 설정할 환경 변수(`.env`)는 아래와 같다. AWS Full Access Key를 직접 사용하도록 구성하였으니, 프로덕션 환경에선 권장하지 않는다.

```shell
VITE_AWS_REGION=ap-northeast-2
VITE_KINESIS_STREAM_NAME=heatmap-demo-kds

VITE_AWS_ACCESS_KEY_ID=...
VITE_AWS_SECRET_ACCESS_KEY=...

VITE_PAGE_ID=demo-page
```

아래의 명령어로 NPM 의존성을 설치하고 실행하자.

```shell
npm i
npm run start
```

### Heatmap Viewer

![](https://velog.velcdn.com/images/yulmwu/post/3deabc30-4cca-4b01-96c7-dcd2f3a3af22/image.png)

Heatmap Viewer 애플리케이션에선 아래와 같은 환경 변수가 필요하다. 마찬가지로 Access Key를 제외한다면 (같은 리소스 이름으로 진행하였다는 가정 하에) 수정할 부분은 없다.

```shell
VITE_AWS_REGION=ap-northeast-2

VITE_ATHENA_WORKGROUP=heatmap-demo-wg
VITE_GLUE_DATABASE=heatmap_demo
VITE_GLUE_TABLE=curated_heatmap

VITE_AWS_ACCESS_KEY_ID=...
VITE_AWS_SECRET_ACCESS_KEY=...
```

```shell
npm i
npm run build
npm run start
```

# 3. Testing

만약 성공적으로 인프라 구축에 성공하고 두 애플리케이션의 환경 설정까지 완료하였다면 Click Producer 애플리케이션에 접속해보자.

![](https://velog.velcdn.com/images/yulmwu/post/47a844fa-892c-402d-b3cd-0877e43cb076/image.png)

여깃 Start sending 버튼을 클릭한 뒤 보이는 직사각형 영역 안을 여러 부분에 여러번 클릭해보자. 그럼 아래의 Response에 응답이 표시되어야 한다. Flink 애플리케이션에서 `TumblingProcessingTimeWindows` 시간을 1분으로 설정해두었기 때문에, 최소 1분이 지나야 결과를 확인해볼 수 있다. 조금만 기다린 다음, Curated S3 버킷을 확인해보자.

![](https://velog.velcdn.com/images/yulmwu/post/89d2b144-16f4-4704-80eb-7eda42a1b6fc/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/38f46242-adad-41eb-9321-e8264c41c694/image.png)

그럼 위와 같이 MSF(Flink) 애플리케이션에서 FileSink를 통해 저장된 Parquet 포맷의 오브젝트가 보일 것이다. (필자는 여러번 테스트를 하여 파일들이 많지만, 하나 밖에 없을 수도 있다.)

이 상태로 뷰어 애플리케이션을 실행하면 안되고, Glue Crawler를 실행하여 Athena가 사용할 스키마(테이블 스키마, 파티션 정보 등)를 만들어야 한다. AWS CLI를 통해서 실행할 수도 있고, 콘솔에서도 실행할 수 있다. _(Glue Crawler를 특정 기간마다 실행하는 스케쥴러를 구성해두긴 하였으나, 그 시간만큼 기다리지 않고 직접 실행하는 것임을 참고하자.)_

![](https://velog.velcdn.com/images/yulmwu/post/ec889a0d-0a1f-4c51-8763-f4615f84826d/image.png)

또는 아래의 CLI 명령어로 실행할 수 있다.

```shell
aws glue start-crawler --name heatmap-demo-curated-crawler

# 상태 확인
aws glue get-crawler --name heatmap-demo-curated-crawler
aws glue get-tables --database-name heatmap_demo # Glue 데이터베이스는 실제 데이터를 가지지 않고, 스키마나 파티션 정보와 같은 메타데이터 등을 카탈로그에서 관리한다. 실제 데이터는 S3나 RDS, DynamoDB 등에 저장된다.
```

![](https://velog.velcdn.com/images/yulmwu/post/a44d0dae-b9a3-4fac-8770-29750bcc0e7c/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/695e734f-2700-49a6-b00c-39611ea9317f/image.png)

Glue Crawler를 실행하고 나면 아래와 같이 스키마와 파티션 정보가 생성된 것을 볼 수 있다. 이제 Athena에서 이를 바탕으로 쿼리를 실행할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/97a5ae1c-0842-4763-8763-1921a74e8adf/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/eba0e1bf-7bc0-46aa-b7b2-45a2b813b488/image.png)

예시로 `SELECT * FROM "heatmap_demo"."curated_heatmap";` 쿼리를 실행해보자. (Curated S3 내 모든 데이터를 가져오는 것이므로 사용 시 주의하도록 하자.)

![](https://velog.velcdn.com/images/yulmwu/post/18c6f622-8fd1-4b3a-8b6f-37497ffe8721/image.png)

이 결과는 아래와 같이 Athena Results S3 버킷에도 CSV 포맷으로 저장된다.

![](https://velog.velcdn.com/images/yulmwu/post/f2d94691-0bdf-4b09-b509-56c6f321fb5e/image.png)

---

이렇게 Athena 쿼리를 실행해보고 Athena Results S3 버킷에 쿼리 결과가 저장되는 것을 확인하였다면, 마지막으로 히트맵을 렌더링하는 Heatmap Viewer 애플리케이션을 실행하고, 아래와 같은 Athena SQL 쿼리를 작성한 뒤 Run query 버튼을 클릭하자.

```sql
# AWS Athena는 Presto 엔진을 기반한다.

SELECT grid_x, grid_y, SUM(clicks) AS clicks
FROM "heatmap_demo"."curated_heatmap"
WHERE from_unixtime(window_end / 1000) >= date_add('hour', -1, current_timestamp)
GROUP BY 1, 2
ORDER BY clicks DESC;
```

![](https://velog.velcdn.com/images/yulmwu/post/7f5f534c-f030-4c3f-be84-aa9794e3c6fd/image.png)

그럼 위 사진과 같이 최근 1시간(`date_add('hour', -1, current_timestamp)`) 동안 집계된 클릭 데이터(Window)가 Grid 위에 히트맵으로 표시되는 것을 확인해볼 수 있다. (히트맵이 자연스럽지는 않는데, 그 부분의 코드는 생성형 AI가 작성하였다. 물론 이 실습에 있어 중요한 부분은 아니다.)

![](https://velog.velcdn.com/images/yulmwu/post/3acada5b-aef5-44f3-b193-d4c7f1257259/image.png)

필자는 살짝의 시간을 간격으로 두고 여러번 클릭하였기 때문에 시간이 지나서 다시 조회해보면 위와 같이 최근 1시간 동안 집계된 Window가 표시되는 것을 확인해볼 수 있다. 만약 1시간이 아닌 30분으로 쿼리를 다시 보내본다면 아래와 같이 변화되는 것을 확인해볼 수 있을 것이다. (`date_add('minute', -30, current_timestamp)`)

![](https://velog.velcdn.com/images/yulmwu/post/78b37002-7e73-4491-9a72-ae2e85edb5be/image.png)

다음 날 다시 테스트(Click Producer + Heatmap Viewer)를 해보면 히트맵이 다르게 표시되는 것 또한 확인해볼 수 있을 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/6a0584db-14a1-43cb-9907-a04979240cd6/image.png)

# 4. Monitoring, Observability

이 실습에서는 디버깅을 위해서 MSF(Flink)에 대해서만 Cloudwatch를 구성하였는데, 필요 시 Kinesis Data Streams나 Firehose에서도 적용해볼 수 있다. Cloudwatch를 사용하지 않고도 각 리소스 세부 정보에서 대략적인 메트릭을 확인해볼 수 있다.

_(Kinesis Data Streams ::)_

![](https://velog.velcdn.com/images/yulmwu/post/6be97027-02c9-4802-a9e7-e84d7713f54a/image.png)

_(Amazon Managed Service for Apache Flink ::)_

![](https://velog.velcdn.com/images/yulmwu/post/df7df327-7bbb-47bb-9825-dfabadc8cd0a/image.png)

또한 MSF는 매니지드 서비스답게 콘솔에서 대시보드 접속 버튼을 클릭하여 Flink 대시보드에 접속해볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/0ee4d05b-6713-42fd-b48d-671e6bb97f69/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/df3ab786-bc74-499a-aadf-9d3e81913776/image.png)

이상으로 포스팅을 마치겠다. 이 아키텍처를 기반으로 히트맵이 아니더라도 다양한 곳(특히 분석 쪽)에서 활용해볼 수 있으니 참고가 되었으면 좋을 것 같다.
