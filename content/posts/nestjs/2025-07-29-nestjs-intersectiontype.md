---
title: "[NestJS] IntersectionType: @nestjs/mapped-types vs @nestjs/swagger"
description: "NestJS DTO 상속(IntersectionType)에서 @nestjs/mapped-types vs @nestjs/swagger 라이브러리 차이"
slug: "2025-07-29-nestjs-intersectiontype"
author: yulmwu
date: 2025-07-29T04:31:52.248Z
updated_at: 2026-01-14T19:27:10.148Z
categories: ["NestJS"]
tags: ["NestJS"]
series:
    name: NestJS
    slug: nestjs
thumbnail: ../../thumbnails/nestjs/nestjs-intersectiontype.png
linked_posts:
    previous: 2025-07-29-nestjs-class-transformer-exclude-expose
    next: 2025-07-29-nestjs-s3-presigned-url
is_private: false
---

# 0. Overview

NestJS에서 DTO(Data Transfer Object)를 만들 때 부모 클래스로 부터 상속을 받고싶을 때가 있다.

예를 들어 아래와 같은 예시를 보자.

```ts
export class TopicNameDto {
	@ApiProperty({
		description: "The topic name associated with the post.",
		example: "programming",
	})
	@IsString()
	@IsNotEmpty()
	@Matches(/^[a-z]+$/, { message: "The topic name must be in lowercase letters." })
	topicName: string
}
```

위와 같은 DTO를 정의하였다. NestJS에선 파라미터, 쿼리, Body 등의 요소에 대해 DTO를 통하여 접근할 수 있기 때문에 DTO를 정의해두는 것이 좋다.

다른 DTO에서 `TopicNameDto`를 필요로 할 수 있는데, 그럴땐 상속을 하면 된다.

```ts
export class CreatePostDto extends TopicNameDto {
	@ApiProperty({
		description: "The title of the post.",
		example: "My First Post",
	})
	@IsString()
	@IsNotEmpty()
	title: string

	@ApiProperty({
		description: "The content of the post.",
		example: "This is the content of my first post.",
	})
	@IsString()
	@IsNotEmpty()
	content: string
}
```

일반적으로 상속은 클래스 식별자 뒤에 `extends` 키워드를 통해 위와 같이 사용한다.

그런데 문제가 발생하였다. 만약 `title`까지 DTO로 받는다면 어떨까? `A extends B, C`와 같은 다중 상속은 타입스크립트에선 지원하지 않는다.

그 이유야 여러가지가 있겠지만 다이아몬드 상속의 문제나 객체 지향의 복잡성, 유지보수성 등을 생각하여 다중 상속을 불가능하게 했을 것이다.

그런데 DTO 객체이기 때문에 메서드도 필요하지 않고, 때문에 다이아몬드 상속 등의 문제가 발생하지 않는다.

그럼 인터페이스를 쓰면 되지 않냐 하겠지만 인터페이스는 JS 런타임에선 존재하지 않고 `class-validator`나 `class-transformer` 등의 라이브러리 사용이 불가능하기 때문에 클래스를 쓴다.

물론 다중 상속이 아니여도 그 역할을 할 수 있는 방법이 있다.

# 1. IntersectionType

NestJS에선 이러한 상황을 위해 `IntersectionType` 함수를 제공한다.
아래와 같이 사용할 수 있다.

```ts
import { IntersectionType } from "@nestjs/mapped-types"

export class CreatePostDto extends IntersectionType(TitleDto, TopicNameDto) {
	@ApiProperty({
		description: "The content of the post.",
		example: "This is the content of my first post.",
	})
	@IsString()
	@IsNotEmpty()
	content: string
}
```

이렇게 하면 `CreatePostDto`에 `TitleDto`, `TopicNameDto`의 프로퍼티가 생성된다.

상속처럼 보이지만 상속이 아니고, `IntersectionType` 함수의 동작 과정은 아래와 같다.
(아래에서 제공하는 코드는 `IntersectionType`의 실제 구현은 아니다. 이해를 돕기 위한 예시이다.)

```ts
export interface Type<T = any> extends Function {
	new (...args: any[]): T
}

export const IntersectionType = <A, B>(classA: Type<A>, classB: Type<B>): Type<A & B> => {
	class IntersectionClass {
		constructor() {
			Object.assign(this, new classA())
			Object.assign(this, new classB())
		}
	}
	return IntersectionClass as Type<A & B>
}
```

여기서 `Type` 인터페이스는 클래스 타입을 넘기기 위한 인터페이스이다. `Type`을 통해 클래스에서 `extends` 뒤에 `IntersectionType`를 호출할 수 있게 된다.

중요한건 `IntersectionType` 함수의 구현에 있다. 함수의 내부에선 새로운 클래스를 만드는데, 그 클래스에 인자로 받은 `A` 클래스와 `B` 클래스의 프로퍼티(속성)을 복사한다.

때문에 메서드(프로토타입)은 복사되지 않고, 프로퍼티만 복사되어 DTO 클래스에서 상속처럼 사용할 수 있는 것이다.

예시의 구현이였고, 실제 구현에선 가변 인자와 데코레이터 복사, 그리고 더욱 복잡한 타입 선언 코드들이 포함되어 있다.

궁금하다면 직접 코드를 뜯어봐도 좋다.

https://github.com/nestjs/mapped-types/blob/master/lib/intersection-type.helper.ts

`IntersectionType` 말고도 DTO를 위한 `OmitType`, `PartialType`, `PickType` 등의 다양한 유틸리티 함수를 지원한다.

# 2. @nestjs/swagger vs @nestjs/mapped-types

그런데 `IntersectionType` 함수를 사용하려고 하면 아래와 같이 인텔리센스가 두가지 라이브러리의 `IntersectionType`를 보여준다.

![](https://velog.velcdn.com/images/yulmwu/post/3cab195e-2e4f-48ea-86e2-7760f4db9353/image.png)

하나는 NestJS에서 제공하는 Swagger 관련 라이브러리인 `@nestjs/swagger`, 다른 하나는 NestJS에서 제공하는 유용한 Mapped 타입들을 모아둔 `@nestjs/mapped-types` 라이브러리이다.

사용해보면 둘 모두 같은 동작을 하는 것을 볼 수 있다. 그럼 무슨 차이가 있을까?

그 답은 명확하다. 기능 자체는 같은데, `@nestjs/mapped-types`는 사용 시 Swagger 문서에 보이지 않는다. 즉 `@ApiProperty()` 등의 Swagger 데코레이터를 복사하지 않는 다는 것이다.

직접 확인해보자. 먼저 `@nestjs/mapped-types`의 `IntersectionType`를 사용했다.

![](https://velog.velcdn.com/images/yulmwu/post/fc895f16-3097-4ab7-92d4-218e176116b7/image.png)

Swagger 문서는 아래와 같이 표시된다.

![](https://velog.velcdn.com/images/yulmwu/post/adc7e419-4052-454c-92c2-4d6dd512f853/image.png)

보다시피 `TopicNameDto`의 프로퍼티인 `topicName`이 보이지 않는다. 다만 `CreatePostDto` 사용 시 `topicName`은 존재한다.

![](https://velog.velcdn.com/images/yulmwu/post/07ec5e73-ba16-4caa-9eb0-f5e0273bd622/image.png)

이유는 앞서 설명했듯이 Swagger 데코레이터(`@ApiProperty()`)는 복사하지 않기 때문이다. 그럼 이제 `@nestjs/swagger` 라이브러리의 `IntersectionType`를 사용해보자.

![](https://velog.velcdn.com/images/yulmwu/post/efc1eced-7d38-4065-b7bc-67de556c59eb/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/c8b7c17f-fa83-4961-81b6-1ab9d081b2d0/image.png)

이렇게 Swagger 문서에 잘 표시된다. 내부의 구현 코드를 봐도 다르다.

- `@nestjs/mapped-types`
  ![](https://velog.velcdn.com/images/yulmwu/post/ef7a8b13-bd88-48c8-8449-0cda10ecd145/image.png)
- `@nestjs/swagger`
  ![](https://velog.velcdn.com/images/yulmwu/post/12dd4dae-94ea-48b7-b58e-580db9bd8119/image.png)

---

# 3. TL;DR

2줄 요약:

1. DTO에서 상속하려면 `IntersectionType`을 써라. (`extends IntersectionType(A, B, ..)`)
2. Swagger 쓴다면 `@nestjs/swagger`에서 제공하는 `IntersectionType`를 써라.

끝.
