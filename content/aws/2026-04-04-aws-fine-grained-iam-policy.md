---
title: "[AWS] Fine-Grained IAM Policy를 위한 정책 작성법"
description: "Fine-Grained한 Zero Trust IAM Policy 작성 방법"
slug: "2026-04-04-aws-fine-grained-iam-policy"
author: yulmwu
date: 2026-04-04T10:10:09.979Z
updated_at: 2026-04-06T12:52:49.934Z
categories: ["AWS"]
tags: ["IAM", "aws"]
series:
  name: AWS
  slug: aws
thumbnail: https://mirror-cdn.swua.kr/thumbnails/aws/aws-fine-grained-iam-policy_960x540.png
linked_posts:
  previous: 2026-04-04-aws-challenge-2025-2
  next: 
is_private: false
---

# 개요

클라우드 벤더의 대표적인 AWS를 사용하면서 가장 중요하게 여겨지는 것 중 하나는 보안일 것이다. 이러한 보안은 외부에서 침입하는 공격에 대해 대응하는 것도 해당되지만, 사용자나 리소스에 대한 권한이나 정책을 설계하고 적용하는 것 또한 중요한 요소이다.

이러한 정책 설계에 있어 최소 권한 원칙(PoLP, Principle of Least Privilege)을 준수하는 것이 필수적인데, 이에 대해선 정책 세분화하여 다루는 Fine-Grained Policy를 통해 구현해볼 수 있다.

이전에 Zero Trust 모델을 구현하기 위해 Microsegmentation을 구현하였을땐 L3/L4 네트워킹 및 L7 정책을 다뤘다면 IAM 정책은 AWS 리소스에 대한 API 호출 권한을 세부적으로 제어할 수 있다.

- Refs: https://articles.swua.kr/(TODO)

이 포스팅의 목표는 다음과 같은 질문에 답할 수 있도록 만드는 것이다.

- 어떠한 요청이 실제로 허용되거나 거부되는가?
- `Action`, `Resource`, `Condition`, `Allow/Deny`, `Tag`, `PassRole`, `Boundary`, `SCP`는 어떤식으로 상호작용되는가?
- 어떤 패턴이 정말로 최소 권한(Least Privilege)을 따르는가?
- 여러 서비스 및 복잡한 관계의 아키텍처에서 어떠한 순서로 사고하면 올바른 정책을 만들 수 있는가? 
  
문서의 전반적인 내용은 AWS 공식 문서의 정책 평가 로직, IAM JSON 정책 요소, ABAC, Best Practices, IAM Access Analyzer 등의 문서를 참고하였다. 이에 대해선 마지막에 첨부한 링크를 참고하도록 하자. 포스팅에서 다루는 일부 내용이 업데이트에 따라 바뀔 수도 있는데, 세부적인 내용은 AWS Service Authorization Reference를 참조하자.
  
- Refs: https://docs.aws.amazon.com/service-authorization/latest/reference/reference.html

이 포스팅에서의 목차는 아래와 같다.

1. Fine-Grained IAM Policy가 정확히 무엇인가?
2. AWS 정책 및 권한 평가에 대한 전체적인 흐름
3. IAM 정책의 구성 요소
4. `Resource`를 좁히는 설계
5. `Condition`을 이용한 세밀 제어
6. Tag 기반 ABAC 설계
7. Explicit Deny 전략
8. 서비스별 ARN 구조 및 읽는 방법
9. 정책 유형별 상호작용
10. Practice 1. S3에서의 Fine-Grained 설계
11. Practice 2. EC2/Lambda/Secrets Manager/KMS에서의 Fine-Grained 설계
12. `sts:AssumeRole`과 `iam:PassRole`
13. Permissions Boundary 구성
14. Organizations SCP를 이용한 상위 Guardrail 구성
15. Practice 3. 복잡한 아키텍처에서의 권한 설계
16. 참고 자료

## 1. Fine-Grained IAM Policy가 정확히 무엇인가?

정책에 대한 Zero Trust 모델에서 일반적으로 Fine-Grained는 세분화된 정책을 의미하며, Microsegmentation은 일반적으로 워크로드 수준의 네트워크적 격리를 의미한다면 Fine-Grained는 사용자/애플리케이션 수준의 세분화된 접근 권한 관리를 의미한다.

AWS IAM Policy에 대한 Fine-Grained 또한 단순히 "S3 접근 가능/불가능"과 같은 모호한 정책이 아닌 아래와 같이 세부적으로 구체화하는 것이다.

- 어떤 서비스의 어떤 API를
- 어떤 리소스에 대하여
- 어떤 조건에서만
- 누구에게
- 어떤 상위 제한(Boundary) 아래에서
- 어떤 예외 상황을 두고 허용할 것인가?

예를 들어 다음 두 정책은 모두 S3 읽기 권한처럼 보이지만, Zero Trust 및 보안 관점에서의 수준은 전혀 다르다.

```json
{
  "Effect": "Allow",
  "Action": "s3:GetObject",
  "Resource": "*"
}
```

```json
{
  "Effect": "Allow",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::my-bucket/reports/2026/*",
  "Condition": {
    "Bool": {
      "aws:SecureTransport": "true"
    }
  }
}
```

전자는 모든 리소스에 대한 와일드카드 문법으로, 이는 사실상 광범위한 권한이고 Zero Trust에 만족하지 못한다. 하지만 후자는 적어도 아래를 만족하여 Fine-Grained 하다고 볼 수 있다.

- 특정 객체 읽기만 허용
- 특정 버킷의 특정 키 접두사만 허용
- TLS/SSL을 통한 요청에만 허용

Fine-Grained IAM Policy에 대한 본질은 허용 범위를 설계하는 것으로, "무엇을 줄 것인가?" 보단 "무엇을 어떻게 제한할 것인가?"가 본질이자 핵심이다.

## 2. AWS 정책 및 권한 평가에 대한 전체적인 흐름

AWS는 API 요청을 평가할때 요청에 대한 컨텍스트를 만들고 관련 정책들을 모아 종합적으로 검사한다. 같은 계정 내에선 Identity-based Policy와 Resource-based Policy의 허용 결과가 합집합처럼 동작하지만, 이때 명시적(또는 Explicit) Deny는 이는 덮어쓴다. 

또한 Permissions Boundary, SCP/RCP 및 Session Policy 등이 결합되면 이를 계산하는데 있어 복잡해질 수 있다. 기본적인 규칙은 아래와 같다.

### 2-1. 기본 규칙

1. 명시적으로 허용되지 않은 것은 기본적으로 거부된다.
2. 명시적 Allow가 있어도 다른 정책에서 Explicit Deny가 있으면 거부된다.
3. Identity-based Policy와 Resource-based Policy는 같은 계정에선 합집합처럼 평가된다.
4. Permissions Boundary는 최대 권한 상한선이다.
5. SCP는 조직 단위의 상한선이다.
6. Session Policy는 세션 단위 상한선이다.

요청에 대한 정책 평가는 아래와 같이 진행하면 된다.

1. 요청 주체는 누구인가?
2. 어떠한 정책들이 적용되는가?
3. Explicit Deny가 있는가?
4. Allow는 어디서 나오는가?
5. 상위 제한(Permissions Boundary, SCP, Session Policy 등)에 걸리는가?

이를 통해 간단하게나마 정책을 해석해볼 수 있다. 

## 3. IAM 정책의 구성 요소

이제부터 본격적으로 IAM 정책을 JSON 기준으로 뜯어볼 것이다. 사실상 이 포스팅의 핵심이며 일부 개념은 후반에서 다루겠다.

순서는 중요하지 않지만, 그 의미는 매우 중요하며 `Action`과 `NotAction`, `Resource`와 `NotResource`, `Principal`과 `NotPrincipal`은 하나의 Statement 안에서 함께 사용할 수 없는 상호 배타적 요소이다.

하나의 Statement에 포함할 수 있는 요소는 아래와 같다.

- `Version`
- `Sid`
- `Effect`
- `Action` / `NotAction`
- `Resource` / `NotResource`
- `Principal` / `NotPrincipal`
- `Condition`

### `Statement`

Statement는 사용자, 그룹, 역할이 특정 리소스에 대해 수행할 수 있는 작업(Allow 또는 Deny)을 정의하는 정책 문서의 블록을 의미한다.

정책은 이러한 Statement를 한개 이상 가질 수 있다. 한 문장으로 끝내려 하지 말고, 의도가 다른 권한은 Statement를 분리하는 것이 읽기 쉽고 검증하기 쉽다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadReports",
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::my-bucket/reports/*"
    },
    {
      "Sid": "ListReportsPrefix",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::my-bucket",
      "Condition": {
        "StringLike": {
          "s3:prefix": ["reports/*", "reports"]
        }
      }
    }
  ]
}
```

### `Version`

정책 문서의 버전으로, 대부분의 경우 `2012-10-17` 값을 사용한다. `2008-10-17`도 있지만 이는 더이상 사용되지 않으며, Managed Policy의 버전 히스토리 개념과는 다르다.

```json
"Version": "2012-10-17"
```

### `Sid`

Sid(Statement ID)는 개별 Statement에 할당하는 식별자로, 복잡한 정책에서 해당 Statement가 어떤 역할을 하는지 구분하고 라벨링한다. 이는 필수는 아니지만 복잡한 정책을 구성해야할 경우 권장된다.

```json
"Sid": "AllowS3ReadWrite"
```

### `Effect`

값은 `Allow` 또는 `Deny`를 가질 수 있다. 기본적으로 모든 권한은 허용되지 않기 때문에 `Allow`를 사용하여 권한을 줄 수 있다. 

하지만 `Deny`를 명시적으로 사용하면(Explicit Deny) 해당 Deny 정책은 예외 없이 우선한다. 이에 대해선 후반 "Explicit Deny 전략"에서 상세히 다뤄보겠다.

즉 `Allow`는 특정한 작업(`Action`)을 허용하도록 하고, `Deny`는 특정 조건을 반드시 강제하는데 사용될 수 있다. Explicit Deny가 필요한 상황은 아래와 같다.

- 예시: HTTPS(TLS/SSL) 강제, 특정 리전 차단, 특정 KMS 키 외 사용 금지, MFA 강제 등등.

### `Action` / `NotAction`

`Action`은 해당 정책에서 허용하거나 거부할 동작/작업을 지정하며, 대게 `<서비스명>:<작업명>` 형식으로 기술하여 상세한 권한 제어가 가능하다.

```json
"Action": [
  "s3:GetObject",
  "s3:PutObject",
  "ec2:*"
]
```

이때 `*` 와일드카드를 사용할 수 있으나, 과연 그 판단이 Zero Trust, Fine-Grained를 만족하는지 다시 한번 생각해보길 바란다. 

`NotAction`은 자주 사용되진 않지만 강력한 고급 기능으로, 지정된 목록을 제외한 모든 작업으로 해석된다. 특히 `Effect: Allow`와 결합하면 예상보다 범위가 넓어질 수 있고, 특별한 이유가 있지 않는 한 `Action`을 우선 권장한다.

다음은 IAM을 제외한 거의 모든 서비스 작업을 허용하는 식으로 동작한다.

```json
{
  "Effect": "Allow",
  "NotAction": "iam:*",
  "Resource": "*"
}
```

당장은 문제가 없을지언정 추후 서비스나 작업이 추가되어 예상 외의 돌발 상황이 발생할 수 있어 주의가 필요하다.

### `Resource` / `NotResource`

Resource는 작업이 적용되는 AWS 리소스의 구체적인 대상(ARN, Amazon Resource Name)을 지정한다. 이러한 특성으로 Fine-Grained IAM Policy에서 핵심적으로 작용한다.

다음은 `my-bucket` 내의 `/private/*` 키 접두사를 포함한 ARN이다. (경로라고 해석해도 무방하지만, 정확한 명칭은 키가 올바르다.)

```json
"Resource": "arn:aws:s3:::my-bucket/private/*"
```

서비스에 따라 Resource 수준의 제어를 지원하지 않는 액선도 있다. `DescribeInstances`, `DescribeVpcs`와 같은 조회(리스트) 작업 등이 여기에 해당되며, 이 경우 `Resource: "*"`와 같은 와일드카드를 사용해야 한다. 

하지만 이러한 경우에서도 가능한 한 `Condition`을 지정하여 그 범위를 보완해야 Fine-Grained에 더 가까워질 수 있다.

`NotResource`도 마찬가지로 특정 리소스를 제외한 나머지 리소스로 해석할 수 있으며 `Deny`와 함께 사용할 경우 Guardrail 패턴으로 사용할 수 있지만, `Allow`와 함께 사용할 경우 범위가 필요 이상으로 넓어질 수 있다. 또한 잘못 사용할 경우 관리가 복잡해지고 의도가 모호해질 수 있으니 `Resource` 사용을 우선적으로 고려해봐야 한다.

공식 문서에도 `NotResource`와 `Effect: Allow`를 같이 쓰지 말라고 볼드체로 강조하였으니 참고하자.

### `Principal` / `NotPrincipal`

`Principal`는 주로 Resource-based Policy에서 필수적으로 사용되며 정책에 의해 권한을 부여받거나 거부당하는 주체(사용자, 역할, 계정)를 지정한다. 

S3 버킷 정책 같은 Resource-based Policy에서 사용하며, 명시적 주체가 이미 사용자이기 때문에 Identity-based Policy에서는 사용하지 않는다.

가장 많이 사용되는 예시가 역할에 대한 신뢰 정책을 설정할때이며, 아래는 EC2가 이 역할에 대해 임시적인 자격증명을 얻을 수 있도록 `sts:AssumeRole` Action을 구성한다. (이에 대해선 후반에서 다루겠다.)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

또다른 예제로 다음은 S3 버킷 정책에서 다른 계정이 접근할 수 있도록 Principal을 명시하는 것이다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAliceToReadObjects",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:user/Alice"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-bucket/*"
    }
  ]
}
```

`NotPrincipal`도 지원하지만 아래의 Condition에서 ARN 조건 연산자와 `aws:PrincipalArn` 컨텍스트 키를 사용하는 것이 권장된다. 또한 `Effect: Allow`와 같이 사용할 수 없다.

### `Condition`

`Condition`은 정책이 적용되는 상황을 제한하는 조건절로, 예시로 특정 IP 대역에서 오는 요청(`aws:SourceIp`)만 허용한다거나 MFA 인증이 된 경우에만 허용하는 등에서 사용할 수 있다. 

이는 Fine-Grained IAM Policy에서 가장 중요한 요소 중 하나로 아래의 "Condition을 이용한 세밀 제어" 절에서 다뤄보겠다.

## 4. `Resource`를 좁히는 설계

많은 Worst Practices는 Action만 신경쓰고 Resource를 넓게 쓰는 경우이다. 그 대표적인 예시는 `Resource: "*"`으로, Resource 수준의 제어를 지원하지 않는 한 이와 같은 와일드카드 문법은 지양해야 한다.

이 절에선 좋은 Resource 설계의 원칙에 대해 다룬다.

### 4-1. 좋은 Resource 설계의 원칙

1. 가능하면 리소스 ID 단위까지 좁혀라.
2. 경로형 리소스는 Prefix까지 좁혀라. (예: S3 Object Path)
3. 한 Statement에 서로 다른 의도의 리소스를 섞지 마라.
4. 서비스가 Resource 수준의 제어를 지원하지 않는다면 Condition으로 보완하라.
5. 와일드카드 문법은 정말 필요한 부분에만 써라.

### 4-2. S3에서의 Resource 설계

4-1 문항 중 2번 경우 대표적인 예시가 S3 리소스이다.. S3는 버킷 그 자체와 객체에 대한 ARN이 다르다.

- 버킷 자체: `arn:aws:S3:::my-bucket`
- 버킷 내 객체: `arn:aws:S3:::my-bucket/path/*`

이때 자주 발생하는 실수는 아래와 같이 ARN을 혼동하는 경우일 것이다.

- `s3:ListBucket`에 객체 ARN을 걸어둠
- `s3:GetObject`에 버킷 ARN만 걸어둠
- Prefix 단위의 제어를 해야 하는데 버킷 전체를 열어버림

> `ListBucket` Action은 SDK나 CLI에서 `ListObjectsV2`와 동일한 역할이다. 계정 내 버킷 목록을 조회하는 권한은 `s3:ListAllMyBuckets`이다.

올바른 예는 아래와 같다. 

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListOnlyReportsPrefix",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::my-bucket",
      "Condition": {
        "StringLike": {
          "s3:prefix": ["reports", "reports/*"]
        }
      }
    },
    {
      "Sid": "ReadObjectsOnlyInReports",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-bucket/reports/*"
    }
  ]
}
```

> `ListBucket`은 대상이 버킷이고, `GetObject`이나 `PutObject`는 그 대상이 버킷 내 객체이기 때문에 위와 같이 구성해야 한다.

### 4-3. EC2에서의 Resource 설계

다른 예시로 EC2는 Action마다 Resource 수준의 제어 지원 여부가 다르다.

`StartInstances`, `StopInstances`, `TerminateInstances` 같은 일부 Action은 인스턴스 ARN에 걸 수 있지만, 모든 EC2 Action이 리소스 단위 제어를 지원하는 것은 아니다. 그 대표적인 예시로 인스턴스를 새롭게 만드는 권한인 `RunInstances`를 비롯한 Resource 대상을 지정하기 모호한 경우이다.

```
{
  "Effect": "Allow",
  "Action": [
    "ec2:StartInstances",
    "ec2:StopInstances"
  ],
  "Resource": "arn:aws:ec2:ap-northeast-2:123456789012:instance/*"
}
```

위 예시는 특정 인스턴스 ID를 명시하지 않았고, 인스턴스는 언제든지 새롭게 만들어지거나 없어질 수 있으므로 특정 인스턴스 ID를 명시하는 것은 좋지 않다. 때문에 아래에서 다룰 Tag 조건 등과 함께 사용되는 경우가 많다.

아래의 예시는 Resource 수준의 제어를 지원하지 않는 Action들의 예시이다.

```
{
  "Version":"2012-10-17",
  "Statement":[
    {
      "Effect":"Allow",
      "Action":[
        "ec2:DescribeInstances",
        "ec2:DescribeImages",
        "ec2:DescribeInstanceTypes",
        "ec2:DescribeKeyPairs",
        "ec2:DescribeVpcs",
        "ec2:DescribeSubnets",
        "ec2:DescribeSecurityGroups",
        "ec2:CreateSecurityGroup",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:CreateKeyPair"
      ],
      "Resource":"*"
    },
    {
      "Effect":"Allow",
      "Action":"ec2:RunInstances",
      "Resource":"*"
    }
  ]
}
```

### 4.4 Secrets Manager에서 Resource 설계

Secrets Manager는 Secret ARN 끝에 랜덤한 Suffix가 붙는 경우가 흔하다. 때문에 특정 시크릿만 허용할때 이름 기반 패턴과 Suffix를 고려해야 한다.

```json
{
  "Effect": "Allow",
  "Action": "secretsmanager:GetSecretValue",
  "Resource": "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:rds!db-*"
}
```

KMS CMK(Customer Managed KMS Key)를 사용할 경우 `kms:Decrypt` Action이 필요할 수 있다.

```json
{
  "Version":"2012-10-17",
  "Statement":[
    {
      "Effect":"Allow",
      "Action":[
        "secretsmanager:GetSecretValue",
        "kms:Decrypt"
      ],
      "Resource":[
        "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:my-secret",
        "arn:aws:kms:ap-northeast-2:123456789012:key/11111111-2222-3333-4444-555555555555"
      ]
    }
  ]
}
```

### 4.5 KMS에서 Resource 설계

특히 KMS는 `Resource: "*"`를 함부로 쓰면 위험하다. 때문에 아래와 같이 특정 키 단위로 좁히는 것이 필요하다.

```json
{
  "Version":"2012-10-17",
  "Statement":[
    {
      "Effect":"Allow",
      "Action":[
        "secretsmanager:GetSecretValue",
        "kms:Decrypt"
      ],
      "Resource":[
        "arn:aws:kms:ap-northeast-2:123456789012:key/11111111-2222-3333-4444-555555555555"
      ]
    }
  ]
}
```

KMS는 이러한 접근 권한 외에도 Resource-based 정책인 키 정책 등 여러 보안 요소가 있으므로 참고하자.

### 언제 `Resource: "*"`가 불가피한가?

앞서 언급했지만 일부 Action은 Resource 수준의 제어를 지원하지 않는다. 그 예시가 `DescribeInstances`와 같이 목록 조회나 전역 설정 조회 등으로, 이 경우 별도의 리소스 지정이 어렵다. 이 경우 두가지 보완 요소를 고려할 수 있다.

- 정말 필요한 Action인지
- 가능하면 Condition으로 범위를 보완

특히 `List*`, `Describe*` 계열은 종종 `Resource: "*"`가 필요하지만 그 자체로 치명적이지 않을 수도 있다. 중요한 것은 쓰기/변경/권한 위임 계열 Action을 넓게 열지 않는 것이다.

## 5. `Condition`을 이용한 세밀 제어

Fine-Grained IAM Policy의 절반은 Condition에 결정된다. Resource가 "무엇"을 제한한다면, Condition은 권한이 효력을 발생하는 상황(언제/누가/어떤 컨텍스트에서)을 구체적으로 제한한다.

Condition은 요청 컨텍스트에 있는 키와 정책에서 정의한 값을 연산자로 비교하는 방식으로 동작한다. 그 예시는 아래와 같다.

```json
"Condition": {
  "StringEquals": {
    "aws:PrincipalTag/Project": "alpha"
  }
}
```

위 예시는 요청을 보내는 주체(사용자가 역할)의 `Project` 태그 키에 대해 `alpha` 값인지 비교하여 같을 경우에만 유효한 예시이다. 대표적인 Condition 연산자는 아래와 같으며, 세부적인 내용은 공식 문서를 참조하자.

- `StringEquals` (대소문자 구분을 무시하려면 `StringEqualsIgnoreCase`를 사용)
- `StringLike`
- `StringNotEquals`
- `ArnEquals`
- `ArnLike`
- `Bool`
- `DateGreaterThan`
- `DateLessThan`
- `IpAddress`
- `NotIpAddress`
- `NumericLessThan`
- `Null`

이러한 연산자를 통해 계산할 수 있는 대표적인 Condition 키는 아래와 같다.

- `aws:SourceIp`
- `aws:SecureTransport`
- `aws:CurrentTime`
- `aws:PrincipalArn`
- `aws:PrincipalTag/...`
- `aws:RequestTag/...`
- `aws:ResourceTag/...`
- `s3:prefix`
- `s3:x-amz-server-side-encryption`
- `kms:ViaService`
- `iam:PassedToService`

서비스마다 별도의 키가 있고, 모든 키가 모든 Action/Resource 조합에서 유효한 것은 아니니 공식 문서를 참조하는 것이 가장 확실하다.

아래에선 몇몇 사용 예시와 연산자/키 조합을 설명한다.

### 5-1. IP 기반 제한

흔히 회사/사내망이나 특정 VPN 대역에서만 허용과 같은 요구사항에서 사용된다.

```
{
  "Effect": "Allow",
  "Action": "ec2:DescribeInstances",
  "Resource": "*",
  "Condition": {
    "IpAddress": {
      "aws:SourceIp": "203.0.113.0/24"
    }
  }
}
```

단, 이러한 IP 대역으로만 신뢰하는 것은 올바르지 않은 편이다. IP는 NAT/Proxy/Private Link 등으로 인해 실제 소스가 달라질 수 있고, 재택/모바일/원격 환경을 사용할 수도 있으며 자동화 워크로드에는 적합하지 않을 수 있다.

때문에 보통은 SSO + MFA + 역할 분리가 더 중요하게 작용한다.

### 5-2. TLS 강제

이는 보통 S3에서 자주 사용되는 패턴으로, S3 Best Practices에서도 `aws:SecureTransport`를 이용해 HTTPS만 허용할 것을 권장한다.

```json
{
  "Sid": "DenyInsecureTransport",
  "Effect": "Deny",
  "Action": "s3:*",
  "Resource": [
    "arn:aws:s3:::my-bucket",
    "arn:aws:s3:::my-bucket/*"
  ],
  "Condition": {
    "Bool": {
      "aws:SecureTransport": "false"
    }
  }
}
```

보통은 `Effect: Deny`로 거는 것이 더 어울리고, "TLS일때 허용" 보다는 "TLS가 아니면 무조건 거부"가 후러씬 강한 보장이기 때문이다.

### 5-3. 시간 기반 제한

자동화 워크로드나 테스트, 또는 임시 권한을 부여하는 상황에서 자주 사용하며 아래는 2026년 12월 31일 전까진 비밀번호 변경이 허용되는 IAM 정책의 예시이다.

```json
{
  "Effect": "Allow",
  "Action": "iam:ChangePassword",
  "Resource": "*",
  "Condition": {
    "DateLessThan": {
      "aws:CurrentTime": "2026-12-31T23:59:59Z"
    }
  }
}
```

여기서 주의점은 시간대는 UTC 기준으로 고려해야 하며 이러한 만료형 정책은 운영 편의성 보단 안전성을 중시할때 사용하면 유리하다.

### 5-4. MFA 기반 제한

MFA(Multi-Factor Authentication)는 IAM 보안 Best Practices의 핵심으로, 사람이 사용하는 계정에 대해 고위험 작업을 제한할때 자주 사용된다. 아래는 MFA 인증 수단이 없을 겨우 3가지 고위험 Action을 제한하는 예시이다.

```json
{
  "Sid": "DenySensitiveActionsWithoutMFA",
  "Effect": "Deny",
  "Action": [
    "iam:*",
    "organizations:*",
    "kms:ScheduleKeyDeletion"
  ],
  "Resource": "*",
  "Condition": {
    "BoolIfExists": {
      "aws:MultiFactorAuthPresent": "false"
    }
  }
}
```

여기서 `BoolIfExists`는 일부 요청 컨텍스트에 `MultiFactorAuthPresent` 키가 없을 수도 있기 때문이다. Condition은 모든 조건이 true일때만 해당 Statement가 적용되고, 이러한 점으로 인해 키가 없다면 Condition 평가 자체가 되지 않아 Deny가 적용되지 않을 수 있다.

`BoolIfExists`는 키가 없을 경우 무조건 true를 반환하기 때문에 이러한 상황에서 효율적으로 동작할 수 있다. 단, 이 점을 간과하고 사용할 경우 예상하지 않은 효과가 발생할 수 있으므로 주의하자.

사람이 사용하는 사용자와 자동화 워크로드를 섞어서 생각하면 안된다. 워크로드엔 역할과 임시 자격 증명을 사용하고, 사람에게는 SSO + MFA를 강제하는 식으로 분리해야 한다.

### 5-5. Null 연산자

Null 연산자는 Condition 키의 존재 여부를 검사하는 연산자이다. 예를 들어 `aws:RequestTag/Project` 키가 반드시 있어야 하는 경우 아래와 같이 작성할 수 있다.

```json
{
  "Effect": "Deny",
  "Action": "ec2:RunInstances",
  "Resource": "*",
  "Condition": {
    "Null": {
      "aws:RequestTag/Project": "true"
    }
  }
}
```

이는 `Project` 태그가 요청에 없는 경우 거부하는 정책으로, 태그 강제 정책에서 매우 강력하게 작용한다. `NotNull`이라는 연산자는 없지만, `"aws:RequestTag/Project": "false"`와 같이 사용하면 같은 효과가 발생한다.

### 5-6. 정책 변수

정책 변수는 정책을 일반화하여 사용자, 역할 또는 리소스 정보(예: `${aws:username}`, `${aws:PrincipalTag/Key}`)를 동적으로 대입하는 방식이다. 예를 들어 사용자가 자신의 S3 버킷 경로에만 접근하도록 제한하거나, 특정 사용자 태그에 맞춰 리소스 제어를 동적으로 적용할 때 사용한다.

```json
{
  "Effect":"Allow",
  "Action":[
    "s3:PutObject",
    "s3:GetObject"
  ],
  "Resource":"arn:aws:s3:::my-company-bucket/home/${aws:username}/*"
}
```

다음은 사용자가 가진 `Project` 태그와 해당 리소스의 `Project` 태그가 일치해야 허용되는 정책의 예시로, 가장 많이 사용되는 Best Practices이다.

```json
{
  "Effect":"Allow",
  "Action":[
    "ec2:StartInstances",
    "ec2:StopInstances"
  ],
  "Resource":"*",
  "Condition":{
    "StringEquals":{
      "ec2:ResourceTag/Project":"${aws:PrincipalTag/Project}"
    }
  }
}
```

정책 변수는 문자열/ARN 연산자에서 사용할 수 있고, Numberic/Date/Bool/IP 등 다른 연산자에는 사용할 수 없다. 이러한 패턴은 매우 강력하지만, 실제로 서비스 지원 범위와 실제 동작까지 테스트해야 한다.

## 6. Tag 기반 ABAC 설계

RBAC(Role-Based Access Control)만으로는 리소스 수가 늘어날수롣 정책의 유지보수 및 권한 관리가 매우 어려워진다. 

예를 들어 프로젝트 30개와 팀 8개, 개발/스테이징/프로덕션 환경 3개를 가진 대규모 환경에서 프로젝트별/환경별 역할을 다 따로 만들면 이에 대한 권한 구조가 복잡해진다.

때문에 역할 기반으로 컨트롤하는게 아닌 속성(Attribute) 기반으로 컨트롤하여 이러한 문제를 줄일 수 있다.

이러한 컨트롤 방법을 ABAC(Attribute-Based Access Control)라고 하고, IAM 정책에선 이를 태그로 구현할 수 있다. 

아래의 예시는 위 정책 변수에서 살펴본 예제로, 사용자가 가진 `Project` 태그와 해당 리소스의 `Project` 태그가 일치해야 허용되는 정책이다.

```json
{
  "Effect":"Allow",
  "Action":[
    "ec2:StartInstances",
    "ec2:StopInstances"
  ],
  "Resource":"*",
  "Condition":{
    "StringEquals":{
      "ec2:ResourceTag/Project":"${aws:PrincipalTag/Project}"
    }
  }
}
```

### 6-1. 태그 키

이러한 태그 키엔 `aws:PrincipalTag` 뿐만 아니라 다양한 태그 키(컨텍스트 키)가 존재한다.

- `aws:PrincipalTag/Key` - 요청 주체에 붙은 태그
- `aws:ResourceTag/Key` - 대상 리소스에 붙은 태그
- `aws:RequestTag/Key` - 생성/수정 요청시 설정된 태그
- `aws:TagKeys` - 어떤 태그 키가 요청에 포함되었는지 검사할 때 사용

이에 대한 몇몇 예시는 아래와 같다. 첫번째는 인스턴스 생성시 `Project`와 `Environment` 태그를 강제하는 정책이다.

```json
{
  "Effect": "Deny",
  "Action": "ec2:RunInstances",
  "Resource": "*",
  "Condition": {
    "Null": {
      "aws:RequestTag/Project": "true",
      "aws:RequestTag/Environment": "true"
    }
  }
}
```

다음은 허용 가능한 태그 키를 제한하는 정책으로, `Project`, `Environment` 또는 `Owner` 외의 태그는 사용할 수 없도록 제한한다.

```json
{
  "Effect": "Allow",
  "Action": [
    "ec2:CreateTags",
    "ec2:DeleteTags"
  ],
  "Resource": "*",
  "Condition": {
    "ForAllValues:StringEquals": {
      "aws:TagKeys": ["Project", "Environment", "Owner"]
    }
  }
}
```

`ForAllValues:StringEquals` 연산자는 요청 컨텍스트 키에 있는 모든 값이 정책에 명시된 값 세트 중 하나 이상과 일치해야 함을 의미한다. 

- `ForAllValues:StringEquals` - 요청에 포함된 조건 키의 모든 값이 정책에 나열된 값 중 하나와 일치해야 한다. 즉 나열된 값 이외의 값이 하나라도 존재하면 false가 된다. (전체 일치)
- `ForAnyValue:StringEquals` - 요청에 포함된 조건 키 값 중 최소 하나 이상이 정책에 나열된 값 중 하나와 일치해야 한다. 즉 나열된 값 중 하나라도 일치하면 true를 반환한다. (부분 일치)

다음은 특정 태그 값만 허용하는 정책으로, EC2 인스턴스를 생성할때 `dev` 또는 `stage` 값을 가진 `Environment` 태그만 허용하는 정책이다.

```json
{
  "Effect": "Allow",
  "Action": "ec2:RunInstances",
  "Resource": "*",
  "Condition": {
    "StringEquals": {
      "aws:RequestTag/Environment": ["dev", "stage"]
    }
  }
}
```

### 6-2. 태그 기반 ABAC의 함정

이러한 태그 기반의 ABAC는 아래와 같은 점을 유의하지 않을 경우 큰 보안 사고로 이어질 수 있다. 그 예시는 아래와 같다.

- 태그에 대한 거버넌스가 없을 경우 정책 관리 및 유지보수가 매우 어려워진다. 때문에 누가 어떤 태그를 붙일 수 있는지 통제해야 한다.
- 태그를 수정할 수 있다면 우회가 가능하다. 따라서 태그 수정 권한도 세밀하게 제어해야 한다.
- 서비스마다 태그 Condition 키 지원이 다르다. 예를 들어 어떠한 서비스는 `aws:ResourceTag`를, 어떤 서비스는 `ec2:ResourceTag`와 같은 서비스 전용 키를 요구한다.
- 세션 태그를 사용하는 경우 연동 체계가 중요하다. SSO, SAML, OIDC, AssumeRole 시 어떤 태그가 어떻게 전달되는지 확인해야 한다.

때문에 ABAC에 대한 Best Practices는 아래와 같다.

- 태그에 대한 표준이나 거버넌스를 먼저 정해야 한다. (예: `Project`, `Environment`, `Owner` ...)
- 대소문자 규칙을 통일하라.
- 생성 요청에서 필수 태그를 강제하라.
- 태그 수정 권한은 별도 통제하라.
- 민감한 리소스에 대해선 태그 기반 허용만 믿지 말고 Deny/SCP와 병행하라.

## 7. Explicit Deny 전략

IAM에서 Deny는 단순히 거부한다는 의미를 넘어 Allow의 합집합을 강제로 덮어쓰는 정책이며, 이는 Guardrail 설계에 적합하다. 보안 설계에선 "허용할 것만 쓰기"가 아닌 "반드시 막아야 할 것"을 Deny로 구성해야 한다.

Explicit(명시적) Deny에 적합한 요구사항은 아래와 같다. 

- TLS 요청이 아닐 경우 무조건 차단
- MFA가 없을 경우 고위험 작업 차단
- 특정 리전 외 차단
- 특정 태그가 없는 생성/수정 요청 차단
- 특정 KMS 외 암호화 금지
- 프로덕션 리소스 삭제 차단

이 중 몇몇 예시는 아래와 같다. 첫번째는 S3에서 TLS를 강제한다.

```json
{
  "Sid": "DenyNonTLS",
  "Effect": "Deny",
  "Action": "s3:*",
  "Resource": [
    "arn:aws:s3:::my-prod-bucket",
    "arn:aws:s3:::my-prod-bucket/*"
  ],
  "Condition": {
    "Bool": {
      "aws:SecureTransport": "false"
    }
  }
}
```

다음은 필수 태그가 없는 리소스 생성을 차단한다.

```json
{
  "Sid": "DenyRunInstancesWithoutRequiredTags",
  "Effect": "Deny",
  "Action": "ec2:RunInstances",
  "Resource": "*",
  "Condition": {
    "Null": {
      "aws:RequestTag/Project": "true",
      "aws:RequestTag/Owner": "true"
    }
  }
}
```

다은 프로덕션 리소스를 삭제를 차단한다. (앞서 설명하였듯 서비스별 태그 Condition 키 지원 범위를 확인해야 한다.)

```json
{
  "Sid": "DenyDeleteOnProdTaggedResources",
  "Effect": "Deny",
  "Action": [
    "ec2:TerminateInstances",
    "rds:DeleteDBInstance",
    "s3:DeleteObject"
  ],
  "Resource": "*",
  "Condition": {
    "StringEquals": {
      "aws:ResourceTag/Environment": "prod"
    }
  }
}
```

다음은 `ap-northeast-2` 리전 외의 리소스 작업을 제외하되, 글로벌 리소스는 제외한다.

```json
{
  "Sid": "DenyAllOutsideSeoul",
  "Effect":"Deny",
  "NotAction":[
    "iam:*",
    "organizations:*",
    "route53:*",
    "budgets:*",
    "globalaccelerator:*",
    "cloudfront:*"
  ],
  "Resource":"*",
  "Condition":{
    "StringNotEquals":{
      "aws:RequestedRegion":[
        "ap-northeast-2"
      ]
    }
  }
}
```

이러한 Explicit Deny를 사용할때 주의해야할 점은 아래와 같다.

- Deny를 남발하면 운영에 차질이 생길 수 있다.
- 예외를 둬야한다면 명확히 설계하라.
- 실제 운영에선 Break-Glass 역할이 필요할 수 있으며 이에 대한 예외를 둘 필요가 있을 수 있다.

## 8. 서비스별 ARN 구조 및 읽는 방법

IAM 정책을 다룰때 Resource나 일부 Condition에서 ARN(Amazon Resource Name)이 사용된다. 이러한 ARN은 대부분 아래와 같은 형태이다.

```html
arn:<partition>:<service>:<region>:<account-id>:<resource>
```

- `<partition>` - 대부분 `aws`이지만, AWS CN = `aws-cn`, AWS GovCloud = `aws-us-gov`과 같이 다른 리전 그룹이 사용될 수 있음.
- `<service>` - `s3`, `ec2`와 같이 AWS 서비스를 의미함.
- `<region>` - `ap-northeast-2`, `us-east-1`와 같은 리전이 포함됨.
- `<account-id>` - 12자리 숫자의 계정 ID가 포함됨. 
- `<resource>` - 해당 서비스의 리소스 유형이나 세부 아이디를 의미함. (`/` 또는 `:`으로 구분)

하지만 일부 ARN은 차이가 있을 수 있는데, 대표적으로 S3 버킷은 글로벌 리소스로 분류되어 Region 명시가 없고 Account ID 명시도 없다.

```
arn:aws:s3:::my-bucket
arn:aws:s3:::my-bucket/path/to/object.txt
arn:aws:s3:::my-bucket/prefix/*
```

이때 첫번째는 버킷 ARN이며, 객체 ARN은 `/` 구분자가 포함되어 있을 경우이다. 다른 예시로 EC2 관련 ARN은 아래와 같다.

```
arn:aws:ec2:ap-northeast-2:123456789012:instance/i-0123456789abcdef0
arn:aws:ec2:ap-northeast-2:123456789012:volume/vol-0123456789abcdef0
arn:aws:ec2:ap-northeast-2:123456789012:security-group/sg-0123456789abcdef0
```

이 경우엔 Region 및 Account ID 지정이 필요하며 리소스 타입이 ARN 안에 직접 드러난다. 아래는 Lambda 함수에 대한 ARN 예시이다.

```
arn:aws:lambda:ap-northeast-2:123456789012:function:my-func
arn:aws:lambda:ap-northeast-2:123456789012:function:my-func:1
arn:aws:lambda:ap-northeast-2:123456789012:function:my-func:prod
```

이때 아래 2개와 같이 버전이나 Alias를 구분해야 하는 경우가 있을 수도 있다. Alias를 사용하는 다른 서비스인 KMS 또한 2가지 형태로 표현될 수 있다. 

```
arn:aws:kms:ap-northeast-2:123456789012:key/11111111-2222-3333-4444-555555555555
arn:aws:kms:ap-northeast-2:123456789012:alias/my-key
```

이 경우엔 어떠한 Action은 Key ARN을, 어떠한 워크플로우는 Alias를 참조하기도 하니 이에 대해선 공식 문서를 참조하자. 마지막으로 Secrets Manager와 같이 Suffix를 고려해야 하는 경우도 있다.

```
arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:prod/db-password-AbCdEf
```

- Refs: https://docs.aws.amazon.com/service-authorization/latest/reference/reference.html

## 9. 정책 유형별 상호작용

AWS IAM 정책은 지금까지 알아본 Identity-based Policy와 Resource-based Policy 외에도 서로 다른 레이어에서 권한을 제한할 수 있다. 그 종류는 크게 아래와 같다.

- Identity-based Policy
- Resource-based Policy
- Permissions Boundary
- Session Policy
- SCP(Service Control Policy)

### Identity-based Policy

사용자, 그룹, 역할에 붙는 정책으로 가장 기본적인 권한 제어 수단이다. 해당 정책은 이 주체(Principal)가 무엇을 할 수 있는가를 정의하며, 아래의 정책은 S3 버킷의 특정 경로만 읽기를 허용하는 예시이다.

```
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadReports",
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::my-bucket/reports/*"
    }
  ]
}
```

### Resource-based Policy

이는 리소스 자체에 붙는 정책으로, "누가 이 리소스에 접근할 수 있는가"를 나타낸다. 이러한 정책을 구성할 수 있는 예시는 아래와 같다.

- S3 Bucket Policy
- KMS Key Policy
- SNS Topic Policy
- SQS Queue Policy
- Lambda Resource Policy (실행 역할과 전혀 다름)
- IAM Role Trust Policy (특수한 의미의 신뢰 정책)

특징은 Principal 명시가 필수적이고, Cross-Account 접근에 매우 중요하며 조건 만족시 Identity Policy 없이도 접근할 수 있다. 아래의 예시는 특정 계정에게 S3 접근을 허용하는 예시이다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowExternalAccount",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:root"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-bucket/*"
    }
  ]
}
```

이 경우 123456789012 계정은 특별한 Deny 등의 정책이 있지 않는한 IAM 주체를 가지고 접근할 수 있다. (단, 익명의 모든 요청에 대해 허용하려면 `Principal: "*"`을 명시해야함)

또 다른 예시로 S3 + Cloudfront 조합에서 Cloudfront OAC 구성 시 오리진 버킷에 설정하는 버킷 정책의 예시이다.

```json
{
  "Version":"2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipalReadOnly",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::amzn-s3-demo-bucket/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::111122223333:distribution/<CloudFront distribution ID>"
        }
      }
    }
  ]
}
```

이 경우 Principal에 Cloudfront를 뜻하는 `cloudfront.amazonaws.com`을 주고, Condition으로 Cloudfront ARN을 제한한다. (Principal에 역할 ARN을 줄 순 있지만 리소스 자체의 ARN을 줄 순 없다.)

### Permissions Boundary

Permissions Boundary는 IAM 유저나 역할이 가질 수 있는 최대 권한(Upper Bound, 상한선)을 구성하는 고급 기능이다.

예를 들어 개발자 역할 생성 자동화를 위임하되, 그 역할이 IAM/KMS/Organizations 권한까지 가져가지는 못하게 하고 싶을 때 이러한 Permissions Boundary가 유용할 수 있다.

Identity Policy와 AND(또는 교집합) 관계로, 실제 권한은 아래와 같다.

```
최종 권한 = Identity Policy
           ∩ Permissions Boundary
           ∩ SCP 
           ∩ Session Policy
```

다음은 S3 작업만 허용하는 Boundary이다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OnlyS3",
      "Effect": "Allow",
      "Action": "s3:*",
      "Resource": "*"
    }
  ]
}
```

또 다른 예시로 Role 생성은 가능하지만 반드시 특정 Permissions Boundary를 명시해야 하는 정책으로, 역할에 대한 제한을 강제할때 유용하게 사용할 수 있다.

```json
{
  "Effect": "Allow",
  "Action": "iam:CreateRole",
  "Resource": "*",
  "Condition": {
    "StringEquals": {
      "iam:PermissionsBoundary": "arn:aws:iam::123456789012:policy/boundary"
    }
  }
}
```

이는 Delegation 시 필수적인 방식으로 권한을 탈취하는 행위를 막도록 하는 안전 장치이다.

### Session Policy

Session Policy는 STS AssumeRole 시 임시로 적용되는 정책으로, 이에 대해선 밑에서 다루겠지만 이번 세션에서만 권한 제한을 주는 정책이라고 생각하면 된다.

AssumeRole 시 Inline으로 전달하며, 그 권한이 Identity Policy보다 더 좁혀진다. 아래의 예시는 AssumeRole을 하되 S3 읽기만 허용하는 Session 정책이다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SessionRestrict",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "*"
    }
  ]
}
```

```shell
aws sts assume-role \
  --role-arn arn:aws:iam::123456789012:role/Admin \
  --role-session-name test \
  --policy file://session-policy.json
```

즉 권한을 추가하는 것이 아닌 반대로 축소하는 정책으로, 임시 권한 제어에서 유용하게 작용할 수 있다. 

### SCP(Service Control Policy)

SCP(Service Control Policy)는 AWS Organizations에서 사용되는 정책으로 계정 전체의 최대 권한을 제한한다.

OU/Account 단위에 적용되며 루트를 포함한 모든 IAM에 영향을 미치는 Guardrail 역할이다. 아래는 EC2 생성을 금지하는 SCP 정책의 예시이다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyEC2",
      "Effect": "Deny",
      "Action": "ec2:RunInstances",
      "Resource": "*"
    }
  ]
}
```

여기서 주로 Deny가 사용되는 이유는 SCP가 없다면 기본적으로 FullAWSAccess를 가지기 때문으로, 물론 Allow 정책도 사용할 수 있다.

### Trust Policy와 Permission Policy 구분

번외이지만, 역할에는 어떠한 Assume 이후 이 역할이 무엇을 할 수 있냐를 결정하는 Permission Policy와 누가 이 역할을 Assume할 수 있냐를 결정하는 Trust Policy로 구성된다. 

Permission Policy는 특정 정책을 연결(Attach)하거나 인라인 정책을 추가할 수 있고, Trust Policy는 아래와 같이 사용될 수 있다. 다음은 EC2 인스턴스가 이 역할을 사용하고 위임될 수 있도록 한다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

또는 다른 계정이 해당 역할을 위임할 수 있도록 Trust Policy를 구성할 수 있다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111111111111:root" 
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

이러한 Trust Policy의 Action은 `sts:` 계열만 포함될 수 있다. AWS STS(Security Token Service)가 궁금하다면 별도로 찾아보길 바란다.

## 10. Practice 1. S3에서의 Fine-Grained 설계

10번째 절과 11번째 절은 Fine-Grained에서 대표적으로 언급되는 리소스인 S3와 EC2/Lambda/Secrets Manager/KMS에 대한 Fine-Grained IAM Policy 설계 방법을 기술한다. 

이 절에선 S3 Prefix 제한, TLS 강제, 업로드시 암호화 강제, VPC Endpoint 경유 강제 등에 대해 짧막하게 다뤄본다.

### Prefix 제한

아래는 `s3:prefix` Condition 키를 이용하여 특정 Prefix만 제한하도록 하는 예제이다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListOnlyReportsPrefix",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::company-data",
      "Condition": {
        "StringLike": {
          "s3:prefix": ["reports", "reports/*"]
        }
      }
    },
    {
      "Sid": "ReadOnlyReportsObjects",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::company-data/reports/*"
    }
  ]
}
```

S3 버킷 자체는 Resource ARN에 경로 기반으로 작성하는 것이 아닌 `s3:prefix` Condition 키를 사용해야 한다. 

이는 ListBucket는 엄밀히 따지만 버킷의 메타데이터를 조회하는 속성 중 하나로, ARN에 경로를 포함할 수 없다. 때문에 S3 리소스에서 제공하는 `s3:prefix` 키를 사용하는 것이다.

이를 구별하는 방법은 생각보다 간단한데, S3 버킷을 대상으로 하는 API엔 버킷 자체 Resource ARN을, 특정한 객체를 대상으로 하는 작업은 해당 객체의 ARN이나 와일드카드 문법을 사용할 수 있다.

객체 수준의 작업들의 대표적인 예시는 다음과 같다.

**데이터 접근 계열**

- `s3:GetObject`
- `s3:PutObject`
- `s3:DeleteObject`
- `s3:GetObjectVersion`
- `s3:DeleteObjectVersion`

**ACL / 메타데이터 계열**

- `s3:GetObjectAcl`
- `s3:PutObjectAcl`
- `s3:GetObjectTagging`
- `s3:PutObjectTagging`
- `s3:DeleteObjectTagging`

**기타**

- `s3:RestoreObject (Glacier)`
- `s3:AbortMultipartUpload`
- `s3:ListMultipartUploadParts`

아래는 경로를 포함할 수 없는, 즉 버킷 자체의 ARN을 명시해야 하는 작업들의 대표적인 예시이다.

- `s3:ListBucket`
- `s3:ListBucketVersions`
- `s3:ListBucketMultipartUploads`
- `s3:GetBucketLocation`
- `s3:GetBucketPolicy`
- `s3:PutBucketPolicy`
- `s3:CreateBucket`
- `s3:DeleteBucket`

예를 들어 잘못된 예시는 아래와 같다.

```json
{
  "Action": "s3:ListBucket",
  "Resource": "arn:aws:s3:::my-bucket/reports/*"
}
```

이렇게 Resource 대상이 다를 경우(예: List 제한과 Object 접근 제한) 서로 다른 Statement로 분리하는 것이 Best Practices이다.

또한 S3는 객체 기반의 저장소로 `prefix`는 디렉토리(폴더)가 아니라 객체 키의 문자열 앞부분임을 고려하자.

### TLS 강제

이는 앞에서 여러번 살펴보았으니 설명은 생략하겠다. 

```json
{
  "Sid": "DenyNonTLS",
  "Effect": "Deny",
  "Action": "s3:*",
  "Resource": [
    "arn:aws:s3:::my-prod-bucket",
    "arn:aws:s3:::my-prod-bucket/*"
  ],
  "Condition": {
    "Bool": {
      "aws:SecureTransport": "false"
    }
  }
}
```

### 업로드 암호화 강제

현재의 S3는 모든 업로드 객체에 대해 기본적으로 SSE-S3(Server Side)을 통해 암호화하지만, 여전히 특정 암호화 모드나 특정 KMS 키를 강제하려면 정책 제어가 필요하다.

예를 들어 SSE-KMS 및 특정 KMS 키를 사용하도록 제한하는 정책은 아래와 같다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyMissingSSEHeader",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::company-sensitive/*",
      "Condition": {
        "Null": {
          "s3:x-amz-server-side-encryption": "true"
        }
      }
    },
    {
      "Sid": "DenyMissingKMSKeyId",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::company-sensitive/*",
      "Condition": {
        "Null": {
          "s3:x-amz-server-side-encryption-aws-kms-key-id": "true"
        }
      }
    },
    {
      "Sid": "DenyIncorrectEncryptionAlgorithm",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::company-sensitive/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": "aws:kms"
        }
      }
    },
    {
      "Sid": "DenyWrongKMSKey",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::company-sensitive/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption-aws-kms-key-id": "arn:aws:kms:ap-northeast-2:123456789012:key/11111111-2222-3333-4444-555555555555"
        }
      }
    }
  ]
}
```

여기서 일부 컨텍스트에 따라 `x-amz-server-side-encryption`, `x-amz-server-side-encryption-aws-kms-key-id` 키가 없을 수 있으니 Null 연산자를 통해 1차로 걸러준다.

### VPC Endpoint 경유 강제

S3 보안 Best Practices에서 VPC Endpoint를 활용해 인터넷을 경유하지 않는 접근 경로를 설계하는 과정을 설명한다. 민감한 데이터가 포함된 버킷이라면 아래와 같은 추가적인 제어를 고려해볼 수 있다.

- 특정 VPC Endpoint를 통하지 않으면 접근 거부
- 프라이빗 서브넷 + 인터넷 게이트웨이가 없는 VPC와 결합
- 버킷 정책에서 Source VPC 사용

물론 3번째의 경우 버킷 정책(Resource-based)가 아닌 Identity-based 정책에서 Source VPCE를 지정할 수 있지만, 이 경우 버킷 정책에서 따로 구성된게 아니라면 다른 역할은 허용될 수 있으므로 버킷 정책으로 구성하는 것을 권장한다.

다음은 버킷 정책에서 모든 주체(`"Principal": "*"`)에 대해 특정 VPC Endpoint 경유를 강제하는 Resource-based 정책이다.

```json
{
  "Sid": "AllowOnlyThroughSpecificVPCEndpoint",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": [
    "arn:aws:s3:::company-sensitive",
    "arn:aws:s3:::company-sensitive/*"
  ],
  "Condition": {
    "StringNotEquals": {
      "aws:SourceVpce": "vpce-0123456789abcdef0"
    }
  }
}
```

## 11. Practice 2. EC2/Lambda/Secrets Manager/KMS에서의 Fine-Grained 설계

### EC2

다음은 Tag 기반으로 같은 프로젝트 내 인스턴스만 Start/Stop 할 수 있는 정책이다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowReadOnlyDescribe",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeTags"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AllowStartStopOnlyOwnProject",
      "Effect": "Allow",
      "Action": [
        "ec2:StartInstances",
        "ec2:StopInstances"
      ],
      "Resource": "arn:aws:ec2:ap-northeast-2:123456789012:instance/*",
      "Condition": {
        "StringEquals": {
          "ec2:ResourceTag/Project": "${aws:PrincipalTag/Project}"
        }
      }
    }
  ]
}
```

이러한 정책은 문제가 없지만 실제로는 사용자가 태그를 바꿀 수 있는지 등의 추가적인 사항을 검토해야 한다. 아래는 Project 태그를 포함하는 태그 생성/삭제 작업을 차단한다.

```json
{
  "Sid": "DenyModifyProjectTag",
  "Effect": "Deny",
  "Action": [
    "ec2:CreateTags",
    "ec2:DeleteTags"
  ],
  "Resource": "arn:aws:ec2:ap-northeast-2:123456789012:instance/*",
  "Condition": {
    "ForAnyValue:StringEquals": {
      "aws:TagKeys": ["Project"]
    }
  }
}
```

또는 특정 역할만 태그 변경을 허용하도록 `aws:PrincipalArn` Condition 키를 지정할 수 있다.

```json
{
  "Sid": "AllowTaggingOnlyFromAdminRole",
  "Effect": "Deny",
  "Action": [
    "ec2:CreateTags",
    "ec2:DeleteTags"
  ],
  "Resource": "*",
  "Condition": {
    "StringNotEquals": {
      "aws:PrincipalArn": "arn:aws:iam::123456789012:role/Admin"
    }
  }
}
```

또한 새로운 인스턴스 생성시 자신의 `Project` 태그 값만 허용되도록 제한할 수 있다.

```json
{
  "Sid": "RestrictTagOnCreate",
  "Effect": "Allow",
  "Action": "ec2:RunInstances",
  "Resource": "*",
  "Condition": {
    "StringEquals": {
      "aws:RequestTag/Project": "${aws:PrincipalTag/Project}"
    }
  }
}
```

### Lambda

다음은 특정 함수만 Invoke 할 수 있도록 제한하는 정책이다. 이때 Alias/Version 구분이 필요한지 확인하고 함수 수정 권한과 Invoke 권한을 혼동하지 말아야 한다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowInvokeSpecificFunctions",
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": [
        "arn:aws:lambda:ap-northeast-2:123456789012:function:report-*"
      ]
    }
  ]
}
```

### Secrets Manager / KMS

Secrets Manager는 특정 Secret을 읽을때 `secretsmanager:GetSecretValue` Action이 필요하다. 또한 KMS CMK 사용시 암호화 해독을 위해 `kms:Decrypt`가 함께 요구될 수 있다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadOnlySpecificSecret",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:ap-northeast-2:123456789012:secret:prod/app/db-*"
    },
    {
      "Sid": "DecryptOnlyWithApprovedKey",
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt",
        "kms:DescribeKey"
      ],
      "Resource": "arn:aws:kms:ap-northeast-2:123456789012:key/11111111-2222-3333-4444-555555555555"
    }
  ]
}
```

이때 KMS는 IAM Policy만으로 설명이 끝나지 않는다. 이 외에도 Cross-Account, 서비스 통합, 키 정책 등 여러 요소가 겹칠 수 있다. 

특히 키 정책은 Resource-based 정책의 대표적인 예시로, KMS 암호화 키에 대한 접근 권한을 정의하는 리소스 기반 정책이자 누가(Principal) 어떤 조건에서 해당 키를 사용하여 암호화/복호화(Action)할 수 있는지 결정한다.

기본적으로 단일 키 정책을 필수로 가지며, 기본적으로 아래와 같다.

```json
{
  "Id": "key-consolepolicy-3",
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Enable IAM User Permissions",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:root"
      },
      "Action": "kms:*",
      "Resource": "*"
    }
  ]
}
```

여기서 키 사용이 가능한 주체, 키 관리가 가능한 주체 등에 대한 구성 방법은 공식 문서를 참조하길 바란다. (정책이 길어져 설명은 생략한다.)

## 12. `sts:AssumeRole`과 `iam:PassRole`

하나의 예시로 EC2에서 S3에 접근하기 위해선 S3와 관련된 권한이 포함된 실행 역할(Execution Role)이 필요하다. 

이와 같이 특정 주체(EC2와 같은 컴퓨팅 리소스나 유저 등)가 특정한 역할의 임시 자격 증명을 발급받기 위해선 `sts:AssumeRole`을 API 호출이 필요하다.

이는 대상 역할의 Trust Policy(신뢰 정책)에서 구성할 수 있고, 다음은 EC2 리소스 주체에서 해당 역할에 대해 임시 자격 증명을 얻기 위해 AssumeRole을 허용하는 Trust Policy의 예시이다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

다음은 주체가 EC2가 아닌 특정 사용자가 대상인 Trust Policy로, 사용자의 경우 사용자가 해당 역할을 Assume할 수 있도록 Permissions Policy가 필요하다. 

> 단 EC2의 경우 EC2가 직접 AssumeRole을 호출하는 것이 아닌 AWS가 대신 호출하기 때문에 이러한 Permissions Policy가 요구되지 않는 것이다.
> 
> 이에 대해서 관심이 있다면 Instance Metadata Service (IMDS)를 참조하길 바란다. EC2는 아래와 같은 API를 호출한다면 AWS가 뒤에서 AssumeRole API를 호출한다.
> 
> ```shell
> curl http://169.254.169.254/latest/meta-data/iam/security-credentials/MyRole
> ```

```json
{
  "Effect": "Allow",
  "Action": "sts:AssumeRole",
  "Resource": "arn:aws:iam::123456789012:role/AdminRole"
}
```

Role의 입장으로 `AdminRole`의 Trust Policy는 아래와 같다. 

```json
{
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::111111111111:user/dev-user"
  },
  "Action": "sts:AssumeRole"
}
```

이러한 점으로 Trust Policy도 일종의 Resource-based Policy라고 볼 수 있다. 만약 EC2 내에서 직접 STS Assume API를 호출해야 한다면 아래와 같이 구성해야 한다.

- EC2에 붙는 실행 역할: `AppRole`
- 추가로 사용하려는 역할: `AdminRole`

**`AppRole` Permissions Policy**

```json
{
  "Effect": "Allow",
  "Action": "sts:AssumeRole",
  "Resource": "arn:aws:iam::123456789012:role/AdminRole"
}
```

**`AdminRole` Trust Policy**

```json
{
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::111111111111:role/AppRole"
  },
  "Action": "sts:AssumeRole"
}
```

이제 EC2 내부에서 직접 STS Assume Role을 실행할 수 있다.

```shell
aws sts assume-role ...
```

이때 사용자가 EC2와 같이 역할을 요구할 수 있는 서비스에 역할을 전달하는 권한이 `iam:PassRole`이다. 즉 다른 서비스에 특정 역할을 사용해도 된다고 허용하는 권한인 것이다.

만약 EC2 생성시 특정 실행 역할을 지정하였다면 EC2를 만드는 주체에 PassRole 권한이 있는지 확인한다. 

```json
{
  "Effect": "Allow",
  "Action": "iam:PassRole",
  "Resource": "arn:aws:iam::123456789012:role/EC2Role"
}
```

또는 권한을 넘길 특정 대상 서비스만 지정하려면 `iam:PassedToService` Condition 키를 지정하면 된다.

```json
{
  "Effect":"Allow",
  "Action":[
    "iam:PassRole"
  ],
  "Resource":"arn:aws:iam::123456789012:role/EC2Role",
  "Condition":{
    "StringEquals":{
      "iam:PassedToService":"ec2.amazonaws.com"
    }
  }
}
```

이렇게 서비스에 역할을 전달(Pass)할 수 있는 서비스의 대표적인 예시는 다음과 같다.

- EC2 인스턴스 프로필에 실행 역할 지정
- Lambda 함수에 실행 역할 지정
- ECS Task 역할 지정
- Step Functions State Machine 역할 지정

하지만 PassRole은 잘못 사용하면 간접적인 권한 상승 루트가 될 수 있는데, 예시로 사용자 자신은 S3 권한이 없더라도 S3 FullAccess 역할을 Lambda에 연결할 수 있다면 결국엔 해당 서비스가 그 권한을 대신 사용할 수 있기 때문이다.

때문에 `iam:PassRole` 사용에 있어 Best Practices는 아래와 같다.

- `iam:PassRole`은 반드시 특정 Resource 수준으로 제한
- 가능한 한 역할 이름/경로/Prefix 규칙을 사용
- 어떤 서비스에 넘길 수 있는지를 `iam:PassedToService`를 비롯한 Condition 키로 제한
- 역할 자체도 Boundary/SCP로 제한

하나의 예시로 다음은 Lambda 함수에만 `service-role/lambda-exec-*` 역할을 전달(Pass)할 수 있는 권한이다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPassOnlyLambdaExecRoles",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::123456789012:role/service-role/lambda-exec-*",
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "lambda.amazonaws.com"
        }
      }
    }
  ]
}
```

## 13. Permissions Boundary 구성

앞서 언급하였지만 Permissions Boundary는 해당 역할이 가질 수 있는 최대 권한, 즉 상한선(Upper Bound)을 제어하는 기능이다. 

하나의 예시로 개발자 역할에 대해 생성할 수 있는 하위 역할의 최대 권한을 제한하는 방법은 아래와 같다.

**AppRoleBoundary** (이는 Permissions Policy가 아닌 Boundary로 사용할 정책이다.)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowOnlyAppLevelServices",
      "Effect": "Allow",
      "Action": [
        "logs:*",
        "s3:GetObject",
        "s3:PutObject",
        "secretsmanager:GetSecretValue",
        "kms:Decrypt"
      ],
      "Resource": "*"
    }
  ]
}
```

이제 개발자에게 아래와 같이 역할 생성 권한을 주되, 반드시 이 Boundary를 붙이게 강제할 수 있다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCreateRoleWithBoundary",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:PutRolePolicy",
        "iam:AttachRolePolicy"
      ],
      "Resource": "arn:aws:iam::123456789012:role/app/*",
      "Condition": {
        "StringEquals": {
          "iam:PermissionsBoundary": "arn:aws:iam::123456789012:policy/AppRoleBoundary"
        }
      }
    }
  ]
}
```

Permissions Boundary의 동작 방식이나 다른 정책 유형별 상호작용은 위에서 다룬적이 있으니 넘어가겠다.

## 14. Organizations SCP를 이용한 상위 Guardrail 구성

SCP(Service Control Policy)는 조직 단위의 Guardrail 정책으로, AWS Organizations에서 계정/OU/Root에 걸리는 최대 권한 제어로 설명된다.

예를 들어 아래와 같은 상황에서 유용하게 작용할 수 있을 것이다.

- 특정 리전 외 사용 금지
- IAM/Organizations/KMS와 같은 민감한 서비스 제한
- 프로덕션 계정에서는 특정 삭제 Action 제한
- 특정 서비스 자체를 금지

이는 조직 단위이기 때문에 Permissions Boundary보다 높고, 한 계정 전체의 상한선을 지정한다. 예를 들어 IAM 역할에 S3 FullAccess가 있어도 SCP에서 `s3:*`를 막으면 실제로는 사용이 불가하다.

다음은 특정 리전 외에는 글로벌 서비스를 제외한 모든 Action을 차단하는 SCP 예시이다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyOutsideApprovedRegions",
      "Effect": "Deny",
      "NotAction": [
        "iam:*",
        "organizations:*",
        "route53:*",
        "cloudfront:*"
      ],
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "aws:RequestedRegion": [
            "ap-northeast-2",
            "ap-northeast-1"
          ]
        }
      }
    }
  ]
}
```

글로벌 서비스는 특정한 리전을 지정할 수 없으므로 위와 같이 예외 목록을 두지 않으면 예상치 못한 장애가 발생할 수 있다. 따라서 리전을 제한하는 SCP는 사전 검증이 필요하다.

SCP 사용에 있어 Best Practices는 다음과 같다.

- Allowlist 모델과 Denylist 모델 중 무엇인지 명확히 이해하라.
- 프로덕션에 바로 적용하지 말고 샌드박스 OU에서 검증하라.
- 운영에 있어 필수적인 서비스 예외를 파악하라.
- Break-Glass 계정/역할 전력을 마련하라.

## 15. Practice 3. 복잡한 아키텍처에서의 권한 설계

다음 요구사항에 대한 적절한 정책을 작성해보자. 

- 개발자는 자기 프로젝트의 EC2만 시작/중지 가능
- 프로덕션 태그 리소스는 삭제 불가
- S3 `uploads/` 경로(키 Prefix)에만 업로드 가능
- 업로드는 HTTPS + 특정 KMS 키 암호화 필수
- Lambda에 넘길 수 있는 역할은 특정 접두사만 허용

이를 세부적으로 분해해보면 아래와 같다. (필요한 요소만 서술한다.)

**주체**

- 개발자 역할 (동일)

**리소스**

- EC2 Instance
- S3 Bucket/Prefix
- IAM Role(Pass 대상)
- KMS Key

**작업(Action)**

- EC2 Start/Stop
- S3 PutObject
- IAM PassRole

**조건(Condition)**

- ResourceTag = PrincipalTag
- `aws:SecureTransport` = true
- 암호화 헤더 = `aws:kms`
- 특정 KMS Key ID
- `iam:PassedToService` = `lambda.amazonaws.com`

**강제 사항(Explicit Deny)**

- 프로덕션 리소스 삭제 차단
- HTTPS 강제
- KMS 키 강제

이에 대해 정책을 작성하는 순서는 읽기 권한/탐색 권한부터 분리하고 실제 작업 권한을 Resource 최소 범위로 작성한다. 

이후 조건을 붙여 세밀화하고 강제 조건은 Explicit Deny로 제한한다. 또한 PassRole/Boundary/SCP가 필요한지 확인하고, 최종적으로 Validation/Analyzer 및 Simulator룰 통해 검증해야 한다. 

요구사항에 맞는 IAM 정책은 아래와 같다. 요구사항 별로 Statement를 분리하였다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadInventory",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeTags",
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": "*"
    },
    {
      "Sid": "StartStopOwnProjectInstances",
      "Effect": "Allow",
      "Action": [
        "ec2:StartInstances",
        "ec2:StopInstances"
      ],
      "Resource": "arn:aws:ec2:ap-northeast-2:123456789012:instance/*",
      "Condition": {
        "StringEquals": {
          "ec2:ResourceTag/Project": "${aws:PrincipalTag/Project}"
        }
      }
    },
    {
      "Sid": "AllowUploadToUploadsPrefixOnly",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::my-app-bucket/uploads/*"
    },
    {
      "Sid": "DenyNonTLSForBucket",
      "Effect": "Deny",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::my-app-bucket",
        "arn:aws:s3:::my-app-bucket/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    },
    {
      "Sid": "DenyUploadsWithoutKMS",
      "Effect": "Deny",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::my-app-bucket/uploads/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": "aws:kms"
        }
      }
    },
    {
      "Sid": "DenyUploadsWithWrongKMSKey",
      "Effect": "Deny",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::my-app-bucket/uploads/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption-aws-kms-key-id": "arn:aws:kms:ap-northeast-2:123456789012:key/11111111-2222-3333-4444-555555555555"
        }
      }
    },
    {
      "Sid": "AllowPassOnlyApprovedLambdaRoles",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::123456789012:role/service-role/lambda-exec-*",
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "lambda.amazonaws.com"
        }
      }
    }
  ]
}
```

만약 의도치 않은 에러가 발생할 경우 CloudTrail 이벤트를 통해 확인해볼 수 있고, 이는 아래와 같은 세부적인 정보를 확인하여 디버깅할 수 있다.

- 어떤 Principal ARN이 호출했는가
- 어떤 Action이 호출됐는가
- 어떤 Resource가 대상이었는가
- Request Parameters에 어떤 값이 있었는가
- AccessDenied 메시지 세부 원인
- Service Event 이름과 Policy Expectation이 일치하는가

또한 정책에 대한 디버깅 체크리스트는 아래를 참고하면 좋을 것이다.

- Action 이름/유형이 정확한가 
- 리소스 ARN이 정확한가
- 해당 Action이 리소스 수준의 지원을 하는가
- Condition 키가 해당 Action/리소스에서 유요한가
- Identity Policy 외 Boundary/SCP/Resource Policy가 막고 있지는 않은가
- Session 태그가 실제로 전달되고 있는가
- Cross-Account인 경우 Trust/Resource Policy까지 맞는가

이에 대해선 앞서 언급한 AWS 공식 문서를 참조하면 큰 도움이 될 것이다.

- Refs: https://docs.aws.amazon.com/service-authorization/latest/reference/reference.html

## 16. 참고 자료

- IAM Policy evaluation logic - https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html
- IAM JSON policy element reference - https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html
- IAM JSON policy elements: Condition - https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html
- IAM JSON policy elements: Condition operators - https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition_operators.html
- AWS global condition context keys - https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html
- IAM policy variables - https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_variables.html
- Attribute-based access control (ABAC) - https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction_attribute-based-access-control.html
- Controlling access to AWS resources using tags - https://docs.aws.amazon.com/IAM/latest/UserGuide/access_tags.html
- Controlling access to and for IAM users and roles using tags - https://docs.aws.amazon.com/IAM/latest/UserGuide/access_iam-tags.html
- Security best practices in IAM - https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html
- Prepare for least-privilege permissions - https://docs.aws.amazon.com/IAM/latest/UserGuide/getting-started-reduce-permissions.html
- IAM Access Analyzer policy generation - https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-policy-generation.html
- IAM Access Analyzer policy validation - https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-policy-validation.html
- IAM policy simulator - https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_testing-policies.html
- Permissions boundaries for IAM entities - https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html
- Grant a user permissions to pass a role to an AWS service - https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html
- Policies and permissions in IAM - https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html
- AWS Organizations SCP evaluation - https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_evaluation.html
- Service control policies (SCPs) - https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html
- Actions, resources, and condition keys for AWS services - https://docs.aws.amazon.com/service-authorization/latest/reference/reference_policies_actions-resources-contextkeys.html
- S3 bucket policy examples using condition keys - https://docs.aws.amazon.com/AmazonS3/latest/userguide/amazon-s3-policy-keys.html
- Amazon S3 security best practices - https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html
- Amazon S3 example bucket policies - https://docs.aws.amazon.com/AmazonS3/latest/userguide/example-bucket-policies.html
- S3 default encryption / SSE-S3 - https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingServerSideEncryption.html
- Secrets Manager identity-based policies - https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access_iam-policies.html
- Secrets Manager GetSecretValue API - https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html
- Secrets Manager encryption model - https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html
