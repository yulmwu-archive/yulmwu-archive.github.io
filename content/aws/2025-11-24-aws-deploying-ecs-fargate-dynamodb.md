---
title: "[AWS Computing] Deploying a web service based on ECS Fargate and DynamoDB"
description: "AWS ECR 및 ECS Fargate를 통한 웹 서비스 배포하기"
slug: "2025-11-24-aws-deploying-ecs-fargate-dynamodb"
author: yulmwu
date: 2025-11-24T10:32:58.641Z
updated_at: 2026-01-13T04:04:47.016Z
categories: ["AWS"]
tags: ["aws"]
series:
  name: AWS
  slug: aws
thumbnail: ../../thumbnails/aws/aws-deploying-ecs-fargate-dynamodb.png
linked_posts:
  previous: 2025-11-24-aws-deploying-3-tier-architecture
  next: 2025-11-24-aws-serverless
is_private: false
---

> _본 포스팅의 자료는 세명컴퓨터고등학교 보안과 전공동아리 Null4U(출제: 양OO 선배님)에 있음을 알립니다._
> 
> 과제 제출일: 2025/11/24

# 0. Overview — Problem

> 이 과제는 AWS의 **ECS Fargate** 및 **DynamoDB**를 활용한 웹 서비스 배포를 실습할 수 있는 과제입니다.
> 
> 제공되는 애플리케이션 코드를 Docker 컨테이너 이미지화하여 **ECR**에 업로드하고, 이를 **ECS Fargate**로 배포하고 **ALB** 뒤에 배포하십시오.
> 
> 각 ECS Fargate Task는 Private Subnet에 분산하여 배포합니다. 2개 이상의 Task를 유지하도록 하십시오. ALB Target Group의 타입은 IP, Health Check 경로는 `/`로 설정하십시오. 
> 
> 자세한 아키텍처 다이어그램은 아래에 첨부된 자료를 참조하십시오. 채점 기준은 아래와 같습니다.
> 
> - ALB DNS로 접속 시 웹 페이지가 정상적으로 표시되어야 합니다. 
> - 웹 페이지의 Server Status 버튼을 클릭했을 때 JSON 출력과 함께 Task IP 값이 변화됨을 확인해야 합니다. 이는 곧 ALB가 두 개 이상의 Fargate Task로 분산된다는 것을 의미합니다.
> - Check DynamoDB 버튼을 클릭했을 때 DynamoDB 테이블 목록이 보여야 합니다. Fargate Task는 Private 서브넷에서 NAT Gateway를 통해 정상적으로 DynamoDB API에 접근함을 의미합니다. (테이블 이름은 임의로 설정하십시오)

![](https://velog.velcdn.com/images/yulmwu/post/70215f85-f3a2-43af-be46-306fa37877f7/image.png)


배포해야 할 애플리케이션 소스 코드는 아래 레포지토리에서 다운받으실 수 있습니다.

https://github.com/yulmwu/blog-example-demo/tree/main/aws-ecs-dynamodb-web-service-example

# 1. VPC 

![](https://velog.velcdn.com/images/yulmwu/post/4d507a51-db4a-4542-8f21-f936273db338/image.png)

먼저 CIDR `10.0.0.0/16`의 VPC를 만들어보자. [지난 과제](https://velog.io/@yulmwu/aws-deploying-3-tier-architecture)와는 다르게 Protected Subnet이 존재하지 않기 때문에 Public Subnet 2개, Private Subnet 2개를 만들고 NAT Gateway 1개를 만들어주겠다.

![](https://velog.velcdn.com/images/yulmwu/post/fbc36c50-6db0-472a-8611-ee050330b218/image.png)

# 2. Building Docker Image, ECR Push

![](https://velog.velcdn.com/images/yulmwu/post/e0fc8959-1917-4c51-a4c5-529e98ea3dd2/image.png)

다음으로 ECR 레포지토리를 만들어보고 이미지를 빌드하여 Push 해보겠다. 필자의 환경은 MacOS이기 때문에 멀티 아키텍처 빌드를 위해 Docker Buildx를 사용 할 것이다. 먼저 ECR 레포지토리를 만들자.

![](https://velog.velcdn.com/images/yulmwu/post/e2506634-082d-4e76-b477-5e242bf4dcfd/image.png)

이미지를 빌드하고 Push 하기 전, 도커 클라이언트에서 ECR에 접근할 수 있도록 로그인을 해주자.

```shell
aws ecr get-login-password --region ap-northeast-2 | docker login --username AWS --password-stdin <Account ID>.dkr.ecr.ap-northeast-2.amazonaws.com
```

그리고 Buildx를 이미지를 빌드하고 Push 해보자.

```shell
# (처음 필요 시 Buildx Builder 생성)
docker buildx create --name multi --use
docker buildx inspect --bootstrap

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t 986129558966.dkr.ecr.ap-northeast-2.amazonaws.com/exam/repo:latest \
  --push \
  .
```

위 `builx build` 명령어에 빌드 및 태그 지정, Push 과정이 전부 포함되어 있다. 로컬에 남지 않고 바로 레포지토리로 Push 된다.

![](https://velog.velcdn.com/images/yulmwu/post/b31940a8-d8e7-4720-9823-7f9102dd6fc1/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/6189553d-9778-4300-a25f-6da860c97cf3/image.png)

이미지 빌드 및 ECR Push는 이상 마무리한다.

# 3. Application Load Balancer

![](https://velog.velcdn.com/images/yulmwu/post/ac4b8173-677d-4eba-8277-edb1336a22f8/image.png)

대상 그룹은 추후 ECS Fargate를 구성할 때 만들고, ALB를 하나 만들어두고 시작하겠다.

![](https://velog.velcdn.com/images/yulmwu/post/3a7a2775-4664-4ae6-89e1-728a81266594/image.png)

Internet Facing 및 IPv4로 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/483edf61-a682-4238-a122-3e8f585c01eb/image.png)

네트워크 매핑은 각 AZ의 Public Subnet을 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/4c242e9d-1b3f-4e0f-bbdc-6626e68d0d86/image.png)

보안 그룹은 HTTP 80번 포트를 허용하는 보안 그룹을 만들고 선택하였다.

![](https://velog.velcdn.com/images/yulmwu/post/3d16f624-1400-43d2-a14b-779cf7876786/image.png)

그리고 리스너를 추가해야 하는데, 하나 이상의 리스너를 등록하고 만들라고 한다. 우리는 추후 대상 그룹을 만들 것이기 때문에 아무 대상 그룹을 만들고 임시로 추가해둔다.

![](https://velog.velcdn.com/images/yulmwu/post/ca069d84-99b3-475c-b8ea-43b42a7f1a0c/image.png)

이렇게 해두고 나중에 수정하면 된다. 이대로 ALB를 만들자.


# 4. ECS Fargate, ALB Target Group

![](https://velog.velcdn.com/images/yulmwu/post/3f4d4591-5b50-4da6-aa0a-b0e59dadc069/image.png)

이제 ECS 클러스터 및 ECS Fargate를 구성하고 동시에 ALB 대상 그룹을 구성해보겠다.

![](https://velog.velcdn.com/images/yulmwu/post/1f411cfe-ac1a-4999-a9e3-853fa30276d2/image.png)

위와 같이 Fargate 전용 클러스터를 만들었다. 이제 서비스를 만들어서 컨테이너를 배포하기 전, 태스크 정의부터 해보자. 태스크 정의는 EKS를 비유하자면 Pod Spec과 비슷하다.

![](https://velog.velcdn.com/images/yulmwu/post/69d4c51e-1e94-4e9b-9106-bd2c3301660d/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/2e063e84-ddc8-47e6-8090-1501186a1d4f/image.png)

그리고 컨테이너에서 DynamoDB에 접근하기 위한 IAM 역할을 넣어주자. 아래의 "태스크 실행 역할"은 ECS 에이전트가 이미지를 가져오거나 로그를 CloudWatch 등으로 보내기 위해 사용하는 IAM 역할로, 다른 목적이다.

![](https://velog.velcdn.com/images/yulmwu/post/162eee30-a4bc-4236-b209-efb4bf2fd3c7/image.png)

이미지는 3000번 포트로 Expose되어 있고, TCP/HTTP 3000으로 포트를 매핑해주자. 환경 변수는 설정하지 않았다.

![](https://velog.velcdn.com/images/yulmwu/post/0079a42b-d572-4274-8961-de23ea9b0db4/image.png)

이제 서비스를 만들자.

![](https://velog.velcdn.com/images/yulmwu/post/c9d57d5f-8608-4027-945b-99bbeb0f68ed/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/e5cab649-4a18-4fb8-8484-16b246b4eb28/image.png)

환경은 Spot을 선택해도 무방하다. 잠시 켜두고 끌 Task이기 때문에 Spot은 굳이 사용하지 않았다.

![](https://velog.velcdn.com/images/yulmwu/post/6d606317-8820-4dd6-83d0-5c7593dfa350/image.png)

배포 구성은 최소 2개의 태스크로 구성하고, 오토 스케일링은 따로 구성하진 않았다.

![](https://velog.velcdn.com/images/yulmwu/post/9ced1a83-d2db-479a-9950-d9b682e8b504/image.png)

네트워킹에선 두 개의 Private Subnet을 선택해주고, Public IP는 당연히 꺼두었다. 

![](https://velog.velcdn.com/images/yulmwu/post/c8fb8a65-4593-4854-83cb-91d9752ad371/image.png)

로드밸런서는 아까 만들어둔 ALB를 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/db3086fe-ca8b-4851-88dc-b9c9338b0430/image.png)

위와 같이 대상 그룹을 만들도록 하고 HTTP 80번 리스너에 연결하도록 한다.

![](https://velog.velcdn.com/images/yulmwu/post/1a02476c-ba64-42e7-90cc-215694c38c8f/image.png)

그럼 ALB 리스너 규칙에 이런식으로 되는데, 규칙을 편집하여 임시로 만들어둔 대상 그룹을 편집하자.

![](https://velog.velcdn.com/images/yulmwu/post/afb9850a-ddf6-4677-9343-09c3fb1f35e4/image.png)

기본 규칙은 제거할 수 없으므로 새롭게 만든 대상 그룹으로 수정하면 된다.

![](https://velog.velcdn.com/images/yulmwu/post/06dff3fc-ece0-4207-8e93-720ed3bc3a82/image.png)

그럼 웹 페이지 접속이 잘 되는 모습을 볼 수 있다. 이제 DynamoDB 테이블을 하나 만들자.

# 5. DynamoDB

![](https://velog.velcdn.com/images/yulmwu/post/0b2b4837-5aba-43bf-81bd-568184ada004/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/b47b5ae3-d92c-4a72-909a-772e3420b0d5/image.png)

과제의 목적이 ECS Fargate Task가 DynamoDB API에 접근할 수 있는지를 확인하는 것이기 때문에 테이블만 만들어두면 된다.

# 6. Testing

![](https://velog.velcdn.com/images/yulmwu/post/003ce53a-ae6a-40b1-9985-c2f593ab753b/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/4b2a2420-060b-4e45-a89b-5fcef8cce358/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/6ec45672-4e67-418e-bd9b-35a8c2ce3b4e/image.png)

이상으로 이번 과제의 풀이를 마무리하겠다.