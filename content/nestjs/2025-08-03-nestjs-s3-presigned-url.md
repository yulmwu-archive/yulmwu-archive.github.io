---
title: '[NestJS] Using AWS S3 Presigned URL'
description: 'NestJS에서 AWS S3 Presigned URL 사용하기'
slug: '2025-08-03-nestjs-s3-presigned-url'
author: yulmwu
date: 2025-08-03T05:36:07.088Z
updated_at: 2026-01-21T03:07:31.886Z
categories: ['NestJS']
tags: ['NestJS', 'aws']
series:
    name: NestJS
    slug: nestjs
thumbnail: ../../thumbnails/nestjs/nestjs-s3-presigned-url.png
linked_posts:
    previous: 2025-08-03-nestjs-intersectiontype
    next: 2025-08-03-nestjs-s3-presigned-url-post
is_private: false
---

> POST 방식의 Presigned URL은 2편에서 다룹니다.
>
> https://velog.io/@yulmwu/nestjs-s3-presigned-url-post

# 0. Overview

이미지 등의 파일을 업로드하여 AWS S3 버킷에 업로드하려고 한다. 일반적인 방법으론 아래와 같이 업로드 기능을 구현할 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/a5dfdb0c-886a-4a09-816d-9a6233b0840d/image.png)

예를 들어 `/upload` 엔드포인트로 페이로드에 파일(이미지 등)의 바이너리 데이터를 포함하여 보내면 서버는 그걸 받아서 S3에 업로드한다.

클라이언트가 직접 S3에 업로드를 한다면 좋겠지만, 보안 상 문제가 되기 때문에 그럴 순 없다. 하지만 위 방식에선 큰 바이너리 데이터가 중복으로 오고 가기 때문에 불필요한 자원 낭비가 생긴다.

# 1. Presigned URL

그래서 AWS S3에선 **Presigned URL**(미리 서명된 URL)을 지원한다. 이것을 사용한다면 아래와 같이 업로드 기능을 구현할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/8cc2e5da-cd85-450f-b3ed-8d42825165e3/image.png)

먼저 클라이언트는 서버에 Presigned URL을 요청한다. 그러면 서버는 AWS S3에 해당 객체(키)와 만료 시간 등과 함께 Presigned URL 생성을 요청한다.

그러면 AWS S3는 해당 키에 대한 Presigned URL을 발급해주는데, 이제 클라이언트는 해당 Presigned URL에 직접 HTTP PUT을 통해 파일을 업로드할 수 있다.

또한 해당 Presigned URL은 특정 키(객체=파일)에 대해서만 작업할 수 있게 해주기 때문에 보안상 문제가 되지도 않는다.

즉 Presigned URL은 특정 리소스에 대한 권한이 부여되어 있는 URL을 의미한다.

# 2. Using in NestJS

먼저 두가지의 라이브러리가 필요하다. 하나는 S3 클라이언트, 다른 하나는 Presigned URL을 발급하기 위한 라이브러리이다.

본 포스팅에선 AWS SDK v3를 한다. 아래의 명령어로 설치를 해주자. (npm)

```shell
npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

그리고 AWS 엑세스 키, 버킷 이름 등을 적어둔 환경 변수가 필요하다. `.env` 파일을 만들거나 기존의 파일에 아래의 코드를 추가하자.

```shell
AWS_ACCESS_KEY_ID=access_key_id
AWS_SECRET_ACCESS_KEY=secret_access_key
AWS_REGION=ap-northeast-2 # Seoul Region
AWS_S3_BUCKET_NAME=bucket_name
```

그리고 AWS 엑세스 키를 발급하여 채워넣고 S3 버킷을 하나 만들어서 `AWS_S3_BUCKET_NAME`에 채워 넣는다.
(S3, CloudFront 등의 AWS 아키텍처 구축 과정은 생략함)

그리고 NestJS 모듈을 하나 만드는데, 본 포스팅에선 S3 클라이언트(`S3Client`)를 DI 방식으로 사용하겠다.

```ts
// upload.module.ts

import { Module } from '@nestjs/common'
import { UploadController } from './upload.controller'
import { UploadService } from './upload.service'
import { ConfigService } from '@nestjs/config'
import { S3Client } from '@aws-sdk/client-s3'

@Module({
	controllers: [UploadController],
	providers: [
		{
			provide: 'S3_CLIENT',
			inject: [ConfigService],
			useFactory: (configService: ConfigService) => {
				return new S3Client({
					region: configService.get<string>('AWS_REGION') ?? 'ap-northeast-2',
					credentials: {
						accessKeyId: configService.get('AWS_ACCESS_KEY_ID') ?? '',
						secretAccessKey: configService.get('AWS_SECRET_ACCESS_KEY') ?? '',
					},
				})
			},
		},
		UploadService,
	],
	exports: [UploadService],
})
export class UploadModule {}
```

위와 같이 작성해두었다. 이제 서비스 등에서 아래와 같이 인젝션할 수 있다.

```ts
@Inject('S3_CLIENT')
private readonly s3: S3Client
```

다음으로 서비스 코드이다.

```ts
// upload.service.ts

import { Inject, Injectable } from '@nestjs/common'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { ConfigService } from '@nestjs/config'
import { GeneratePresignedUrlRequestDto, PresignedUrlResponseDto } from './dto'
import { v4 as uuidv4 } from 'uuid'

@Injectable()
export class UploadService {
	constructor(
		@Inject('S3_CLIENT')
		private readonly s3: S3Client,
		private readonly configService: ConfigService,
	) {}

	async generatePresignedUrl(dto: GeneratePresignedUrlRequestDto): Promise<PresignedUrlResponseDto> {
		const key = `uploads/${uuidv4()}/${dto.filename}`

		const command = new PutObjectCommand({
			Bucket: this.configService.get<string>('AWS_S3_BUCKET_NAME'),
			Key: key,
			ContentType: dto.contentType,
		})

		return {
			url: await getSignedUrl(this.s3, command, {
				expiresIn: 600, // 10 minutes
			}),
			key,
		}
	}
}
```

여기서 핵심은 `generatePresignedUrl()` 함수의 `getSignedUrl()` 호출 부분이다.

어떠한 작업에 대해 Presigned URL을 발급할지 S3 명령어를 받는다. 업로드에 대한 권한이 포함된 Presigned URL을 발급 받고 싶으므로 `PutObjectCommand` 명령어를 받도록 한다.

그리고 `expiresIn` 옵션을 통해 해당 Presigned URL의 만료 시간을 정한다. 한번 발급 받으면 만료되기 전까진 계속 유효하므로 적당히 설정하는게 좋다. 필자는 10분으로 설정하겠다.

마지막으로 컨트롤러와 DTO를 작성하면 된다.

```ts
// upload.controller.ts

import { Controller, Post, Body } from '@nestjs/common'
import { UploadService } from './upload.service'
import { GeneratePresignedUrlRequestDto, PresignedUrlResponseDto } from './dto'
import { ApiBadRequestResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

@Controller('upload')
@ApiTags('Upload')
export class UploadController {
	constructor(private readonly uploadService: UploadService) {}

	@Post('presigned-url')
	@ApiOperation({ summary: 'Generate a presigned URL for file upload' })
	@ApiResponse({ status: 201, description: 'Presigned URL generated successfully', type: PresignedUrlResponseDto })
	@ApiBadRequestResponse({ description: 'Invalid request' })
	getPresignedUrl(@Body() dto: GeneratePresignedUrlRequestDto): Promise<PresignedUrlResponseDto> {
		return this.uploadService.generatePresignedUrl(dto)
	}
}
```

```ts
// dto/request.dto.ts

import { ApiProperty } from '@nestjs/swagger'
import { IsString, IsNotEmpty } from 'class-validator'

export class GeneratePresignedUrlRequestDto {
	@ApiProperty({ description: 'The name of the file to be uploaded.', example: 'example.jpg' })
	@IsString()
	@IsNotEmpty()
	filename: string

	@ApiProperty({ description: 'The content type of the file to be uploaded. (MIME type)', example: 'image/jpeg' })
	@IsString()
	@IsNotEmpty()
	contentType: string
}
```

```ts
// dto/response.dto.ts

import { ApiProperty } from '@nestjs/swagger'
import { IsString, IsNotEmpty } from 'class-validator'

export class PresignedUrlResponseDto {
	@ApiProperty({
		description: 'The presigned URL for uploading the file.',
		example: 'https://BUCKET.s3.amazonaws.com/uploads/UUID/example.jpg?AWSAccessKeyId=...',
	})
	@IsString()
	@IsNotEmpty()
	url: string

	@ApiProperty({
		description: 'The key under which the file will be stored in S3.',
		example: 'uploads/UUID/example.jpg',
	})
	key: string
}
```

```ts
// dto/index.ts

export * from './request.dto'
export * from './response.dto'
```

필자는 업로드 시 UUID를 포함하게 하였기 때문에 응답 DTO에 해당 객체의 키를 반환하도록 하였다.

이제 테스트를 해보자.

# 3. Testing

API 테스트엔 간단하게 Postman을 사용하였다. 먼저 S3엔 아무것도 없는 모습을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/0ece3e4c-1cf5-4c26-b834-3b1e82aa26b5/image.png)

그리고 `/upload/presigned-url` 엔드포인트를 호출하여 Presigned URL을 발급받는다.

![](https://velog.velcdn.com/images/yulmwu/post/0fad3cd5-1fa5-4306-9228-9289de78b299/image.png)

그리고 응답에서 Presigned URL을 복사한 뒤 PUT 요청을 통해 이미지를 업로드해보자.

![](https://velog.velcdn.com/images/yulmwu/post/dda7d406-cc98-4dbb-a056-8627c8403b66/image.png)

Postman에선 Body에 바이너리로 체크해야 한다.

![](https://velog.velcdn.com/images/yulmwu/post/80a8d556-1956-49c6-86f1-084f92261867/image.png)

이제 S3 버킷을 확인해보면 사진과 같이 업로드가 된것을 볼 수 있다. 참고로 해당 Presigned URL은 Put Object에만 유효하기 때문에 GET 등으로 테스트해보면 안되는 것을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/efcb7f32-2721-48ea-ae53-23bc3d286b53/image.png)

끝.
