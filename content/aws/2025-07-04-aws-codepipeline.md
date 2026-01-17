---
title: "[AWS CI/CD] ECS, S3 Deployment with CodePipeline"
description: "AWS CodePipeline CI/CD를 통한 ECS, S3(정적 웹 호스팅) 배포 자동화 실습"
slug: "2025-07-04-aws-codepipeline"
author: yulmwu
date: 2025-07-04T12:53:29.547Z
updated_at: 2026-01-16T09:58:42.333Z
categories: ["AWS"]
tags: ["CI/CD", "aws"]
series:
  name: AWS
  slug: aws
thumbnail: ../../thumbnails/aws/aws-codepipeline.png
linked_posts:
  previous: 2025-07-04-aws-codedeploy-asg
  next: 2025-07-04-aws-sqs-sns
is_private: false
---

# 0. Overview

> 이 포스팅에서 사용된 아키텍처는 마이스터넷 지방기능경기대회 클라우드 부분 2024 1과제를 참고하였으며, 저작권은 마이스터넷(한국산업인력공단)에 있음을 미리 알립니다.
> 
> ![](https://velog.velcdn.com/images/yulmwu/post/cfccee72-b147-4427-949d-b0a003e93666/image.png)
> 
> 사용된 자료는 마이스터넷 "시행자료 및 공개 과제"를 참고하였습니다.
> 
> 배포 파일은 따로 제공하지 않아 직접 배포할 코드를 작성하였고, 아래의 깃허브 레포지토리에서 확인할 수 있습니다.
> 
> https://github.com/eocndp/aws-codepipeline-example-fe
> https://github.com/eocndp/aws-codepipeline-example-be

# 1. AWS Architecture

![](https://velog.velcdn.com/images/yulmwu/post/882bc9d0-d719-4925-b035-49e05915f545/image.png)

> ### ~~CodeCommit~~, CodeBuild, CodeDeploy: **CodePipeline**
> 
> AWS에서 제공하는 CI/CD 서비스들이다. 먼저 **CodeCommit**은 AWS에서 제공하는 Git 기반의 레포지토리이다. 쉽게 말해 AWS에서 제공하는 Github 레포지토리와 같은 것이다. 
> 
> 다만 2024년 7월 25일 부로 CodeCommit의 신규 고객에 대한 접근이 종료되어 사실상 서비스 지원이 중단되었다. 그래서 본 포스팅에선 CodeCommit 대신 Github 레포지토리를 통해 CodePipeline과 연동하는 방식으로 진행한다.
>
> Github에선 CI/CD로 Github Actions를 제공하는데, AWS CodeCommit도 그러한 CI/CD 서비스를 제공한다.
> 
> 그 중 **CodeBuild**는 CI(Continuous Integration, 지속적 통합) 서비스로, 코드 의존성 설치나 빌드, 테스트 등을 수행한다. 해당 포스팅에선 ECS에 배포하기 위해 ECR에 컨테이너 이미지를 올려야하므로 CodeBuild에서 이미지를 빌드한다.
> 
> CodeBuild에선 소스 코드 내의 `buildspec.yml`를 참고하여 빌드를 하게 된다. 여기서 도커 이미지를 빌드하고 ECR에 배포까지 하게 된다.
> 
> 다음으로 **CodeDeploy**는 CD(Continuous Deployment, 지속적 배포) 서비스로, CodeDeploy Agent가 설치된 EC2나 온프레미스 서버, 혹은 람다나 ECS 등에 배포한다.
> 
> CodeDeploy에 대한 설명은 이전에 다른 포스팅에서 다뤘으니 아래의 링크를 참고해보자.
> 
> https://velog.io/@yulmwu/aws-codedeploy-single-ec2
> https://velog.io/@yulmwu/aws-codedeploy-asg
> 
> 마지막으로 **CodePipeline**은 CodeCommit, CodeBuild, CodeDeploy를 하나의 프로세스로 통합시켜주는 서비스이다. 쉽게 말해 위 3개의 서비스를 모아다가 쉽게 진행될 수 있게 하는 서비스라는 것이다.

프론트엔드의 경우 정적 웹 페이지 코드를 깃허브 레포지토리에 올린다. 이후 연동된 CodePipeline이 트리거되어 자동으로 S3에 그 코드들을 업로드한다.

S3는 정적 웹 페이지 호스팅 옵션이 켜져있고, 맨 앞단의 CloudFront에 연결된다.

백엔드의 경우 마찬가지로 CodePipeline을 사용하는데, 깃허브 레포지토리에 백엔드 코드를 올리면 연동된 CodePipeline이 트리거되어 실행된다.

백엔드 배포에서 CodePipeline은 해당 소스코드를 바탕으로 도커 컨테이너 이미지를 생성(CodeBuild)하고, 그걸 ECR에 업로드한다. (CodeBuild)

그리고 CodeDeploy를 사용하여 ECR의 이미지를 ECS에 배포하게 된다. 포스팅에선 프론트엔드엔 아주 간단한 정적 웹 페이지(HTML)를 띄워볼 것이고, 백엔드엔 간단히 Express 앱을 만들고 Dockerfile을 작성해둘 것이다.

> AWS 아키텍처 구축 위주로 다룰 예정이기 때문에 코드에 집중하진 않았다. 다만 `appspec.yml`, `buildspec.yml` 등의 파일은 해당 포스팅에서 따로 다룰 예정이다.

# 2. Let's build the Infra

## Frontend

![](https://velog.velcdn.com/images/yulmwu/post/b9bebe90-c4ba-442c-b59b-720040c55447/image.png)

### (1) S3

> S3, CloudFront 파트는 세팅은 아래의 포스팅을 참고해도 좋다. 해당 포스팅에서도 CloudFront OAC를 만들어 S3에 연동하는데, 아래의 포스팅에서 설명되어 있다.
> 
> https://velog.io/@yulmwu/aws-serverless#6-7-frontend-with-s3--cloudfront

먼저 S3 버킷을 만들어보겠다.

![](https://velog.velcdn.com/images/yulmwu/post/888690ec-7812-4671-9c1c-5efda22a3800/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/e81463b4-e344-4ac6-ba77-5983c5eae256/image.png)

나중에 CloudFront OAC를 설정하여 접근하게 할 것이기 때문에 퍼블릭 엑세스는 차단한다.

![](https://velog.velcdn.com/images/yulmwu/post/f4421100-40ce-4de7-b41b-167149cde554/image.png)

그리고 버킷 속성의 맨 아래에 내려가면 정적 웹 호스팅을 설정할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/0ce7949d-d984-4e67-8ac1-bff7d4da469d/image.png)

오류 문서도 index.html로 설정하였다. 나중에 BrowserRouter(History API) 등의 정적 웹에서의 라우팅 사용 시 이렇게 해줘야 한다.

그럼 S3 세팅은 끝났다.

### (2) CloudFront

그리고 CDN을 위한 CloudFront와 OAC 설정을 해보자.

![](https://velog.velcdn.com/images/yulmwu/post/cd8a9777-133d-40f0-89bf-8413a46a3ad2/image.png)

CloudFront 배포 생성 UI가 좀 간단하게 바뀌어서 위 사진에서 Create Distribution을 클릭하여 예전 UI로 들어가자.

![](https://velog.velcdn.com/images/yulmwu/post/32afc514-0fd5-4f31-9ff7-b3940717892e/image.png)

원본 설정을 만들어둔 S3로 설정한다.

![](https://velog.velcdn.com/images/yulmwu/post/18d82732-9543-4f5a-a837-aff358183815/image.png)

그리고 바로 아래의 원본 엑세스는 원본 엑세스 제어 설정을 선택한다. 이게 OAC고, 아래가 예전에 사용하던 OAI다.

![](https://velog.velcdn.com/images/yulmwu/post/6f7e28b1-a05c-4294-a38d-542d490f4da4/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/2c8f2708-6b8f-432a-a37c-60ad710c9580/image.png)

그리고 마지막으로 기본값 루트 객체를 아래와 같이 `index.html`로 설정해주자.

![](https://velog.velcdn.com/images/yulmwu/post/28c38bd8-eee2-4ceb-aecd-a580d7c6992c/image.png)


나머지는 그대로 냅두거나 알아서 설정하고 CloudFront를 생성한다.

![](https://velog.velcdn.com/images/yulmwu/post/64daed9f-bd25-45f4-b773-284ec518c1b6/image.png)

그럼 위 사진과 같이 버킷 정책을 업데이트해야 한다고 나온다. 정책 복사 버튼을 클릭한다. 그럼 아래와 같은 정책이 복사된다.

```yml
{
  "Version": "2008-10-17",
  "Id": "PolicyForCloudFrontPrivateContent",
  "Statement": [
      {
          "Sid": "AllowCloudFrontServicePrincipal",
          "Effect": "Allow",
          "Principal": {
              "Service": "cloudfront.amazonaws.com"
          },
          "Action": "s3:GetObject",
          "Resource": "arn:aws:s3:::0801-test-bucket/*",
          "Condition": {
              "StringEquals": {
                "AWS:SourceArn": "arn:aws:cloudfront::986129558966:distribution/E3O3HHFQ0EYZSL"
              }
          }
      }
  ]
}
```

혹시 안내 메세지를 꺼버렸다면 위 정책 JSON을 복사하여 알맞게 수정하면 된다.

이제 S3 버킷의 권한 탭에 들어가 방금 복사하였던 JSON을 붙여넣자.

![](https://velog.velcdn.com/images/yulmwu/post/570b9563-84fd-4017-b80b-121bab51ff86/image.png)

예시로 `index.html`을 만들어서 버킷에 업로드해보자.

![](https://velog.velcdn.com/images/yulmwu/post/37855af3-5782-4254-8f6d-2515ea0cfab6/image.png)

만약 S3 정적 웹 호스팅에서 제공하는 URL로 들어가면 Access Denied가 뜬다. (떠야함)

그리고 CloudFront 주소로 접속해보면 잘 나오는 것을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/3df9d6fd-bce2-49b0-9cac-3a3eab61f812/image.png)

참고로 CloudFront에서도 모든 경로에 대해 `index.html`로 리다이렉트를 원한다면 아래와 같이 에러 페이지를 커스텀할 때 `/index.html`로 설정해주면 된다.

![](https://velog.velcdn.com/images/yulmwu/post/fa7ba73b-cf9b-4be6-82ea-0589e4ae520d/image.png)
![](https://velog.velcdn.com/images/yulmwu/post/3e2cbccb-fa70-4842-8c35-1d9f37b28586/image.png)

### (3) Github Repository

S3 + CloudFront를 설정을 마쳤으니 이제 자동화 배포를 위해 깃허브 레포지토리, CodePipeline 등을 설정을 해보자.

CodeCommit은 지원이 종료되었으나 CodePipeline에서 Github와 연동할 수 있으므로 더욱 편하게 작업할 수 있다.

먼저 깃허브 레포지토리 부터 만든다.

![](https://velog.velcdn.com/images/yulmwu/post/4183b09c-0a79-4fb0-b7ab-73e5e5f2f4d6/image.png)

그리고 코드를 올려보자. `git` 명령어를 쓰던 직접 업로드하던 상관은 없다.

![](https://velog.velcdn.com/images/yulmwu/post/626b219e-bfdc-480e-8a13-cc84f49caf08/image.png)

그 다음으로 CodePipeline 설정을 통해 해당 레포지토리에 커밋이 push 되었을 때 트리거되게 설정해볼 것이다.

### (4) CodePipeline(CodeDeploy)

![](https://velog.velcdn.com/images/yulmwu/post/11aea2eb-06a7-4a9c-af0e-97fb3de7d3a7/image.png)

파이프라인 생성을 클릭한다.

![](https://velog.velcdn.com/images/yulmwu/post/17b2bca0-bd56-49fa-99e2-9f9a3938c9f0/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/ebbd89f9-0fae-4bb5-9173-4f762b7d372e/image.png)

실행 모드는 대기됨으로 선택한다. 그리고 소스 스테이지에서 소스 공급자는 Github를 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/aebccca3-3e5b-4d69-a434-40f255624723/image.png)

최초로 설정한다면 깃허브 연결이 필요하다.

![](https://velog.velcdn.com/images/yulmwu/post/3c76fcdc-baa5-4fa2-aaa1-171333199a76/image.png)

앱은 옆에 앱 설치 버튼을 눌러 설치할 수 있다. 필자는 이미 있으므로 생략하였다.

![](https://velog.velcdn.com/images/yulmwu/post/0ec7ea5b-15a7-489d-a04b-ed834ed73a67/image.png)

위와 같이 설정하였다. 그리고 웹훅 설정을 통해 이벤트가 트리거 되는 조건을 걸 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/6500fcbf-bdfd-4270-8ebc-a26ede21dc46/image.png)

만약 위 조건들을 Github Actions 워크플로우로 표현하면 아래와 같을 것이다.

```yml
on:
  push:
    branches:
      - main
```

그리고 다음 버튼을 클릭한다. 그럼 빌드 스테이지와 테스트 스테이지 설정을 할 수 있는 화면이 나오는데, 둘 다 스킵한다.

정적 웹 페이지 코드만 있기 때문에 빌드할 필요가 없고, 테스트도 생략하였다. 그리고 마지막으로 배포 스테이지에서 S3를 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/7e3b06e1-cef0-4821-8405-3ebedd734d62/image.png)

그리고 아까 만들어둔 S3 버킷을 선택한다. 배포하기 전 파일 압축 풀기 옵션을 체크하고 배포 경로는 비워두자. 그럼 알아서 루트 경로에 업로드된다.

![](https://velog.velcdn.com/images/yulmwu/post/04c75b1d-a5cf-47e5-94f0-afbc5d82e8bf/image.png)

그리고 파이프라인을 생성해보면 배포가 진행되는 것을 볼 수 있다. 

![](https://velog.velcdn.com/images/yulmwu/post/7d6cfe94-98e7-4de0-ab9b-bdb4f94d826f/image.png)

빌드 스테이지와 테스트 스테이지가 없기 때문에 빠르게 완료된다.

![](https://velog.velcdn.com/images/yulmwu/post/52e6f684-487b-48c2-bce2-379fe322c257/image.png)

이렇게 잘 배포가 된다. 다음으로 코드를 수정 후 push 해보자.

![](https://velog.velcdn.com/images/yulmwu/post/96877b2c-67d2-40a7-92b1-f5f5f101db52/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/7d147626-6b6c-4a76-8921-8ffd91eae943/image.png)

그리고 CloudFront를 사용하기 때문에 캐시 무효화를 해줘야 바로 적용된 결과를 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/df12dc03-ce7b-4ad4-9458-163772f61e3f/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/5fa2ae67-893c-46dc-96a0-028d11af83c9/image.png)

물론 이것 또한 자동으로 처리할 수 있다. CodeBuild에서 AWS CLI를 통해 CloudFront 캐시 무효화를 요청할 수 있으며, 이걸 위해선 CodeBuild IAM 설정(`cloudfront:CreateInvalidation` 권한)과 아래와 같은 `buildspec.yml` 파일이 소스코드 내 필요하다.

```yml
version: 0.2
phases:
  build:
    commands:
      - echo "Invalidating CloudFront cache..."
      - |
        aws cloudfront create-invalidation \
          --distribution-id [DISTRIBUTION_ID] \
          --paths "/*"
```

이 과정은 포스팅에서 생략하였으며, 필요시 직접 해볼 수 있다.

## Backend

![](https://velog.velcdn.com/images/yulmwu/post/d3bd5d03-1fdb-446c-9892-d80152ca1540/image.png)

### (1) Github Repository

만찬가지로 깃허브 레포지토리를 생성해주었다. 

![](https://velog.velcdn.com/images/yulmwu/post/1f68d16d-e422-41f5-ad62-f92107b5ecf0/image.png)

프로젝트의 파일 구조는 아래와 같다.

```
/Dockerfile
/buildspec.yml
/index.js
/package.json
```

그리고 Dockerfile은 아래와 같이 작성해두었다. (`buildspec.yml`은 추후 설명하겠다.)

```dockerfile
FROM node:18-slim

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000
CMD ["node", "index.js"]
```

### (2) ECR

그리고 도커 컨테이너 이미지를 저장할 ECR을 만들어보자.

![](https://velog.velcdn.com/images/yulmwu/post/1c69f3f7-a994-479d-a24f-a8e23f2621a8/image.png)

참고로 필수는 아니지만 이미지 push 후 이전 이미지들을 제거해줘야 용량 절약이 된다. 그러한 기능은 수명 주기 규칙으로 설정할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/0e780e88-31eb-4cb8-ae44-31a018e41521/image.png)

그리고 도커 이미지를 올려보자. 레포지토리에서 푸시 명령 보기를 클릭하면 명령어를 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/6188d4f5-f3a1-44b4-9dc2-851d5b9d5178/image.png)

(참고로 맥의 경우 `--platform linux/amd64` 옵션을 달아줘야 한다.)

![](https://velog.velcdn.com/images/yulmwu/post/5a5ab162-f0ec-45f7-bea5-477300ce490a/image.png)

ECR 레포지토리 설정과 이미지 업로드는 끝났다.

### (3) ALB(ELB)

다음으로 ECS를 설정하기 전, 원활한 진행을 위해 ALB부터 설정해보겠다. 

![](https://velog.velcdn.com/images/yulmwu/post/3c123586-6cca-44aa-9bbd-6bf69fb13ab5/image.png)

대상 그룹 설정은 나중에 따로 설정할건데, 임시로 하나를 만들어주었다.

![](https://velog.velcdn.com/images/yulmwu/post/4447af4f-5a95-49c2-ba97-a5c39d80128a/image.png)

그럼 로드밸런서 설정은 끝났다.

### (4) ECS

그 다음으로 ECS Fargate 설정을 해보자. 먼저 클러스터 하나를 만들자.

![](https://velog.velcdn.com/images/yulmwu/post/c6e84f67-e742-48d9-83f3-bdd3ba90595e/image.png)

인프라는 Fargate로 설정하였다. 그리고 태스크 정의를 만들도록 한다.

![](https://velog.velcdn.com/images/yulmwu/post/2ea767fc-8ba8-46c6-8804-efbadc6a2d68/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/90575e60-fd2a-4a26-a47f-10a4d2acae26/image.png)

그리고 이 태스크 정의를 바탕으로 서비스를 만든다.

![](https://velog.velcdn.com/images/yulmwu/post/0d45939e-20ab-4782-9ccb-32fedc4d4f06/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/0e090fa9-43d3-45b4-81a7-6ae490659da3/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/bc04d1f9-f55f-47c9-8537-ff8bd14ea001/image.png)

그리고 여기서 대상 그룹을 만든다.

![](https://velog.velcdn.com/images/yulmwu/post/cfb628cd-2805-4b2f-a39f-7d5202972dd9/image.png)

대상 그룹을 새롭게 만들었으니 ALB의 설정을 바꿔주자.

![](https://velog.velcdn.com/images/yulmwu/post/f8742a8d-63b3-49bb-8253-477b8b5ed81d/image.png)

사실 어차피 CloudFront에서 경로 설정을 `/api/*`라고 또 해줄거라 안해줘도 되긴 하다.

![](https://velog.velcdn.com/images/yulmwu/post/54718e19-444b-4178-b42f-2feaf959478e/image.png)

혹시 따라왔는데 문제가 생겼다면 네트워크 설정은 잘 했는지(프라이빗 서브넷인데 IGW나 NAT Gateway가 없는 경우, 퍼블릭 IP 할당을 안한 경우), IAM 설정이 이상하진 않는지, Health Check 설정을 잘못한건 아닌지 등을 체크해보자.

### (5) CloudFront

그리고 CloudFront와 연결해보자. 실사용을 위해선 ALB 보안 그룹 설정에서 CloudFront IP 대역만 인바운드하거나 WAF 등의 방법으로 할 수 있겠지만 복잡하기 생략하였다.

아까 프론트엔드에서 CloudFront를 만들어둔게 있으므로 원본만 생성하고 연결해주자.

![](https://velog.velcdn.com/images/yulmwu/post/d76cc9f1-507f-4744-bf38-e5f0e9fe121a/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/4b4be789-c2b6-4ccf-9440-efa9ad43ef1a/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/a7e0c6c1-deaa-4e47-ac36-19fc6ddbf2e7/image.png)

위 사진처럼 설정하면 된다. 나머지는 알잘딱

![](https://velog.velcdn.com/images/yulmwu/post/393ba81e-5649-4f62-a9a1-923147cb4568/image.png)

그럼 이제 `/api/*` 엔드포인트를 통해 CloudFront 주소에서 ALB를 사용할 수 있다.

### (6) CodeBuild

CodeBuild를 따로 만들고 CodePipeline에서 연결해야 편하다.

![](https://velog.velcdn.com/images/yulmwu/post/31d45e57-5ddc-4f37-bbd7-6254f53daa1f/image.png)

환경은 아래와 같이 설정하였다.

![](https://velog.velcdn.com/images/yulmwu/post/6ce030fb-359c-432b-bab5-df5651c73c0d/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/46ecbd64-64bc-481b-a49c-7c68ebe87ef2/image.png)


그리고 Buildspec 파일 사용을 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/6963d22d-0251-4008-96dd-96e81d74746e/image.png)

나머지 설정은 필요 시 설정하고 프로젝트를 생성하자.

### (7) Buildspec

CodePipeline이나 CodeBuild를 사용하기 위해선 `buildspec.yml`이라는 빌드 시 사용할 설정 파일이 필요하다.

```yml
version: 0.2

phases:
  pre_build:
    commands:
      - echo Logging in to Amazon ECR
      - aws --version
      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com
      - IMAGE_TAG=latest
  build:
    commands:
      - echo Building Docker image
      - docker build -t $ECR_REPO_NAME:$IMAGE_TAG .
      - docker tag $ECR_REPO_NAME:$IMAGE_TAG $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$ECR_REPO_NAME:$IMAGE_TAG
  post_build:
    commands:
      - echo Pushing Docker image to ECR
      - docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$ECR_REPO_NAME:$IMAGE_TAG
      - echo Writing image definition file
      - printf '[{"name":"%s","imageUri":"%s"}]' $ECS_CONTAINER_NAME $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/$ECR_REPO_NAME:$IMAGE_TAG > imagedefinitions.json

artifacts:
  files:
    - imagedefinitions.json
```

필자는 위 코드처럼 작성해주었다. `pre_build`는 빌드 전 단계로, 도커 로그인을 한다. (이때 IAM 권한이 필요한데, `AmazonEC2ContainerRegistryPowerUser` 등을 사용한다.)

그 다음으로 `build`에선 도커 이미지를 빌드하고 태그를 정해준다.

빌드가 끝나면(`post_build`) 그걸 ECR에 업로드하는 코드이다.

`imagedefinitions.json`는 CodeDeploy가 ECS에 배포할 때 사용하는 컨테이너 이미지와 이름을 정의한건데, 배포 과정에서 이미지와 컨테이너를 매핑하는 역할을 하게 된다.

### (8) CodePipeline

ECS Fargate 빌드업 과정이 좀 길었다. 이제 본격적으로 CodePipeline을 통해 자동화 배포를 해보도록 하자.

마찬가지로 CodePipeline을 만들어보자.

![](https://velog.velcdn.com/images/yulmwu/post/eefb22fb-1756-4299-a876-c99035c90e22/image.png)

템플릿 중에 ECS Fargate에 배포라고 있지만, 사용자 지정 템플릿을 만들어서 사용해보겠다.

> Github Actions에서 컨테이너 이미지 생성, 그리고 ECR 배포 후 ECS 업데이트 방법도 있지만 그건 아래의 글에서 살짝 다뤘다.
> 
> https://velog.io/@yulmwu/ecs-deploy

![](https://velog.velcdn.com/images/yulmwu/post/84372cd8-0e2c-49c5-aad7-6330434d9f27/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/82ee60d3-f682-40f3-ad02-f11bbb68779d/image.png)

소스 스테이지는 아까와 같이 깃허브 레포지토리로 설정한다.

![](https://velog.velcdn.com/images/yulmwu/post/ede217e8-c6cf-4850-af21-19c579130c0f/image.png)

빌드 스테이지는 만들었던 만들었던 CodeBuild 프로젝트를 선택한다. 

테스트 스테이지는 건너뛴다.

![](https://velog.velcdn.com/images/yulmwu/post/e7afe4b9-439f-42fb-abcf-83f531ad6cd0/image.png)

마지막으로 배포 설정은 위와 같이 설정해주었다. 이렇게 파이프라인을 생성하면 최초로 배포가 진행된다.

![](https://velog.velcdn.com/images/yulmwu/post/83424aee-4697-47e0-adf4-eae895e5867f/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/62433be8-e7ba-4cea-b353-30accff57b32/image.png)

그리고 코드 업데이트 후 push하여 잘 되는지 확인해보자.

![](https://velog.velcdn.com/images/yulmwu/post/c31d5fa5-47b6-46a7-b499-f3425aaacf6d/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/79d26697-e930-402b-9424-50c4658564b4/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/aa305b7a-dec6-4daf-878b-d71740a87224/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/06446b79-d430-4a23-bade-ab42b7ef7f09/image.png)

잘 된는 듯 하다. 이 포스팅에선 아주 간단하게 설정만 해보았고, 추후 Blue/Green 배포 방식을 사용하거나 더욱 더 디테일하게 설정하여 실제 서비스에서 사용하면 될 듯 하다.

물론 간단하게 한다면 그냥 Github Actions에서 도커 이미지를 만들고 ECR에 업로드한 후, ECS에 롤링 업데이트 명령어를 통해 업데이트하는 방법도 괜찮긴 하다.

다만 CodePipeline(또는 CodeDeploy)에서는 롤백 등의 부가적인 기능을 제공하기 때문에 더욱 효율적으로 사용할 수 있다. 

CodeBuild 과정에선 컴퓨팅 사용에 대한 요금이 나가니 참고하길 바란다.

끝.

---

> CodePipeline은 써본적이 많이 없어 오류가 있거나 잘못된 부분이 있을 수 있습니다.
> 
> 이러한 문제가 있다면 댓글로 피드백 해주시면 감사드리겠습니다.