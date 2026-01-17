---
title: '[AWS Integration] Serverless GraphQL API with AWS AppSync and JavaScript Resolver'
description: 'AWS AppSync를 통한 서버리스 GraphQL API 구축하기'
slug: '2025-08-28-aws-appsync-graphql-serverless'
author: yulmwu
date: 2025-08-28T23:57:35.785Z
updated_at: 2026-01-17T11:03:54.112Z
categories: ['AWS']
tags: ['Integration', 'aws', 'serverless']
series:
    name: AWS
    slug: aws
thumbnail: ../../thumbnails/aws/aws-appsync-graphql-serverless.png
linked_posts:
    previous: 2025-08-28-aws-sqs-sns
    next: 2025-08-28-aws-click-heatmap-with-kds-msf-glue-athena
is_private: false
---

> 포스팅에서 사용된 AppSync 예제는 아래의 깃허브 링크에서 확인하실 수 있습니다.
>
> https://github.com/eocndp/aws-appsync-example

# 0. Overview

AWS엔 API 요청을 받아 람다나 다른 서비스에 라우팅하고 여러 보안과 성능 관련 기능을 제공하는 API Gateway라는 서비스가 있다.

서버리스 또는 AWS Amplify에서 구축하여 사용할 수 있는데, REST API를 기반으로 한다는 점이다.

그럼 GraphQL을 사용하는 경우 서버리스로 GraphQL 요청(쿼리)를 처리할 수 있는 서비스가 있을까?

API Gateway는 API 엔드포인트에 따라 서비스(람다 등)로 라우팅시키는 프록시에 가깝다는 점에서 결이 다르지만, AWS AppSync라는 서비스가 존재한다.

## What is AppSync?

AppSync는 서버리스 기반의 관리형 GraphQL 서비스로, GraphQL 데이터 오케스트레이션 레이어이다.

이게 무슨말이냐, 쉽게 말해 AppSync를 통해 GraphQL 스키마나 동작을 만들고, AppSync에 직접 대상 서비스(DB 등)을 연결하고 직접 Resolve 한다.

그래서 IAM을 통해 AWS 서비스에 직접 연결된다는 점에서 보안 상 주의를 할 필요가 있다. 때문에 API Gateway와는 다르게 graphql 엔드포인트 호출 시 인증을 필수로 요구한다. (우회할 순 있음)

아래의 자료를 보자.

![](https://velog.velcdn.com/images/yulmwu/post/cba529c8-d0c5-4a37-9844-7490e055a29a/image.png)

위 아키텍처는 API Gateway를 사용한 간단한 예제이다. Cognito와 연결하여 인증을 하고, API Gateway의 각 엔드포인트에 연결된 람다 함수가 있으며 그 람다 함수에서 DB에 접근하는 것이다.

때문에 직접적으로 API Gateway가 DB에 접근하지 않고 라우팅, 인증 기능만 하게 된다. (이 주제에 대해선 [필자가 작성한 이 글](https://velog.io/@yulmwu/aws-serverless)을 읽어보자.)

이제 AppSync 아키텍처를 보자.

![](https://velog.velcdn.com/images/yulmwu/post/1707c301-e112-4c5f-97c2-7c4844f245d1/image.png)

AppSync에 연결된 서비스가 API Gateway와는 다르게 Resolver가 있고, 그 뒤에 DB와 같은 서비스가 붙어있다.

이 Resolver는 AppSync의 일부로, Resolver에서 직접 DB에 쿼리를 보내 데이터를 가져오거나 조작하고, 추가적으로 람다나 HTTP 엔드포인트 등으로 데이터를 보낼 수 있는 것이다.

그래서 AppSync는 API Gateway와는 다르게 GraphQL 기반의 오케스트레이션 레이어로, 다양한 데이터 소스(DynamoDB, RDS, 람다, HTTP 엔드포인트) 등을 통합하고, 인증이나 캐싱과 같은 기능을 제공하는 서비스이다.

> ### VTL Resolver vs JavaScript Resolver
>
> 위 아키텍처에서 사용한 Resolver는 JavaScript를 사용하는 Resolver이다. 하지만 JavaScript Resolver가 나오기 전엔 VTL Resolver가 있었는데, VTL Resolver는 JSON 형태의 템플릿 언어이다.
>
> 간단하고 장점이 있지만, 선언적이라 사용할 수 있는 로직도 제한적이고 가독성과 유지보수성이 떨어진다는 3콤보 때문에 잘 사용하진 않는다. 예시의 VTL 코드는 아래와 같다. (Request)
>
> ```js
> #set($now = $util.time.nowISO8601())
> {
> 	"version": "2018-05-29",
> 	"operation": "UpdateItem",
> 	"key": { "id": $util.dynamodb.toDynamoDBJson($ctx.args.id) },
> 	"update": {
> 		"expression": "SET #n = :n, #u = :u",
> 		"expressionNames": { "#n": "name", "#u": "updatedAt" },
> 		"expressionValues": {
> 	  		":n": $util.dynamodb.toDynamoDBJson($ctx.args.newName),
> 	  		":u": $util.dynamodb.toDynamoDBJson($now)
> 		}
> 	}
> }
> ```
>
> 그래서 JavaScript Resolver가 등장하였는데, 일단 프로그래밍 언어이기 때문에 VTL의 단점을 커버할 수 있었다.
>
> ```js
> export const request = (ctx) => {
> 	const now = new Date().toISOString()
> 	return {
> 		operation: 'UpdateItem',
> 		key: {
> 			id: {
> 				S: ctx.args.id,
> 			},
> 		},
> 		update: {
> 			expression: 'SET #n = :n, #u = :u',
> 			expressionNames: {
> 				'#n': 'name',
> 				'#u': 'updatedAt',
> 			},
> 			expressionValues: {
> 				':n': {
> 					S: ctx.args.newName,
> 				},
> 				':u': {
> 					S: now,
> 				},
> 			},
> 		},
> 	}
> }
>
> export const response = (ctx) => {
> 	return ctx.result
> }
> ```
>
> 확실히 VTL보다 가독성도 좋고, 유지보수성도 좋아졌다. 또한 사용할 수 있는 로직도 훨씬 다양해졌다.
>
> 참고로 `request`는 GraphQL 쿼리를 받아 DB 등의 데이터 소스에 쿼리 등을 보내는 함수고, `response`는 데이터 소스의 결과를 받아올 때 가공할 수 있는 함수이다.
>
> (해당 포스팅에선 JavaScript Resolver를 사용한다.)

# 1. AWS Architecture

이 포스팅에서 간단하게 구축하고 테스트해볼 AWS 아키텍처는 아래와 같다. (파이프라인 등의 세부적인 기능은 사용하지 않았으며, GraphQL Subscription은 사용하지 않았다.)

![](https://velog.velcdn.com/images/yulmwu/post/48cd46ce-a3f1-4a28-97e9-9d7781b88f0b/image.png)

예제로 간단한 게시판을 만드는데, 포스트 CRUD만 구현해볼 것이다. 게시글 쓰기/수정/삭제는 Cognito 인증을 사용하고, 게시글 읽기엔 API Key를 사용하도록 할 것이다. (완전히 생략하는건 불가능함)

DB로는 DynamoDB를 사용해볼 것이고, JavaScript Resolver를 사용한다.

# 2. Let's build the Architecture

구현 순서는 크게 아래와 같다.

1. Cognito 유저 풀 생성 및 테스트 유저 생성
2. DynamoDB 테이블 생성
3. AppSync 생성, 인증 설정 및 GraphQL 스키마 작성
4. AppSync 데이터 소스 생성, Resolver 작성

## (1) Cognito

Cognito에 대해선 필자가 작성한 아래의 포스팅에서 설명한적이 있었으니 참고하면 좋을 것 같다.

https://velog.io/@yulmwu/aws-serverless#4-4-cognito

먼저 Cognito 애플리케이션을 생성해보자.

![](https://velog.velcdn.com/images/yulmwu/post/4b57f2f3-9bb2-4220-95c5-e07452a8a9d4/image.png)

회원가입 시 사용자 이름과 비밀번호, 이메일을 입력하도록 하고 로그인 시 사용자 이름과 비밀번호를 입력하도록 설정하였다.

![](https://velog.velcdn.com/images/yulmwu/post/8375d579-9588-4424-accd-e0897cbf651c/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/2b06b0e3-1f83-4672-b57e-fbeb3d5b48f4/image.png)

이렇게 Cognito 유저 풀과 애플리케이션을 생성해주었다. 로그인 페이지로 들어가서 회원가입을 해보자.

![](https://velog.velcdn.com/images/yulmwu/post/69f8092c-9000-40bf-9c58-a731b2ed0910/image.png)

이메일 제공을 필수로 해두었기 때문에 이메일 인증이 필요하다.

![](https://velog.velcdn.com/images/yulmwu/post/e0535ed0-22cd-4a75-9c8a-021ebf7c7ac4/image.png)

그러면 위 사진과 같이 사용자가 생성되었다. test 유저의 JWT 토큰을 가져와보자. (아래와 같이 인증 흐름 설정이 되어있어야 한다. `ALLOW_USER_PASSWORD_AUTH`)

![](https://velog.velcdn.com/images/yulmwu/post/88c72539-40ea-4168-a7ae-bf4ace718822/image.png)

NodeJS SDK를 사용해서 가져와보도록 하자.

```js
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider'
import { createHmac } from 'crypto'

const CLIENT_ID = '...'
const CLIENT_SECRET_KEY = '...'

const clientSecretHashGenerator = (username, clientId, clientSecretKey) => {
	const hmac = createHmac('sha256', clientSecretKey)
	hmac.update(username + clientId)

	return hmac.digest('base64')
}

const cognitoClient = new CognitoIdentityProviderClient()

const command = new InitiateAuthCommand({
	AuthFlow: 'USER_PASSWORD_AUTH',
	ClientId: CLIENT_ID,
	AuthParameters: {
		USERNAME: '...',
		PASSWORD: '...',
		SECRET_HASH: clientSecretHashGenerator('test', CLIENT_ID, CLIENT_SECRET_KEY),
	},
})

const result = await cognitoClient.send(command)

console.log(result.AuthenticationResult?.AccessToken)
```

![](https://velog.velcdn.com/images/yulmwu/post/e9562a18-ceac-4512-ab35-8026939ca994/image.png)

이제 좀 있다 GraphQL 게시글 CUD 테스트 시 `Authorization` 헤더에 포함시키면 된다.

## (2) DynamoDB

DynamoDB 설명 또한 아래의 포스트에 설명되어 있으니 참고하자.

https://velog.io/@yulmwu/aws-serverless#4-3-dynamodb

![](https://velog.velcdn.com/images/yulmwu/post/72d23fe0-7225-46dd-ac65-af80b5a62ab8/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/d45f4fb0-9749-45c7-a12d-b20bf31ec0c8/image.png)

일단 테이블만 만들어둔다. NoSQL DB이기 때문에 테이블의 컬럼을 정의하거나 할 필요는 없다.

## (3) AppSync, GraphQL Schema

먼저 AppSync 리소스를 생성해보자.

![](https://velog.velcdn.com/images/yulmwu/post/8a7203ee-060d-44a8-9242-5664051d1dca/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/9c693ce2-d60f-40bc-bd14-a57925f5bd35/image.png)

기본 템플릿을 설정할 수 있는데 무시하고 넘어가자.

![](https://velog.velcdn.com/images/yulmwu/post/27914cd3-f6d0-4e5b-9f2e-c3f508d25fc1/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/35995b55-5792-4fda-9dab-418b509f187f/image.png)

그리고 스키마를 정의하기 전, "설정"으로 가서 인증 방식을 추가해주자.

![](https://velog.velcdn.com/images/yulmwu/post/a3929206-181d-4fdf-b2de-f66365097271/image.png)

기본 권한 부여 모드는 API 키로 되어있는데, 밑에 추가 권한 부여 모드에 Cognito 방식을 추가해줘야 한다.

![](https://velog.velcdn.com/images/yulmwu/post/326a4182-69cc-401e-9fa8-6d4f1b7fd1f4/image.png)

Cognito 유저 풀을 선택해주자.

![](https://velog.velcdn.com/images/yulmwu/post/e832702c-6d61-46a4-a6af-634565d49fbd/image.png)

다음으로 스키마를 정의해줘야 한다. "스키마 편집"을 클릭해보자. 그리고 아래와 같은 스키마를 붙여 넣는다.

```graphql
type Post @aws_api_key @aws_cognito_user_pools {
	id: ID!
	title: String!
	content: String!
	author: String!
	createdAt: AWSDateTime!
}

type Mutation {
	createPost(title: String!, content: String!): Post @aws_cognito_user_pools
	updatePost(id: ID!, title: String, content: String): Post @aws_cognito_user_pools
	deletePost(id: ID!): Post @aws_cognito_user_pools
}

type Query {
	getPost(id: ID!): Post @aws_api_key
	listPosts: [Post] @aws_api_key
}
```

![](https://velog.velcdn.com/images/yulmwu/post/9987c0b8-c045-461d-9621-49afd2556136/image.png)

그리고 스키마 저장을 해주자. `@aws_api_key`나 `@aws_cognito_user_pools` 지시자는 인증에서 어느 방식을 사용할건지 명시해주는 지시자이다. CUD(뮤테이션)는 Cognito 인증 방식을 사용한다.

## (4) AppSync Data Source, Resolver

데이터 소스는 AppSync에서 GraphQL API가 데이터를 가져오거나 상호작용하기 위한 AWS 리소스이다. DynamoDB, RDS, Aurora, OpenSearch, HTTP 엔드포인트, 람다 등의 여러 서비스가 있는데, 여기선 DynamoDB를 예제로 사용한다.

![](https://velog.velcdn.com/images/yulmwu/post/929c37bb-b41b-4bc8-ad41-3ab09bd42507/image.png)

생성을 클릭한다.

![](https://velog.velcdn.com/images/yulmwu/post/ed2fc103-94fb-45da-af64-2afe75706caf/image.png)

### getPost, listPosts Queries

이제 스키마의 쿼리와 뮤테이션에 Resolver를 작성하면서 해당 데이터 소스를 연결해줘야 한다.

다시 스키마 탭으로 들어가자.

![](https://velog.velcdn.com/images/yulmwu/post/ae1ff328-787b-44d7-a69f-81ed58dd114d/image.png)

그럼 뮤테이션과 쿼리가 보이는데, 여기서 Resolver를 작성할 수 있다. getPost() 쿼리를 첫번째로 연결해보자. 연결 버튼을 클릭한다.

![](https://velog.velcdn.com/images/yulmwu/post/5b7a545a-3241-48f4-8b0a-894cab3148d8/image.png)

Resolver 유형은 단위 Resolver로 선택한다. 파이프라인은 AppSync 함수를 여러개 붙여서 순차적으로 Resolve하는 기능이다.

그리고 Resolver 런타임은 JavaScript로 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/44e929ef-3064-419c-8a06-47aa5504f639/image.png)

데이터 소스는 생성해둔 DynamoDB 테이블을 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/56951963-ecb3-46ff-82b7-75987e46e924/image.png)

그럼 Resolver 코드를 작성할 수 있는 에디터가 나온다. 아래의 코드를 붙여넣자.

```js
import { util } from '@aws-appsync/utils'

export const request = (ctx) => ({
	operation: 'GetItem',
	key: util.dynamodb.toMapValues({ id: ctx.args.id }),
})

export const response = (ctx) => ctx.result
```

![](https://velog.velcdn.com/images/yulmwu/post/634804c8-554e-4572-9efc-bd82a349e149/image.png)

다음으로 listPosts도 만들어준다. 간단하게 Scan 명령어를 보내도록 하였는데, 실사용 시 성능상 문제가 될 수 있으므로 자제하는게 좋다.

```js
export const request = () => ({ operation: 'Scan' })

export const response = (ctx) => ctx.result.items
```

![](https://velog.velcdn.com/images/yulmwu/post/e0f164b6-d2df-47fd-b4f0-a9d5098e370b/image.png)

저장을 해주고, 잘 실행되는지 확인해보자.

![](https://velog.velcdn.com/images/yulmwu/post/4b79c1c7-d219-4690-ab82-77ff740a0f0f/image.png)

Postman으로 테스트해봐도 되지만 콘솔에서 쿼리를 날려볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/1e654fdb-df7a-498f-9cc0-11e040ce1bfc/image.png)

아직 작성한 글이 없으니 아무것도 안나오는게 정상이다. 사용한 권한 부여 방식은 API 키로, 뮤테이션 테스트 시엔 Cognito 유저 풀로 변경해줘야 한다. 이제 뮤테이션 Resolver들을 추가해주자.

### createPost, updatePost, deletePost Mutations

뮤테이션 코드들은 맨 처음 Cognito 인증 여부를 검사하도록 하였다. (지시자 미지정 방지)

> 코드는 아래의 깃허브 레포지토리에 업로드해두었다.
>
> https://github.com/eocndp/aws-appsync-example

```js
// createPost Mutation

import { util } from '@aws-appsync/utils'

export const request = (ctx) => {
	const username = ctx.identity?.username
	if (!username) util.error('Unauthorized', 'Unauthorized')

	const id = util.autoId()
	const now = util.time.nowISO8601()

	return {
		operation: 'PutItem',
		key: util.dynamodb.toMapValues({ id }),
		attributeValues: util.dynamodb.toMapValues({
			title: ctx.args.title,
			content: ctx.args.content,
			author: username,
			createdAt: now,
		}),
		condition: { expression: 'attribute_not_exists(id)' },
	}
}

export const response = (ctx) => ctx.result
```

```js
// updatePost Mutation

import { util } from '@aws-appsync/utils'

export const request = (ctx) => {
	const username = ctx.identity?.username
	if (!username) util.error('Unauthorized', 'Unauthorized')

	const sets = []
	const names = {}
	const values = {}

	if (ctx.args.title !== undefined) {
		sets.push('#title = :title')
		names['#title'] = 'title'
		values[':title'] = ctx.args.title
	}
	if (ctx.args.content !== undefined) {
		sets.push('#content = :content')
		names['#content'] = 'content'
		values[':content'] = ctx.args.content
	}
	if (sets.length === 0) util.error('Nothing to update', 'BadRequest')

	return {
		operation: 'UpdateItem',
		key: util.dynamodb.toMapValues({ id: ctx.args.id }),
		update: {
			expression: `SET ${sets.join(', ')}`,
			expressionNames: names,
			expressionValues: util.dynamodb.toMapValues(values),
		},
		condition: {
			expression: '#author = :u',
			expressionNames: { '#author': 'author' },
			expressionValues: util.dynamodb.toMapValues({ ':u': username }),
		},
	}
}

export const response = (ctx) => {
	if (ctx.error) {
		const t = ctx.error.type || ''
		if (t.includes('ConditionalCheckFailedException')) {
			util.error('You are not the author of this post', 'Forbidden')
		}
		util.error(ctx.error.message, t)
	}
	return ctx.result
}
```

```js
// deletePost Mutation

import { util } from '@aws-appsync/utils'

export const request = (ctx) => {
	const username = ctx.identity?.username
	if (!username) util.error('Unauthorized', 'Unauthorized')

	return {
		operation: 'DeleteItem',
		key: util.dynamodb.toMapValues({ id: ctx.args.id }),
		condition: {
			expression: '#author = :u',
			expressionNames: { '#author': 'author' },
			expressionValues: util.dynamodb.toMapValues({ ':u': username }),
		},
	}
}

export const response = (ctx) => {
	if (ctx.error) {
		const t = ctx.error.type || ''
		if (t.includes('ConditionalCheckFailedException')) {
			util.error('You are not the author of this post', 'Forbidden')
		}
		util.error(ctx.error.message, t)
	}
	return ctx.result
}
```

이렇게 모든 쿼리와 뮤테이션에 Resolver를 연결해주었다.

![](https://velog.velcdn.com/images/yulmwu/post/b777f523-30a5-471e-b196-63826e98a39b/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/4cb9fcca-bdee-4312-966c-369eb2475766/image.png)

이제 테스트를 해보자.

# 3. Testing

뮤테이션 테스트 시 Cognito 인증이 필요한데, 콘솔에서 테스트 시 Client Secret Hash 문제로 안되는 것 같다. (2025-08-30 시점에서 버그인진 모르겠다.)

그래서 Postman에서 대신해보자. 헤더에 `Authorization: Bearer ...`을 추가해주고, 아까 생성해둔 엑세스 토큰을 넣어주자.

![](https://velog.velcdn.com/images/yulmwu/post/65f70933-67bc-4b63-8ad4-a8b2857ef781/image.png)

createPost 부터 테스트해보자.

![](https://velog.velcdn.com/images/yulmwu/post/1b5e8a42-12f5-4f1c-b661-f297b889e5f2/image.png)

실행 후 listPosts 쿼리를 보내보면 에러가 날 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/f84f1f8b-40dc-4e2f-88df-8d51e74b2ab8/image.png)

listPosts와 getPost는 API 키를 사용하도록 하였기 때문이다. 헤더에 `x-api-key`를 추가해주자. (API 키는 AppSync 설정에서 확인할 수 있다.)

![](https://velog.velcdn.com/images/yulmwu/post/3514bacf-55e4-4803-ad6f-32af037f8f19/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/c82e812a-6b7b-446a-b910-85dbd23faf4e/image.png)

getPost도 테스트해보자.

![](https://velog.velcdn.com/images/yulmwu/post/ae8a4c0a-1ef9-491b-a08c-cfd1eb4cae51/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/84dfd7e5-3d4e-4686-83b1-b3e01875fe36/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/2192a665-110e-4304-a3c9-f8befdbd5f99/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/f32255a0-85b3-41d4-97df-4be0e6231f06/image.png)

만약 다른 계정으로 업데이트하거나 삭제하려고 시도한다면 아래와 같이 에러를 반환한다.

![](https://velog.velcdn.com/images/yulmwu/post/394f45ea-4530-4596-b9c0-01c09e9137db/image.png)

이로써 잘 작동하는 것을 확인할 수 있다.

# 4. Calculate Price

마지막으로 AppSync 요금 계산을 해보자. 단 Cognito, DynamoDB 등의 요금은 생략한다. (별도로 청구됨)

또한 캐싱와 실시간 업데이트 관련 요금 계산은 내용에 포함하지 않닸다. AppSync에서 청구되는 요금은 크게 2가지이다.

- 쿼리 또는 뮤테이션 작업량(요청량)
- 아웃바운드 트래픽 전송 요금

![](https://velog.velcdn.com/images/yulmwu/post/e989d253-0b16-4065-9e00-e7b882bcb74e/image.png)

먼저 1백만 건의 쿼리 또는 뮤테이션 작업(요청)에 대해 4\$가 부과된다. 예를 들어 월간 500만 건의 쿼리와 100만건의 뮤테이션이 발생한다면 $5 × 4\$ + 1 × 4\$ = 24\$$의 쿼리/뮤테이션 요금이 발생하게 된다.

그리고 AppSync 호출 시 인터넷으로 나가는 트래픽에 대해 요금이 부과된다. (다만 CloudFront와 같은 서비스가 앞단에 붙는다면 발생 안함)

![](https://velog.velcdn.com/images/yulmwu/post/7c6ec3a6-d553-4ae4-9369-4c503408f51c/image.png)

처음 10TB/월 기준으로 GB당 0.126\$가 청구된다. (서울 리전) 예를 들어 평균 응답 크기가 10KB라면 $10KB × 6,000,000 = 60GB$이므로

- 전송량: $0.126\$ × 60 = 7.56\$$
- 총합: $24\$ + 7.56\$ = 31.56\$$

의 요금이 발생하게 된다. (다만 처음 100GB는 무료로 제공된다. AppSync에서 프리티어를 제공하나 생략하였다.)

자세한 요금은 아래의 공식 문서를 참고하길 바란다.

https://aws.amazon.com/ko/appsync/pricing

끝.
