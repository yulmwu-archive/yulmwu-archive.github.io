---
title: '[NestJS] class-transformer @Exclude(), @Expose() Decorators and NestJS Interceptor'
description: 'NestJS Response DTO에서 특정 필드만 제외시킬 수 있을까? (Class Transformer)'
slug: '2025-07-28-nestjs-class-transformer-exclude-expose'
author: yulmwu
date: 2025-07-28T05:31:07.318Z
updated_at: 2026-01-13T04:05:06.876Z
categories: ['NestJS']
tags: ['NestJS']
series:
    name: NestJS
    slug: nestjs
thumbnail: ../../thumbnails/nestjs/nestjs-class-transformer-exclude-expose.png
linked_posts:
    previous:
    next: 2025-07-28-nestjs-intersectiontype
is_private: false
---

# 0. Overview

NestJS를 사용하여 API 서버 개발을 하고 있는데, 아래와 같은 상황이 발생했다.

> " `User` 객체(엔티티)를 클라이언트에 반환하고 싶은데, 불필요한 프로퍼티(`password`)를 어떻게 효율적으로 없앨 수 있을까? "

예시의 `User` 객체는 아래와 같다.

```ts
@Entity()
export class User {
	@PrimaryGeneratedColumn()
	id: number

	@Column({ unique: true })
	username: string

	@Column()
	password: string

	@Column()
	email: string

	@OneToMany(() => Post, (post) => post.author)
	posts: Post[]
}
```

여기서 `password`는 클라이언트에게 노출하면 안될 값이기 때문에 제외를 시켜야 한다.
물론 아래와 같이 반환할 수 도 있다.

```ts
async findByUsername(username: string) {
    const user = await this.repo.findOne({ where: { username } })
    if (!user) {
        throw new NotFoundException('User not found')
    }

    const { password: _, ...userWithoutPassword } = user
    return userWithoutPassword
}
```

하지만 하나하나 스프레드 연산자 등으로 제외를 시켜도 되겠지만, 이러한 상황이 많아질 경우 복잡해지고 빼먹을 수 있어서 비효율적인 방법이 될 수 있다.

필자의 경우 이러한 상황에 `class-transformer` 라이브러리의 `@Exclude`, `@Expose` 데코레이터와 `instanceToPlain` 함수를 이용, 그리고 NestJS 인터셉터(Interceptor)를 통해 자동으로 처리되게 하였다.

# 1. class-transformer

정말 간단하게 말하자면 Plain 객체와 클래스의 인스턴스를 쉽게 변환(직렬화, 역직렬화)해주는 라이브러리이다.

예를 들어 아래와 같은 클래스가 있다고 가정해보자.

```ts
class User {
	constructor(
		public id: number,
		public username: string,
		public email: string,
	) {}

	is_admin(): boolean {
		return this.id === 1
	}

	is_gmail(): boolean {
		return this.email.endsWith('@gmail.com')
	}
}
```

그리고 클라이언트의 요청에서 아래와 같은 JSON Plain 객체를 받아왔다고 가정하자.

```ts
const obj = {
	id: 1,
	username: 'admin',
	email: 'normal8781@gmail.com',
}
```

그리고 User 객체에 위 JSON Plain 객체를 통해 인스턴스를 만들어야한다. 기존의 방식대로라면 아래와 같은 방식을 사용한다.

```ts
const user = new User(obj.id, obj.username, obj.email)
```

이렇게만 보면 큰 문제는 없지만, 값들이 많아지고 복잡해지다보면 매우 비효율적이게 된다.

물론 DTO(Data Transfer Object)를 만들고 클래스에서도 DTO를 받는 등의 형식으로 사용해도 되나, 그렇게 하지 못하는 경우가 있거나 더욱 복잡해질 수 있는 문제가 있다.

이때 `class-transformer` 라이브러리를 사용하면 아주 쉽고 빠르게 변환할 수 있다.

```ts
import { plainToInstance } from 'class-transformer'

const user = plainToInstance(User, obj) // User { ... }
```

반대로 객체를 JSON Plain 데이터로 직렬화할 수 도 있다.

```ts
import { plainToInstance } from 'class-transformer'

const plain = instanceToPlain(user) // { ... }
```

이처럼 `class-transformer`는 Plain JSON과 Class 인스턴스 간의 변환을 해줄 수 있는데, 여기서 특별한 기능을 몇가지 지원한다.

그 중 `@Exclude()`와 `@Expose()` 데코레이터가 있는데, 아래와 같이 사용할 수 있다.

## @Exclude()

우리가 개요에서 직면했던 문제가 클라이언트에게 반환할땐 특정 프로퍼티를 제거하는 것이였는데, `class-transformer`에서 데코레이터로 그러한 기능을 제공한다.

> 데코레이터 사용 시 타입스크립트 설정(`tsconfig.json`)에서 아래 두가지 옵션을 활성화해줘야 한다.
>
> ```js
> {
>   "compilerOptions": {
>     "emitDecoratorMetadata": true,
>     "experimentalDecorators": true
>   }
> }
> ```

아래와 같이 사용할 수 있다.

```typescript
class User {
	@Exclude()
	public email: string

	constructor(
		public id: number,
		public username: string,
		email: string,
	) {
		this.email = email
	}

	is_admin(): boolean {
		return this.id === 1
	}

	is_gmail(): boolean {
		return this.email.endsWith('@gmail.com')
	}
}
```

그리고 이렇게 명시된 `@Exclude()` 데코레이터는 `class-transformer` 라이브러리의 `instanceToPlain()` 함수 호출 시 자동으로 제외되며 반환된다.

```ts
import { plainToInstance } from 'class-transformer'

const plain = instanceToPlain(user) // { id: ..., username: '...' }
```

다만 아무 옵션 없이 그냥 `@Exclude()` 데코레이터를 사용하면 아래와 같이 직렬화/역직렬화 모두 적용된다.

```ts
import { Exclude, instanceToPlain, plainToInstance } from 'class-transformer'

// class User {
//    @Exclude()
//    public email: string
//
// .. 생략

const old = new User(obj.id, obj.username, obj.email) // 기존 방식

const user_p2i = plainToInstance(User, obj)
const user_i2p = instanceToPlain(old)

console.log(old) // 기존 방식(class-transformer 사용 안함)
console.log(user_p2i) // Plain -> Instance 변환된 객체 (역직렬화)
console.log(user_i2p) // Instance -> Plain 변환된 객체 (직렬화)
```

결과 값은 다음과 같다.

```js
User { id: 1, username: 'admin', email: 'normal8781@gmail.com' }
User { id: 1, username: 'admin', email: undefined }
{ id: 1, username: 'admin' }
```

그래서 만약 직렬화(Class to Plain JSON)에서만 작동하게 하려면 `@Exclude()` 데코레이터에 아래와 같은 옵션을 줘야 한다.

```ts
@Exclude({ toPlainOnly: true })
public email: string
```

그러면 직렬화에서만 제외된다.

```js
User { id: 1, username: 'admin', email: 'normal8781@gmail.com' }
User { id: 1, username: 'admin', email: 'normal8781@gmail.com' }
{ id: 1, username: 'admin' }
```

그 반대로 역직렬화에서만 제외하고 싶다면 `toClassOnly` 옵션을 활성화한다.

```ts
@Exclude({ toClassOnly: true })
public email: string
```

```js
User { id: 1, username: 'admin', email: 'normal8781@gmail.com' }
User { id: 1, username: 'admin', email: undefined }
{ id: 1, username: 'admin', email: 'normal8781@gmail.com' }
```

## @Expose()

`@Expose()` 데코레이터도 `@Exclude` 데코레이터와 같이 특정 프로퍼티를 제외시키는 상황에서 쓰이는데, 동작하는 것이 그 반대이다.

이게 무슨 말이냐, 쉽게 말해 `@Exclude()`가 붙은 프로퍼티만 제외되었다면 `@Expose()`는 이 데코레이터가 붙지 않은 데코레이터를 제외시킨다.

아래의 코드는 위에서 `@Exclude()` 데코레이터 예제와 같은 동작을 한다.

```ts
import { Exclude, Expose } from 'class-transformer'

@Exclude()
class User {
	@Expose()
	public id: number

	@Expose()
	public username: string

	public email: string

	constructor(id: number, username: string, email: string) {
		this.id = id
		this.username = username
		this.email = email
	}

	is_admin(): boolean {
		return this.id === 1
	}

	is_gmail(): boolean {
		return this.email.endsWith('@gmail.com')
	}
}
```

다만 클래스 자체에 `@Exclude()` 데코레이터를 붙여줘야 하고, `@Expose()`의 경우 제외시킬 항목이 많은 경우 사용하면 유용하다.

다만 클래스 상속에서 두 클래스가 각각 `@Exclude()` 방식과 `@Expose()` 방식으로 다르게 사용하고 있다면 상속에서 조심해야 한다.

예를 들어 부모 클래스는 `@Exclude()` 방식을 사용하여 제외할 프로퍼티 외엔 아무런 데코레이터가 붙어있지 않은데, 자식 클래스가 `@Expose()` 방식을 사용하여 부모의 프로퍼티를 상속받았다면 데코레이터가 붙어있지 않은 프로퍼티는 자동으로 제외되기 때문이다.

아무튼 이러한 기능이 있는게 `class-transformer`이고, 그 외에 직렬화 시 이름 변경 등의 여러 기능이 있으나 따로 설명하진 않겠다. 이번 포스팅에서 다룰 내용은 `@Exclude()` 데코레이터면 충분하다.

그런데 저렇게 `@Exclude()`나 `@Expose()` 데코레이터를 써서 제외시킬 프로퍼티를 명시하고, 이걸 제외시켜 클라이언트에 보내주기 위해 `instanceToPlain()` 함수를 호출하게 된다. 즉 아래와 같이 사용한다는 의미이다.

```ts
async findByUsername(username: string) {
    const user = await this.repo.findOne({ where: { username } })
    if (!user) {
        throw new NotFoundException('User not found')
    }

    return instanceToPlain(user)
}
```

그런데 실수로 `instanceToPlain()` 함수 호출을 까먹었다고 치자, 그럼 영문도 모른채 제외되야할 데이터가 그대로 남아있는 상태로 반환된다.

그리고 매번 저렇게 호출을 하는 것은 귀찮기 때문에 이걸 자동으로 해주는 기능이 필요하다.

# 2. Interceptor

NestJS의 인터셉터(Interceptor)는 간단히 말해 요청이나 응답의 흐름에서 가로채서 데이터를 조작하는 역할을 한다.

이걸 자세히 설명하려면 NestJS의 기본적인 생명 주기의 미들웨어, 가드, 파이프, 예외 필터, 그리고 RxJS의 Observer 패턴 등에 대해 설명해야 하는데 그럼 포스트의 양이 늘어나고 주제와는 큰 관련이 없기 때문에 나중에 따로 다뤄보는걸로 하고, 코드 부터 보자.

```ts
// src/common/interceptors/transform.interceptor.ts

import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common'
import { instanceToPlain } from 'class-transformer'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

@Injectable()
export class TransformInterceptor implements NestInterceptor {
	intercept(_: ExecutionContext, next: CallHandler): Observable<any> {
		return next.handle().pipe(map((data) => instanceToPlain(data)))
	}
}
```

위와 같이 간단히 구현하였는데, `next` 핸들러를 통해 컨트롤러의 반환 값인(응답) Observable 데이터 스트림을 가져온다. 그리고 `pipe`와 `map`을 통해 데이터에 대해 `instanceToPlain` 함수를 실행한다.

그러면 자동으로 응답에 대해 `instanceToPlain()`를 호출하는 인터셉터를 만들었다. 그리고 이 인터셉터를 NestJS 앱에 등록해주면 된다.

필자의 경우 전역으로 등록해주었다.

```ts
import { TransformInterceptor } from './common/interceptors/transform.interceptor'

// 생략
const app = await NestFactory.create(AppModule)
app.useGlobalInterceptors(new TransformInterceptor())
```

그럼 된다. 끝.
