---
title: "[NestJS] Using AWS S3 Presigned URL (POST)"
description: "NestJS에서 AWS S3 Presigned URL 사용하기 (POST 방식)"
slug: "2025-08-08-nestjs-s3-presigned-url-post"
author: yulmwu
date: 2025-08-08T11:43:35.057Z
updated_at: 2026-01-15T18:54:32.111Z
categories: ["NestJS"]
tags: ["NestJS", "aws"]
series:
  name: NestJS
  slug: nestjs
thumbnail: ../../thumbnails/nestjs/nestjs-s3-presigned-url-post.png
linked_posts:
  previous: 2025-08-08-nestjs-s3-presigned-url
  next: 
is_private: false
---

> 저번 포스팅 [[NestJS] Using AWS S3 Presigned URL](https://velog.io/@yulmwu/nestjs-s3-presigned-url)에서 이어집니다. 
> 
> 위 포스팅에서 Presigned URL 개념에 대해 다루니 참고하시길 바랍니다.

# 0. Overview

저번 포스팅에서 Presigned URL을 통해 S3에 업로드할 수 있도록 해보았다. 대충 요약하자면 Presigned URL을 사용하지 않았을 경우 아래와 같은 구조를 구현해야 했다.

![](https://velog.velcdn.com/images/yulmwu/post/642dbc3f-5652-43b3-9992-b7cfb073f90e/image.png)

그런데 이러면 서버를 거쳐 파일을 업로드하기 때문에 비효율적일 수 있다. 그래서 Presigned URL을 사용하게 되면 임시적으로 업로드 권한이 담긴 URL을 발급받고, 클라이언트는 직접 그 URL에 업로드하는 방식이다.

![](https://velog.velcdn.com/images/yulmwu/post/751e3d28-868f-4963-a460-59855a76a235/image.png)

그런데 문제가 있다. 버킷에서 직접적으로 파일의 크기 등을 체크하여 거부하거나 하는 기능은 제공하지 않는다. 더군다나 서버를 거치지 않고 직접 업로드하기 때문에 큰 문제가 될 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/3d26b589-31af-44a8-9f52-5f45cc6545dc/image.png)

출처: [AWS re:Post - S3 PUT file size limit](https://repost.aws/questions/QUlsWSYCIkSne0QW8yGEg6DQ/s3-put-file-size-limit)

요약하자면 버킷 정책에서 파일 크기 제한같은건 못하니 아래와 같은 방법을 사용하라는 말이다.

1. 람다를 연결해서 크기 체크해라.
2. 클라이언트에서 업로드하기 전에 서버에서 체크해라. (Presigned URL이라 못함)
3. 멀티파트 방식(POST 방식)을 쓰고 거기에 제한을 둬라.

두번째는 애초에 불가능하고, 먼저 첫번째 방법을 사용하면 아래와 같이 사용할 수 있을 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/f43d70c5-e024-444e-9a30-099d1784380d/image.png)

S3에 업로드하게 되면 연결된 람다(또는 Lambda@Edge)가 파일의 사이즈를 체크해보고, 제한을 넘는다 싶으면 거부하거나 파일(객체)를 삭제하는 방식이다.

그런데 이 방식은 일단 S3에 업로드하고 뭘 한다는 점과, 람다 실행 시간도 발생한다는 문제가 있다. 애초에 업로드되기 전에 자체적으로 체크하면 되는데 말이다.

그래서 3번 방식인 POST 방식의 Presigned URL을 사용하는 방법이 있다.

![](https://velog.velcdn.com/images/yulmwu/post/7a32c15e-c8a4-445a-b907-698578a06c3e/image.png)

원래 S3 Presigned URL를 통해 파일을 업로드하려면 HTTP PUT 방식을 써서 업로드를 하게 된다.

하지만 위 사진처럼 HTTP POST 방식과 멀티파트 데이터를 통해 업로드를 하게 되면 사이즈 제한이나 `Content-Type` 헤더 내용 제한과 같은 조건을 추가할 수 있게 된다. (그 조건들은 [여기에서](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-HTTPPOSTConstructPolicy.html#HTTPPOSTConstructPolicy_Conditions) 확인할 수 있다.)

# 1. Using in NestJS

먼저 HTTP PUT 방식을 사용하던 Presigned URL 코드에선 `@aws-sdk/s3-request-presigner` 라이브러리를 설치하여 사용하였으나, POST 방식에선 `@aws-sdk/s3-presigned-post` 라이브러리를 설치해서 사용해야 한다.

먼저 S3 클라이언트 선언은 똑같은데, NestJS 모듈에 아래와 같이 작성해두었다. 이전 글에서 다뤘으니 참고하도록 하자.

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

다음으로 서비스 코드를 살펴보자.

```ts
// upload.service.ts

import { Inject, Injectable } from '@nestjs/common'
import { S3Client } from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { ConfigService } from '@nestjs/config'
import { GeneratePresignedUrlRequestDto, PresignedUrlResponseDto } from './dto' // DTO 코드 생략
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

        const { url, fields } = await createPresignedPost(this.s3, {
            Bucket: this.configService.get<string>('AWS_S3_BUCKET_NAME') ?? '',
            Key: key,
            Fields: {
                'Content-Type': dto.contentType,
            },
            Conditions: [
                ['content-length-range', 0, 3 * 1024 * 1024], // Max 3MB
                ['starts-with', '$Content-Type', 'image/'],
            ],
            Expires: 600, // 10 minutes
        })

        return { url, key, fields }
    }
}
```

PUT 방식을 사용할땐 Presigned URL을 발급받을 때 S3 `PutObjectCommand`와 같은 명령어를 통해 발급할 수 있었는데, POST 방식을 사용할 경우 업로드만 할 수 있기 때문에 위와 같이 사용한다.

차이점이 있다면 Condition에서 파일의 크기 제한과 `Content-Type` 헤더의 MIME 타입을 이미지로 제한한다는 점이다.

저렇게 POST 방식에선 Presigned URL에 조건을 추가할 수 있다.

DTO나 컨트롤러 부분은 아래의 링크에서 참고하도록 하자.

https://github.com/yulmwu/0725/tree/main/backend/src/modules/upload

# 2. Testing

저번처럼 Postman을 사용하여 간단히 테스트해보겠다.

![](https://velog.velcdn.com/images/yulmwu/post/2159a213-8421-45f2-9028-02fe4b9bce0c/image.png)

아직 S3엔 아무것도 없다. API를 호출하여 Presigned URL을 발급 받아보자.

![](https://velog.velcdn.com/images/yulmwu/post/e5d12666-187f-4f71-9485-e9d89b22f863/image.png)

대충 저런 값들이 반환되는데, 그 중 `fields` 값들을 멀티파트 페이로드에 넣으면 된다. URL엔 S3 엔드포인트를 넣는다.

그리고 중요한데, `form-data`에 `file` 키와 파일 타입으로 데이터를 보낸다.

![](https://velog.velcdn.com/images/yulmwu/post/809f9638-274a-4b49-9110-c92e5ea621df/image.png)

그럼 204와 함께 아래와 같이 성공적으로 S3에 올라가진걸 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/b72f39ff-385c-46f5-84ad-61b8aa51c057/image.png)

예를 들어 파일 크기가 1MB(테스트를 위해 줄였다)를 넘는 이미지를 넣고 요청을 보내보자.

![](https://velog.velcdn.com/images/yulmwu/post/f20b8df7-5be9-4678-89ef-bc13e3b941c0/image.png)

그럼 사진과 같이 파일 크기가 제한을 넘었다고 에러를 띄우게 된다.

이처럼 Presigned URL을 PUT 방식으로 보내는 방식보단 POST 방식으로 보내면서 크기 제한까지 걸어두는걸 추천한다. 누군가의 공짜 파일 저장소나 S3 요금 폭탄을 경험하고 싶지 않다며 말이다.

끝. 
