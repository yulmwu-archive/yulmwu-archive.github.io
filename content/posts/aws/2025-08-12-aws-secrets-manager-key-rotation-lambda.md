---
title: "[AWS Misc] Secrets Manager Key Rotation Lambda"
description: "AWS Lambda를 사용한 Secrets Manager 키 로테이션 "
slug: "2025-08-12-aws-secrets-manager-key-rotation-lambda"
author: yulmwu
date: 2025-08-12T13:35:35.857Z
updated_at: 2026-01-15T01:23:39.908Z
categories: ["AWS"]
tags: ["Misc", "aws"]
series:
    name: AWS
    slug: aws
thumbnail: ../../thumbnails/aws/aws-secrets-manager-key-rotation-lambda.png
linked_posts:
    previous: 2025-08-12-velog-backup-with-eventbridge
    next:
is_private: false
---

# 0. Overview

AWS에선 RDS, DocumentDB, ElastiCache 등의 데이터베이스 자격증명이나 기타 커스텀 시크릿 키를 안전하게 관리할 수 있는 Secrets Manager라는 서비스를 제공한다. 암호화 키를 관리하는 KMS 등의 서비스도 있지만 여기서 다루진 않는다.

아무튼 이걸 쓰는 이유가 크게 3가지 정도 있을 것이다.

1. IAM 기반으로 접근하여 세분화되고 안전함
2. 관리하기 간편함(교체도 간단하고 접근도 간단함)
3. 시크릿 키 로테이션(교체)을 특정 주기로 설정할 수 있음(람다 함수, EventBridge Scheduler 주기 표현식으로 가능)

이 중 3번을 다뤄보겠다. Secrets Manager를 사용하는(시크릿 키를 필요로 하는) 서비스나 코드에선 AWS SDK를 사용하여 가져오기 때문에 주기적으로 교체해도 문제가 없다. 특히 주기적으로 로테이션(교체)를 해줘야 더욱 더 안전하기 때문에 설정하는 것이 좋다.

# 1. AWS Architecture

어떤식으로 아키텍처를 구성할건지, 람다 내부적으론 어떻게 동작하는지 간단하게 알아보자.

![](https://velog.velcdn.com/images/yulmwu/post/d0d9cae7-dc85-457e-b97f-674afde5b45a/image.png)

사진과 같이 Secrets Manager에서 교체 설정을 할 때 주기(스케쥴)와 키를 교체하는 람다 함수를 선택할 수 있다.

그럼 그 주기 마다 키 교체 람다 함수를 실행하게 되는데, 람다 함수에서 받는 이벤트에서 Step은 크게 4가지로 구성된다.

1. `createSecret` : 처음으로 실행되는 스텝으로, 교체하려는 키에 대해 새로운 값을 만든다. 여기선 랜덤한 값으로 변경한다. 그리고 이때 Pending 스테이지에 새로운 값이 저장되는데, 이후 마지막 `finishSecret`에서 이전의 Current 스테이지를 삭제하고 Pending 스테이지를 Current 스테이지로 만든다.
2. `setSecret` : Secrets Manager를 사용하는 데이터베이스나 서비스에 값을 변경하는 코드가 위치한다.
3. `testSecret` : 변경한 시크릿 키가 잘 적용되고 서비스가 잘 작동하는지 테스트하는 코드가 위치한다. 필요 시 여기서 롤백하는 등의 로직을 작성할 수 도 있다.
4. `finishSecret` : 최종적으로 Pending 스테이지를 Current 스테이지로 변경한다.

백문이 불여일견, 직접 코드를 보도록 하자.

# 2. Let's write the Code

먼저 AWS SDK v3를 사용한다. 아래와 같은 라이브러리가 필요한데, 람다 함수에서 두 라이브러리 모두 기본적으로 내장되어 사용할 수 있으므로 따로 설치하여 배포할 필요는 없다. (로컬에서 테스트해보고 싶은 경우 설치해야 한다)

- `@aws-sdk/client-secrets-manager`
- `crypto`

아래와 같이 임포트해주자. (CommonJS일 경우 `require` 사용)

```js
import {
	SecretsManagerClient,
	PutSecretValueCommand,
	GetSecretValueCommand,
	DescribeSecretCommand,
	UpdateSecretVersionStageCommand,
} from "@aws-sdk/client-secrets-manager"
import crypto from "crypto"
```

그리고 Secrets Manager 클라이언트와 필요한 설정 등을 명시해두었다.

```js
const SECRET_KEYS = ["session_secret_key"]
const SECRET_LENGTH = 32

const secretsManager = new SecretsManagerClient()
```

다음으로 먼저 핸들러(`handler()`) 함수를 보자.

```js
export const handler = async (event) => {
	console.log(`Step: ${event.Step} for secret: ${event.SecretId}`)

	switch (event.Step) {
		case "createSecret":
			await createSecret(event)
			break
		case "setSecret":
			await setSecret(event)
			break
		case "testSecret":
			await testSecret(event)
			break
		case "finishSecret":
			await finishSecret(event)
			break
		default:
			throw new Error(`Unknown step: ${event.Step}`)
	}
}
```

이벤트에서 스텝에 맞는 함수를 실행하도록 해주었다.

## (1) createSecret

```js
const createSecret = async (event) => {
	const newSecretValue = {}

	SECRET_KEYS.forEach((key) => {
		newSecretValue[key] = crypto.randomBytes(SECRET_LENGTH).toString("base64").slice(0, SECRET_LENGTH)
	})

	await secretsManager.send(
		new PutSecretValueCommand({
			SecretId: event.SecretId,
			ClientRequestToken: event.ClientRequestToken,
			SecretString: JSON.stringify(newSecretValue),
			VersionStages: ["AWSPENDING"],
		}),
	)

	console.log(`Created new secret version with ${JSON.stringify(newSecretValue)}`)
}
```

위 코드와 같이 crypto 라이브러리를 사용하여 랜덤한 값을 생성하고, 키 마다 랜덤한 값을 부여하도록 하고 Pending(`AWSPENDING`) 상태로 새로운 시크릿을 만든다.

## (2) setSecret

```js
const setSecret = async (event) => {
	console.log("Set secret step - If needed, apply AWSPENDING to your app/service")
}
```

원래 여기서 DB나 다른 서비스에 시크릿 값을 설정하도록 해야 하지만, 예시이기 때문에 로직도 없는 상태이다.

## (3) testSecret

```js
const testSecret = async (event) => {
	const data = await secretsManager.send(
		new GetSecretValueCommand({
			SecretId: event.SecretId,
			VersionStage: "AWSPENDING",
		}),
	)

	try {
		const parsed = JSON.parse(data.SecretString)
		SECRET_KEYS.forEach((key) => {
			if (!parsed[key]) {
				throw new Error(`${key} missing in secret`)
			}
		})

		console.log("Test passed for pending secret.")
	} catch (err) {
		throw new Error(`Test failed: ${err.message}`)
	}
}
```

테스트에서도 적용한 서비스에 대해 잘 작동하는지 테스트를 해야하나, 지금은 만들어진 키가 유효한지 검사하는 로직만 만들어두었다.

## (4) finishSecret

```js
const finishSecret = async (event) => {
	const currentVersion = await secretsManager.send(
		new DescribeSecretCommand({
			SecretId: event.SecretId,
		}),
	)

	const currentVersionId = Object.keys(currentVersion.VersionIdsToStages).find((vId) =>
		currentVersion.VersionIdsToStages[vId].includes("AWSCURRENT"),
	)

	await secretsManager.send(
		new UpdateSecretVersionStageCommand({
			SecretId: event.SecretId,
			VersionStage: "AWSCURRENT",
			MoveToVersionId: event.ClientRequestToken,
			RemoveFromVersionId: currentVersionId,
		}),
	)

	console.log("Secret rotation finished.")
}
```

마지막으로 이전 Current 스테이지을 삭제하고 Pending 스테이지를 Current로 만들도록 한다.

코드는 여기까지로 간단한데, 아래의 Github Gist에 올려두었으니 참고하자.

https://gist.github.com/yulmwu/91babc11d363d3cd36f68252018dd8c0

# 3. Let's build the Infra

## (1) Secrets Manager

이제 AWS 인프라를 만들어보자. 어려운건 없는데 IAM 설정이 살짝 필요하긴 하다.

Secrets Manager 시크릿 만드는건 간단히 넘어가겠다.

![](https://velog.velcdn.com/images/yulmwu/post/51b57f3d-80fd-4ab7-828b-ab40cc670c9b/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/6ace9433-04b2-4a5c-a153-6d0130b3f094/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/61a6d038-25a8-4445-968d-179fcfb542b8/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/3d9238a2-49da-4fe3-97a2-2ed03f434cc4/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/0b59b281-cf88-4891-b306-2314fa0ff193/image.png)

교체 구성은 다 만들고 해보겠다.

![](https://velog.velcdn.com/images/yulmwu/post/6c69425c-b82c-4496-914f-53c468370d96/image.png)

이렇게 만들어두자. 그리고 보안 암호 값 검색을 눌러 통해 확인을 해보자.

![](https://velog.velcdn.com/images/yulmwu/post/620cc8f4-dd7e-4664-bfe1-175b964c0000/image.png)

## (2) Lambda

다음으로 로테이션 키를 설정하기 위한 람다 함수를 하나 만들어보자.

![](https://velog.velcdn.com/images/yulmwu/post/3c374dd6-656b-4cf9-909e-e3f76ca28fcc/image.png)

그리고 코드를 간단하게 올리고 배포하자.

![](https://velog.velcdn.com/images/yulmwu/post/bc565f0f-24f4-4eb4-9410-6d166f69890a/image.png)

이제 IAM 설정이 필요하다.

먼저 람다 함수가 Secrets Manager 관련 리소스를 다루기 위한 IAM 설정이 필요하다. 정책을 따로 만들어도 되고 기존의 실행 정책에 포함시켜도 된다.

![](https://velog.velcdn.com/images/yulmwu/post/a29d6d71-fc6c-4827-8bed-588c404ec551/image.png)

```yaml
{
    "Sid": "SecretsManagerRotationPermissions",
    "Effect": "Allow",
    "Action":
        [
            "secretsmanager:GetSecretValue",
            "secretsmanager:PutSecretValue",
            "secretsmanager:DescribeSecret",
            "secretsmanager:UpdateSecretVersionStage",
        ],
    "Resource": "arn:aws:secretsmanager:ap-northeast-2:986129558966:secret:TestSecret-mMbwEt",
}
```

이런식으로 Secrets Manager 관련 권한을 추가해주었다. 그리고 람다 함수에 리소스 기반 정책을 하나 더 추가해줘야 한다. (Secrets Manager가 람다 함수를 실행할 수 있도록)

![](https://velog.velcdn.com/images/yulmwu/post/22c5d3ad-105c-4969-b91e-1a76aadfdebf/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/024f848e-6329-4e97-9667-8d7add34e160/image.png)

이렇게 설정해주자. `secretsmanager.amazonaws.com`(Secrets Manager)가 이 람다 함수를 호출할 수 있도록 명시하는 것이다.

## (3) Secrets Manager Key Rotation

그리고 최종적으로 키 로테이션 설정을 해보자. 다시 Secrets Manager로 돌아가, 교체 메뉴로 가보자.

![](https://velog.velcdn.com/images/yulmwu/post/7c1bcf91-3fae-44a6-9840-0c85fafb4c54/image.png)

기본적으로 비활성화되어 있는데, 교체 편집을 눌러 활성화하고 만든 람다 함수를 넣도록 하자.

![](https://velog.velcdn.com/images/yulmwu/post/23c35d30-2ab8-4aa2-85e0-996437a0661a/image.png)

사진처럼 구성할 수 있는데, 간격은 4시간으로 설정해주었다. (`cron`, `rate` 등의 표현식으로 설정할 수 있으나 간격을 간단하게 설정해줄 수 도 있다)
(최소 주기가 4시간으로 제한됨)

![](https://velog.velcdn.com/images/yulmwu/post/5bda1056-b7cd-4bb7-b590-c8019dd74b8e/image.png)

# 4. Testing

4시간 이후 잘 되는지 확인해봐도 되지만, 보안 암호 즉시 교체를 클릭해서 바로 확인해보자.

![](https://velog.velcdn.com/images/yulmwu/post/d149422c-7044-43b2-a950-7a3c857d27e7/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/b5e8c614-f94b-403e-86d7-90eb200dc651/image.png)

람다 함수도 잘 실행되고, 값도 랜덤하게 바뀌었다.

끝.
