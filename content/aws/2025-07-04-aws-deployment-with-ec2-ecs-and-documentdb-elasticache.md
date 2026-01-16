---
title: '[AWS Computing] Deployment with EC2 + ECS Fargate + DocumentDB, ElastiCache Redis OSS'
description: 'AWS EC2, ECS Fargate를 통한 MSA 애플리케이션 배포 및 DocumentDB 및 ElastiCache(Redis OSS) 구성 실습'
slug: '2025-07-04-aws-deployment-with-ec2-ecs-and-documentdb-elasticache'
author: yulmwu
date: 2025-07-04T12:53:19.543Z
updated_at: 2025-12-30T08:45:22.692Z
categories: ['AWS']
tags: ['Computing', 'aws']
series:
    name: AWS
    slug: aws
thumbnail: ../../thumbnails/aws/aws-deployment-with-ec2-ecs-and-documentdb-elasticache.png
linked_posts:
    previous: 2025-07-04-ec2-bastion-host
    next: 2025-07-04-aws-deploying-3-tier-architecture
is_private: false
---

> 다른 포스팅과 달리 공부 일지 기록에 가까운 포스팅입니다.
>
> 디테일한 내용을 찾으신다면 다른 포스팅을 참고하시길 바랍니다.

> 이 포스팅에서 사용된 아키텍처는 마이스터넷 지방기능경기대회 클라우드 부분 2024 1과제를 참고하였으며, 저작권은 마이스터넷(한국산업인력공단)에 있음을 미리 알립니다.
>
> ![](https://velog.velcdn.com/images/yulmwu/post/a1f5c97c-c203-4f5b-bcaf-476d1c9e1573/image.png)
>
> 사용된 자료는 [마이스터넷 "시행자료 및 공개 과제"](https://meister.hrdkorea.or.kr/sub/3/6/4/informationSquare/enforceData.do)를 참고하였습니다.
>
> 배포 파일은 따로 제공하지 않아 직접 배포할 코드를 작성하였고, 아래의 깃허브 레포지토리에서 확인할 수 있습니다.
>
> https://github.com/eocndp/msa-example-1

# 0. AWS Architecture

![](https://velog.velcdn.com/images/yulmwu/post/bd88d379-0070-4bdf-bff9-5c7244c96adf/image.png)

편의를 위해 과제에 나온 아키텍처는 유지하면서 서브넷에 CIDR 정보를 추가하였고, 여러가지 부가적인 내용도 추가하였다. 또한 기존엔 EKS를 사용하는 아키텍처였으나, ECS로 대체하였다.

대충 설명하자면 아래와 같다.

- 배포하려는 아티팩트는 간단한 게시판 API 서버로, MSA 구조로 인증 서비스(Auth API Service)와 나머지 게시글 관련 API를 담당하는 Board API Service로 나뉜다.
- Auth API Service는 도커 이미지 빌드 후 ECR에 업로드된다. 이후 ECS Fargate에서 ECR의 이미지를 pull하여 사용한다. (Fargate 프로파일 등은 추후 다루겠다.)
- Board API Service는 EC2 위에 올라간다. 이것도 도커 등으로 컨테이너화해서 올릴 수 있겠지만, 간단하게 직접 소스코드를 실행하고 PM2를 사용하여 무중단 서비스를 진행한다.
- 두 MSA 서비스는 모두 NodeJS + NestJS를 사용하여 제작되었으며, 깃허브 [레포지토리](https://github.com/eocndp/msa-example-1)에서 확인해볼 수 있다.
- 또한 둘 모두 오토스케일링을 적용하며, ALB를 통해 로드밸런싱과 라우팅을 한다.

다음으로 DB와 관련된 설명이다.

- DocumentDB는 유저와 게시글들을 저장하는 용도로 사용한다. MongoDB와 대부분 호환되므로 MongoDB를 기준으로 하였고, 배포 시 DocumentDB로 주소만 환경변수로 다루는 형식으로 진행하였다.
- ElastiCache는 Redis 인메모리 DB를 사용하기 위한 서비스로, 로그인된 유저의 세션 ID를 저장하기 위해 사용된다. 이 경우에도 환경변수의 Redis 주소만 변경하는 형식으로 진행한다.
- DocumentDB와 ElastiCache(Redis) 모두 레플리카를 통해 Failover 대응과 읽기 분산을 한다. 모두 Multi AZ(서브넷 A, B)로 구성한다.

그 외의 서비스는 아래와 같다.

- 세션 시크릿 키는 Secret Manager를 통해 관리한다. 중요한 시크릿 키라는 점과 두 마이크로 서비스에서 공유하는 데이터라는 점에서 Secret Manager를 사용하면 적당하다.
- 마지막으로 Auth API Service(ECS Fargate), Board API Service(EC2)가 존재하는 프라이빗 서브넷 A, B는 각자 퍼블릭 서브넷에 있는 NAT Gateway와 연결되어 인터넷 통신을 가능하게 한다.
- 그리고 하나의 퍼블릭 서브넷엔 Bastion Host를 두어 내부의 EC2 등의 서비스에 접근할 수 있도록 한다.

---

# 1. Let's write the Code

아키텍처를 만들어보기 전, NestJS 코드부터 간단히 보고 넘어가겠다. 크게 Secret Manager를 통한 세션 시크릿 키 관리 로직과 DocumentDB와 호환되는 MongoDB 연동, 그리고 Redis 연동을 살펴보겠다.

코드의 퀄리티를 중점으로 한것이 아니기 때문에 대충 보고 넘어가자. 아래의 3가지는 Board API Service와 Auth API Service 모두 공통되기 때문에 두 서비스를 구분하지 않는다.

## AWS SDK: Secret Manager

AWS SDK 버전은 V3를 사용한다. 때문에 아래와 같은 라이브러리를 설치해야 한다.

```shell
npm i @aws-sdk/client-secrets-manager
```

그리고 Secret Manager에서 키를 가져오는 코드는 아래와 같다. 서버를 켰을 때 한번만 실행되면 되니 NestJS 서비스 DI를 구현하진 않았다.

```ts
async function getSecret(): Promise<Record<string, string>> {
	const client = new SecretsManagerClient({
		region: process.env.AWS_REGION,
	})

	const command = new GetSecretValueCommand({ SecretId: process.env.SESSION_SECRET_NAME })
	const response = await client.send(command)

	if (!response.SecretString) {
		throw new Error('SecretString not found')
	}

	return JSON.parse(response.SecretString)
}
```

그리고 `main.ts`에서 아래와 같이 사용하였다.

```ts
const secret = await getSecret()

app.use(
	session({
		store: new RedisStore({ client: redisClient }),
		secret: secret['session_secret_key'],
		resave: false,
		saveUninitialized: false,
		cookie: {
			secure: false,
			httpOnly: true,
			maxAge: 1000 * 60 * 60 * 24, // 1 day
		},
	}),
)
```

참고로 세션 로직을 담당하는 라이브러리는 `express-session`을 사용하였다. 간단하게 사용할 수 있고, Express 용으로 만들어졌으나 NestJS가 Express를 기반으로 작동할 수 있기 때문에 미들웨어로 사용하였다.

## DB: DocumentDB(MongoDB)

다음으로 DocumentDB는 MongoDB 용으로 코드를 작성하였다. 그래도 서로 호환이 되므로 상관 없다.
MongoDB 클라이언트는 NestJS에서 공식적으로 지원한다. (`@nestjs/mongoose`)

아래와 같이 모듈에서 import하여 사용할 수 있다.

```ts
import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { User, UserSchema } from './user.entity'

@Module({
	imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
	providers: [AuthService],
	controllers: [AuthController],
})
export class AuthModule {}
```

스키마는 아래와 같이 작성하였다. (포스트 스키마는 코드를 따로 참조하길 바람)

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document } from 'mongoose'

@Schema()
export class User extends Document {
	@Prop({ required: true, unique: true })
	username: string

	@Prop({ required: true })
	password: string
}

export const UserSchema = SchemaFactory.createForClass(User)
```

## DB: Redis

Redis는 이 프로젝트에선 단순히 세션 저장용으로 사용하기 때문에 서비스로 만들거나 하진 않았다.
때문에 아래와 같이 `express-session`에 등록해주는 방식으로 사용하였다.

```ts
const redisClient = redis.createClient({
	url: process.env.REDIS_URL!,
})

redisClient.on('error', (err) => {
	console.error('Redis error:', err)
})

redisClient.on('connect', () => {
	console.log('Connected to Redis')
})

await redisClient.connect()

const secret = await getSecret()

app.use(
	session({
		store: new RedisStore({ client: redisClient }), // 세션 저장에 Redis 사용
		secret: secret['session_secret_key'],
		resave: false,
		saveUninitialized: false,
		cookie: {
			secure: false,
			httpOnly: true,
			maxAge: 1000 * 60 * 60 * 24, // 1 day
		},
	}),
)
```

## Environment Variables

환경변수는 아래와 같다. (Auth API Service, Board API Service 공통)

```shell
# PORT=3000
MONGODB_URI=mongodb://localhost:27017/board
REDIS_URL=redis://localhost:6379
SESSION_SECRET_NAME=TestSecret
```

여기서 `MONGODB_URI`, `REDIS_URL`은 추후 DB 구축 후 바꿔 넣도록 하고, `SESSION_SECRET_NAME`은 AWS Secret Manager에서 만들 시크릿 이름이다.

그리고 포트를 따로 환경변수로 지정하며 배포 시엔 3000번으로 통일할 것이나, 개발 환경에선 Auth API Service는 3001번, Board API Service는 3002번으로 설정하였다.

# 2. Let's build the Infra

## (1) Secret Manager

첫번째로 Secret Manager 설정부터 해보자. 참고로 시크릿 하나당 월 0.4$가 고정적으로 청구되고 API 요청 수에 따라 추가적으로 청구되는데, 계정에서 시크릿 생성 후 처음 30일은 무료이니 참고하자. (시크릿 안에 여러개의 키가 있는 구조)

![](https://velog.velcdn.com/images/yulmwu/post/51b57f3d-80fd-4ab7-828b-ab40cc670c9b/image.png)

접속해보면 새 보안 암호 저장 버튼이 있다.

![](https://velog.velcdn.com/images/yulmwu/post/6ace9433-04b2-4a5c-a153-6d0130b3f094/image.png)

보안 암호 유형 선택에선 다른 유형의 보안 암호를 선택한다. RDS나 DocumentDB 등의 자격 증명을 만들 수 도 있는데, 이 포스팅에선 다루지 않는다.

![](https://velog.velcdn.com/images/yulmwu/post/61a6d038-25a8-4445-968d-179fcfb542b8/image.png)

키엔 `session_secret_key`, 값엔 아무 값이나 넣는다. (추후 랜덤한 문자열로 로테이션되게 설정할 예정)

그 외에 필요한 키가 있다면 추가하도록 하고, 다음 버튼을 누른다.

![](https://velog.velcdn.com/images/yulmwu/post/3d9238a2-49da-4fe3-97a2-2ed03f434cc4/image.png)

그러면 교체 구성(로테이션 설정)을 할 수 있는데, 나중에 하도록 하고 일단 시크릿을 만든다.

![](https://velog.velcdn.com/images/yulmwu/post/0b59b281-cf88-4891-b306-2314fa0ff193/image.png)

그리고 검토 후 저장을 클릭하여 시크릿을 만든다.

![](https://velog.velcdn.com/images/yulmwu/post/6c69425c-b82c-4496-914f-53c468370d96/image.png)

이제 테스트를 해보자. NodeJS로 간단하게 테스트해보겠다. (AWS CLI 등으로 로그인하여 자격 증명이 있어야함)

![](https://velog.velcdn.com/images/yulmwu/post/fa188ae5-f32a-4db1-9607-4beb4138409b/image.png)

잘 나오는 것을 볼 수 있다. 이제 키 로테이션 설정을 해볼 수 있으나, 분량 상 길어지고 주제의 범위에 해당되지 않으므로 아래의 포스팅을 참고해보도록 하자.

https://velog.io/@yulmwu/aws-secrets-manager-key-rotation-lambda

## (2) VPC

VPC는 CIDR은 아래와 같이 설정한다.

- VPC: `10.0.0.0/16`
- Public Subnet A: `10.0.0.0/24` (ap-northeast-2a)
- Private Subnet A: `10.0.1.0/24` (ap-northeast-2a)
- Protected Subnet A: `10.0.2.0/24` (ap-northeast-2a)
- Public Subnet B: `10.0.10.0/24` (ap-northeast-2c)
- Private Subnet B: `10.0.11.0/24` (ap-northeast-2c)
- Protected Subnet B: `10.0.12.0/24` (ap-northeast-2c)

NAT Gateway는 Public Subnet A, Public Subnet B에 2개를 배치한다. (하나만 써도 되지만 고가용성을 위해선 각 AZ에 두는것이 좋다)

서브넷 A는 `ap-northeast-2a`, 서브넷 B는 `ap-northeast-2c` AZ에 두도록 하였다.

![](https://velog.velcdn.com/images/yulmwu/post/871cea2b-522e-4fbf-92c6-620a2da80734/image.png)

VPC 설정은 됐다. 그리고 프라이빗 서브넷 `10.0.2.0/24`, `10.0.12.0/24`는 Protected로 사용한다. NAT Gateway를 두지 않은 상태로 완전히 고립시킬 수 있지만, 일단은 연결을 해주었다. 원할 시 라우팅 테이블에서 끊어주기만 하면 된다.

## (3) EC2 Bastion Host

Bastion Host가 뭔지 모르겠다면 아래의 포스팅에서 대충 참고해보자.

https://velog.io/@yulmwu/ec2-bastion-host

![](https://velog.velcdn.com/images/yulmwu/post/4d9da654-359a-4508-be99-8b144bb967c9/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/7b00edf5-c12c-4dc2-917b-db77539133a2/image.png)

네트워크 설정에서 만들어뒀던 VPC로 두고, 퍼블릭 서브넷(A, B 선택)에 배치한다. 그리고 보안그룹에서 SSH를 활성화해야 한다. (기본 값)

![](https://velog.velcdn.com/images/yulmwu/post/c3b67ea8-f0b5-40cc-9c00-8fca3dd44f71/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/061d94ed-2c17-43ca-8bcd-4fee53c5d009/image.png)

잘 된다. 추후 문제가 발생했다면 이 Bastion Host로 접속해서 확인해보거나 하면 된다.

## (4) DocumentDB

이제 데이터베이스 설정을 해보자. 먼저 DocumentDB 구축부터 해보겠다. Protected Subnet A에 Primary DB를 두고, Protected Subnet B에 ReadOnly 레플리카를 두는 형식으로 해보겠다.

먼저 클러스터를 만들기 전, 서브넷 그룹을 만들어주겠다. 여기에 있는 서브넷들을 바탕으로 클러스터가 구성된다.

![](https://velog.velcdn.com/images/yulmwu/post/68b46f77-302b-4d84-8027-0e6cee2b2349/image.png)

그런 다음 클러스터를 만들자.

![](https://velog.velcdn.com/images/yulmwu/post/9bb47b47-831b-43e0-b1d2-2b251e008841/image.png)

먼저 인스턴스 기반으로 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/143ee359-aac9-4a30-a0eb-80681b1d9529/image.png)

클러스터의 인스턴스 개수는 Primary + Replica 2개로 선택해주었다.

![](https://velog.velcdn.com/images/yulmwu/post/d62af146-561f-45b9-a981-61a822c937d8/image.png)

Connectivity는 첫번째를 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/285e3b95-9926-414a-ac99-28b980590a31/image.png)

그리고 인증 부분에서 비밀번호를 직접 입력하였는데, AWS Secrets Manager 등으로 관리하는 것도 좋은 방법이다.

![](https://velog.velcdn.com/images/yulmwu/post/806caded-d031-413b-81f7-931ffc482bb8/image.png)

네트워크 설정에서 서브넷 그룹은 아까 만들어뒀던걸 선택하였다.

![](https://velog.velcdn.com/images/yulmwu/post/54ede9a2-a071-4743-ae4d-771f26cb6de0/image.png)

그럼 잘 만들어진다. 자동으로 기본 인스턴스(Primary) 하나와 복제본 인스턴스(ReadOnly Replica)를 만들게 된다.

![](https://velog.velcdn.com/images/yulmwu/post/bc63f332-d16b-417c-9576-ede54ddf9091/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/1a5d7517-e527-4160-98ce-90121c4a27cc/image.png)

Bastion Host로 접속해보면 잘 되는걸 볼 수 있다. 다음으로 ElastiCache 설정을 해보자.

## (5) ElastiCache(Redis)

ElastiCache도 서브넷 그룹을 만들어야 하는데, 기존 서브넷 그룹을 그대로 쓸 수 있으니 넘어가자.

이제 Redis 클러스트를 만들어보자. (Valkey를 사용해도 좋지만, 일단은 Redis OSS로 해보겠다)

![](https://velog.velcdn.com/images/yulmwu/post/2e49f0b0-1101-4326-8b88-1408f78d4cac/image.png)

그리고 직접 구성하기 위해 클러스터 모드는 비활성화 해주었다.

![](https://velog.velcdn.com/images/yulmwu/post/abf6e5f1-649d-48ce-ae67-9e7ba6c3563a/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/d32d0997-85da-4cba-aebd-a026f258b6a1/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/e214765c-d736-4950-9a46-01ae03920093/image.png)

그리고 복제본 개수는 1개로 만든다. (Primary + Replica 1개)

![](https://velog.velcdn.com/images/yulmwu/post/772a7114-7b89-43d7-bf0a-6e7212011e43/image.png)

서브넷 그룹 설정은 기존에 만들어뒀던 그룹으로 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/9e277aed-ca95-4a08-b0a8-3a12a4fc7d60/image.png)

그리고 마지막으로 가용 영역 배치에선 Primary는 `2a`, Replica는 `2c`에 배치해뒀다. (어디에 두던 상관은 없음)

나머지 설정은 알아서 해보거나 스킵하고, 클러스터 노드가 만들어질 때 까지 기다려보자.

![](https://velog.velcdn.com/images/yulmwu/post/b8c5416d-f874-4775-bfad-a60b15689412/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/798fd7fb-408c-471a-a539-f2f7b84f0839/image.png)

Bastion Host에서도 잘 접속되는 것을 볼 수 있다. (DocumentDB, Redis 각각 보안 그룹에서 27017, 6379 포트를 열어줘야 한다)

이제 DB 설정은 마쳤다. 자격 증명을 Secrets Manager로 관리할 수 있으나, 귀찮으니 스킵하였다.

## (6) ECR

Auth API Service 이미지를 올려둘 ECR을 만들고 푸시하자.

![](https://velog.velcdn.com/images/yulmwu/post/67f4c2ef-fdcc-4656-891c-0986b7b2b763/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/0c03f22f-a660-4d3d-9d57-43cee45353a6/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/2f94875e-3a02-4c83-8c98-95538fa98c10/image.png)

참고로 맥이라면 빌드 시 `--platform linux/amd64` 옵션을 붙여줘야 한다. 애플 실리콘 맥에서 빌드하면 ARM 이미지로 빌드된다.

## (7) ALB

다음으로 ALB(ELB)를 먼저 만들어보겠다. ECS, EC2 부터 만든 후 ALB를 만들어도 되지만 여기선 ALB부터 세팅해보겠다.

![](https://velog.velcdn.com/images/yulmwu/post/94804705-9d44-4ee1-b45a-b00ca5ea8911/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/5ba854a4-85e4-41e6-8fc5-8d4d0a4aa960/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/2fa155ac-329b-44ba-996c-7ca3f5d085a0/image.png)

대상 그룹은 Board API Service 용으로 만들어둔다. 나중에 EC2 ASG 설정 시 연결만 하면 된다.

![](https://velog.velcdn.com/images/yulmwu/post/ddde78ac-c944-4562-8a37-a0dddddd4b89/image.png)

Health Check 엔드포인트도 대충 설정해준다.

![](https://velog.velcdn.com/images/yulmwu/post/13d3b279-7133-45a1-a19a-66ede1092c01/image.png)

ALB 설정은 끝났다. 다음으로 Board API Service의 AMI를 만들고 ASG를 통해 오토스케일링 해보자.

## (8) EC2(Board API Service)

### AMI

먼저 AMI를 생성할 EC2 인스턴스 하나를 만들자. 이 EC2에 대해선 VPC를 따로 설정하거나 하진 않아도 된다. SSH로 접속만 할 수 있으면 된다.

인스턴스를 만들고 접속을 했다면 NodeJS, NPM, PM2를 설치해줘야 한다. 아래의 명령어를 통해 설치하자.

```shell
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

nvm install 22

node -v
npm -v
```

![](https://velog.velcdn.com/images/yulmwu/post/4b1018ad-bdef-4799-8a9d-8bfaf31eaf45/image.png)

그리고 PM2를 설치해주자.

```shell
npm i -g pm2
```

![](https://velog.velcdn.com/images/yulmwu/post/de608107-6656-4693-bada-292fcb8f5ec8/image.png)

다음으로 소스 코드를 가져와서 빌드하고 환경 변수를 세팅한 다음 실행해보자.

![](https://velog.velcdn.com/images/yulmwu/post/02fe4e5a-0be4-41fe-a3fd-c28d244243ac/image.png)

잘 작동한다. 만약 Secrets Manager에서 에러가 난다면 EC2 IAM 설정을 해주고, Redis 커넥션에서 무한로딩이 걸린다면 TLS 설정이 되어있는지 확인해보자. 되어있다면 Redis 클라이언트에서 TLS 옵션을 켜줘야한다.

이제 PM2로 무중단 서비스를 해보겠다.

```shell
pm2 start dist/main.js --name board-api-service
pm2 save
pm2 startup systemd -u $USER --hp $HOME
# 이후 나오는 명령어 그대로 입력
```

![](https://velog.velcdn.com/images/yulmwu/post/d9d05969-9424-4699-895a-e75ddc9c4880/image.png)

됐다. 리부팅해도 잘 실행되는 모습을 볼 수 있다. 이제 AMI와 시작 템플릿을 만들고 ASG를 만들어보자.

![](https://velog.velcdn.com/images/yulmwu/post/2df0406d-a549-4783-967b-d9a69d035a08/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/8964b581-23f8-4e11-86c6-0690b82d88dc/image.png)

## Launch Template

시작 템플릿부터 만들자.

![](https://velog.velcdn.com/images/yulmwu/post/6bb24e32-76b8-4fe9-860e-66f93c6b95ca/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/58cf949b-7eb1-4f2f-8bfd-577cce573c41/image.png)

AMI 이미지는 방금 만들었던 AMI로 선택한다. 그 외(네트워크 등) 설정은 따로 건들지 않았다. 가만히 냅두면 추후 ASG에서 생성할 때 알아서 맞춰준다.

다만 Secrets Manager를 위한 IAM 하나만 선택해주었다.

![](https://velog.velcdn.com/images/yulmwu/post/7c1daadf-37ce-4ca0-8385-8df6c2fd6423/image.png)

## ASG

이제 오토스케일링 그룹을 만들자.

![](https://velog.velcdn.com/images/yulmwu/post/57983cc2-7835-4756-a8c3-6379ee392944/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/f4b57139-4216-4e90-bf05-dfd676aeede7/image.png)

프라이빗 서브넷 A, B 두개를 선택해주자.

![](https://velog.velcdn.com/images/yulmwu/post/ef448d4b-e878-45a3-a378-3c61716366da/image.png)

로드밸런서 설정도 기존에 만들어둔 대상 그룹을 선택해준다.

그 외엔 알아서 설정해주면 되고, 오토스케일링이 잘 되는지 확인해보자.

![](https://velog.velcdn.com/images/yulmwu/post/a54cb16d-fd87-4886-90a3-4583ac5ab2e7/image.png)

잘 된다면 프로비저닝된 후 ALB에 접속해보자.

![](https://velog.velcdn.com/images/yulmwu/post/296234d8-83b4-49d2-8d4a-a4442609b5ab/image.png)

잘 나온다. 다만 코드에 실수로 모든 경로에 대해 인증 여부를 체크해서 401이 반환되는 문제가 있는데, 일단 작동하긴 하니 넘어가자.. 대상 그룹에서 Health Check에서 정상 반환 코드를 401로 설정해주면 임시로 되긴한다.

![](https://velog.velcdn.com/images/yulmwu/post/e04a0332-92a9-476b-aefb-087d7f2671d6/image.png)

이제 마지막으로 Auth API Service를 ECS Fargate로 배포해보자.

## (9) ECS(Auth API Service)

ECS Fargate를 만들기 전 태스크 정의부터 만들어야한다.

![](https://velog.velcdn.com/images/yulmwu/post/72e1fa20-dcd5-46df-8bae-14246089be7b/image.png)

그리고 사진엔 없으나 Secrets Manager 권한을 포함한 IAM 설정도 해주자.

![](https://velog.velcdn.com/images/yulmwu/post/c3b570d0-02a5-4bfb-8e4b-46284d15baf7/image.png)

포트는 내부적으로 3001으로 설정해뒀으니 80번 HTTP와 컨테이너의 3001 포트를 매핑시켜줬다.

![](https://velog.velcdn.com/images/yulmwu/post/6601022f-1d2b-4673-96e5-9ab35d4a8c3f/image.png)

환경변수도 적당히 넣어줬다. 이제 ECS Fargate 클러스터를 만들어보자.

![](https://velog.velcdn.com/images/yulmwu/post/d84b0504-7323-41a0-9ee5-ed9ab7725bc9/image.png)

그리고 만든 태스크 정의를 사용하는 서비스를 만들자.

![](https://velog.velcdn.com/images/yulmwu/post/ccd5236d-c0e1-46dd-8b88-578595004be8/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/035c107f-5131-40bb-a29e-a6aa714f2f18/image.png)

네트워크 설정에서 VPC와 프라이빗 서브넷 A, B를 선택하고, 퍼블릭 IP는 꺼주자. 돈나간다.

![](https://velog.velcdn.com/images/yulmwu/post/e038631e-b7a2-4d15-8bae-ef0b03d7bc61/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/366a2188-2408-45aa-a159-c5a169284e54/image.png)

그리고 로드밸런싱 설정도 해주었다. 나머지 설정은 옵션으로 하고, 서비스를 생성해보자.

![](https://velog.velcdn.com/images/yulmwu/post/f16fce8f-d8e6-445f-9d36-ce5e8bcf763a/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/37a84ea5-3b97-4af9-ae76-7a516c494e4e/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/60854f71-d684-4ea7-873d-dfa8950a51e6/image.png)

잘 작동한다. 이로써 Auth API Service도 ECS Fargate에 배포를 완료하였다.

# (1) Testing

테스트로 글을 회원가입/로그인 후 글을 작성하고 불러와보자.

![](https://velog.velcdn.com/images/yulmwu/post/bf867e6e-8bb5-45c0-ad07-8f29823c142a/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/30b3ef0c-bd66-4df6-90f4-a398f7ca3859/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/410c3607-3ea9-4c45-b907-4cd9a7f4e78d/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/5fde108a-f3b4-4c55-b005-b2fe31b6b339/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/70406d2e-ed91-4348-8814-b40604484861/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/ab209e66-281a-4a48-ae30-843128b0dcd3/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/c24d4e15-5f44-4022-b3e4-1a11d55da56c/image.png)

잘 작동한다.

---

시간이 없어 대충한 점과 EKS를 ECS로 대체했다는 점에서 아쉬움이 남았던 포스팅이다.

언젠간 더욱 디테일하고 퀄리티있게, 그리고 EKS 까지 사용하는 포스팅으로 다시 작성해보도록 하겠디.

끝.
