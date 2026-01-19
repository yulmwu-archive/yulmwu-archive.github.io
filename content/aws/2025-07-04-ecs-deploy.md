---
title: '[AWS Computing] Deployment with ECR, ECS and Fargate'
description: 'AWS ECS 및 Fargate를 통한 컨테이너 컴퓨팅'
slug: '2025-07-04-ecs-deploy'
author: yulmwu
date: 2025-07-04T12:51:41.224Z
updated_at: 2026-01-19T11:15:43.310Z
categories: ['AWS']
tags: ['Computing', 'aws']
series:
    name: AWS
    slug: aws
thumbnail: ../../thumbnails/aws/ecs-deploy.png
linked_posts:
    previous:
    next: 2025-07-04-ec2-bastion-host
is_private: false
---

> 해당 게시글은 [세명컴퓨터고등학교](https://smc.sen.hs.kr/) 수업에서 진행된 프로젝트의 일부입니다.
>
> **본 글의 저작권은 [yulmwu (김준영)](https://github.com/yulmwu)에게 있습니다.** 개인적인 용도로만 사용 가능하며, 상업적 목적의 **무단 복제, 배포, 또는 변형을 금지합니다.**
>
> 이미지의 출처가 있는 경우 별도로 명시하며, 출처가 없는 경우 직접 제작한 이미지입니다.
>
> 글에 오류가 댓글로 남겨주시거나 피드백해주시면 감사드리겠습니다.

> 포스팅에서 사용한 소스코드는 깃허브에 올려두었습니다. 아래의 링크에 방문하여 확인하실 수 있습니다.
>
> https://github.com/yulmwu/smc-project-25-07
>
> 발표에 사용된 프레젠테이션(PPT)는 아래와 같습니다.
>
> https://drive.google.com/file/d/1Rql8ehSy6-u_SHsOWYmt1wcvkgkH45qk/view?usp=sharing

# 0. Overview

학교에서 여러 과목을 융합하여 뭔가를 만들어보라고 하셨는데, 전공 원툴이였던 필자는 프로젝트 개발과 배포, 유지보수를 진행하였다.

학년 단위로 우수작 선정하고 필자가 발표를 진행하였는데, 공동 2등이라는 괜찮은 성적으로 상금 10만원을 받아 필자 4만원(AWS 비용 포함), 조원 3만원 x2로 나눠가졌다.
(1등의 경우 학과도 다르고 퀄리티 있는 게임을 만들어와서 넘사벽이였다..)

> ![](https://velog.velcdn.com/images/yulmwu/post/f8661f30-a053-4640-b730-b045b3ce5ea0/image.png)
>
> 참고로 만들었던 프로젝트는 한국사 과목과 융합하라고 하여 조선인사이드라는 프로젝트를 만들었었다.
>
> 게시글/댓글 CRUD, 페이지네이션 등의 기본적인 기능들을 최대한 구현하였으나 시간이 촉박하여 더욱 세부적인 기능을 구현하지 못했다는 것이 아쉬울 따름이다.

필자는 앞서 이야기했듯 전체적인 개발과 배포에 중심을 뒀는데, 이 포스팅에선 AWS 배포와 관련하여 이야기를 해보겠다.

---

# 1. AWS Architecture

먼저 처음 구상했던 아키텍처는 아래와 같았다.

![](https://velog.velcdn.com/images/yulmwu/post/16bd8bc6-bc3d-43b2-a1f6-2fb2a0c95d7e/image.png)

참고로 이미지 CDN의 경우 최종적으로 구현하진 못하였기 때문에 흐리게 표시해두었다.

먼저 Route53으로 도메인을 연결해두고, Route53은 ELB(ALB)로, 고가용성을 위해 2개의 AZ에 ECS Fargate를 사용하여 프론트엔드(SSR)/백엔드 컨테이너를 띄웠다.

ECS Fargate는 각 AZ엔 Public 서브넷엔 NAT Gateway를 두었고, Private 서브넷엔 각 ECS Fargate 컨테이너를 띄우도록 하였다.

그리고 각 ECS Fargate는 오토스케일링를 적용시켜두었고, 마지막으로 간단하게 DynamoDB를 사용하도록 하였다.

배포의 경우 Github Actions를 사용하여 ECR에 자동으로 배포되게, 그리고 ECS 서비스를 자동으로 업데이트 시키도록 하였다.

## Problem Occurred

그렇게 구상을 하고 어느정도 시간이 지나서 보니 문제가 발생하였다.

![](https://velog.velcdn.com/images/yulmwu/post/4f9689f5-3c55-4be5-9b51-5697e9ad1e0e/image.png)

뭘 한것도 없는데 초반에 요금이 15달러로 시작하여 최종적으로 20.66달러로 꽤나 요금이 나왔다는 것이다.

그래서 원인이 뭔지 분석을 해보았는데, 그 범인을 찾았다.

![](https://velog.velcdn.com/images/yulmwu/post/b002bec0-ce4c-4a8a-91ae-6f26b9a5abe4/image.png)

위 사진과 같이 NAT Gateway로 인해 요금에서 절반 가까이 청구가 된것이다.

알고보니 테스트를 위해 아까와 같은 아키텍처의 VPC를 여러개를 만들어두고, 각 VPC엔 NAT Gateway가 2개씩 존재하여 이렇게나 요금이 청구된 듯 하였다. (물론 상금으로 땜빵하였긴 했다만..)

그래서 프로젝트의 아키텍처를 아주 간단하고 저비용으로 작동할 수 있도록 수정하였다.

![](https://velog.velcdn.com/images/yulmwu/post/e1531ab7-13ee-4c65-9805-8265e9ea4893/image.png)

처음엔 VPC 엔드포인트를 사용해볼까 생각도 해보았으나 여러므로 귀찮은 점이 많아 그냥 하나의 Public 서브넷에 ECS Fargate를 두고, 각 태스크에 Public IP를 부여하는 방식으로 사용하였다.. (오토스케일링은 그대로 적용해둠)

개인적으론 좀 많이 아쉬운 아키텍처이지만, 그래도 요금이 청구되는 것 보단 낫다고 판단하여 최종적으로 위와 같은 아키텍처로 구상하였다.

# 2. Let's build the Infra

그래서 이 포스팅에선 VPC 설정, 서브넷 설정 등은 건너뛰고 ECR + ECS Fargate, 그리고 ELB(ALB)를 사용하여 라우팅과 오토스케일링에 대한 로드밸런싱도 구축해볼 것이다.

먼저 본 아키텍처에선 아래와 같은 VPC를 만들고 그 위에서 진행하였다.

![](https://velog.velcdn.com/images/yulmwu/post/762f7979-b269-4797-b948-19b0ef2d49d3/image.png)

고가용성 따윈 버려버리고 저비용을 지향하려고 하기 때문에 저기서 사용할 AZ는 하나밖에 없으며 그마저도 `ap-northeast-2a` AZ의 Public 서브넷 하나만 사용한다.

태스크에 Public IP를 부여하여 사용할 예정이기 때문에 **NAT Gateway는 사용하지 않는다.**
만약 ECS의 태스크 수가 많아진다면 NAT Gateway가 더 유리해질 것이다.

## 2-1. ECR(Elastic Container Registry)

ECR은 Elastic Container Registry의 약자로, 이름 그대로 도커 컨테이너 이미지를 저장하는 저장소이다.

그게 전부인 서비스인데, 람다(Lambda) 등에서 ECR의 이미지를 가져올 수 도 있고, 이 포스팅의 주제 중 하나인 ECS에서 가져와 컨테이너를 띄울 수 있기 때문에 ECR에 이미지를 업로드해둬야 한다.

먼저 저장소(레포지토리)를 생성해줘야 한다.

![](https://velog.velcdn.com/images/yulmwu/post/9d33e2ef-8b3d-4c7d-8487-c97c820495d5/image.png)

그리고 레포지토리에 들어가서 한가지 설정을 더 해주도록 하자.

사이드바 메뉴에서 Lifecycle Policy에 들어가서 아래와 같은 수명 주기 정책 규칙을 생성해주자.

![](https://velog.velcdn.com/images/yulmwu/post/e25230af-36c2-4d70-8119-9470dc44725d/image.png)

예를 들어, 태그에서 버전을 따로 지정하지 않고 latest 등의 하나의 태그로 배포할 경우 새롭게 올라온 이미지만 latest 태그가 붙고 그 전에 latest 태그가 붙어있던 이미지는 언태그(untagged)된다.

언태그만 되고 삭제는 안되는데, 위 규칙이 그러한 언태그된 이미지를 삭제해줄 수 있다.

프리티어의 ECR은 최대 500MB의 용량으로 제한되며, 1GB 단위로 비용이 청구되므로 이렇게 해줘야 비용을 절약할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/a625cc28-df1e-4714-820b-81084901d05a/image.png)

참고로 규칙들이 바로 적용되진 않고 12시간 간격으로 적용되는 듯 하다.

그럼 ECR 레포지토리 생성과 세팅은 끝났으며, 이제 도커를 사용하여 ECR 레포지토리에 이미지를 push해야한다.

![](https://velog.velcdn.com/images/yulmwu/post/16d7dab3-31a4-4c2f-a5f9-8a3f32ca3ffd/image.png)

잘 모르겠다면 "푸시 명령 보기" 버튼을 눌러보면 자세히 확인할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/36c62ab8-7ede-40fd-b75e-f9fe572150f1/image.png)

먼저 테스트를 위해 로컬에서 빌드하고 배포해보자. 위와 같이 먼저 이미지를 빌드해준다.

> 참고로 맥의 경우 빌드 시 `--platform linux/amd64`로 플랫폼을 지정해줘야 한다.
>
> ECS Fargate에서 64비트 AMD 기반의 리눅스를 사용하기 때문.

![](https://velog.velcdn.com/images/yulmwu/post/38050a76-5a6b-48df-a2aa-a55f088277b7/image.png)

그리고 그 이미지에 대한 태그를 새롭게 생성해준다.

![](https://velog.velcdn.com/images/yulmwu/post/09eb400c-dba9-445a-837d-4895f2070917/image.png)

마지막으로 위와 같이 이미지를 push 해주면 ECR 레포지토리에 업로드되는 것을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/c2550b6a-2cec-450a-87f1-73967a5a19fb/image.png)

이 과정을 백엔드/프론트엔드 두개 모두 진행해주면 된다. (사진에선 실수로 인해 프론트엔드 레포지토리에 백엔드 이미지를 올려버렸다.)

## 2-2. ELB(ALB)

이제 ECS를 구축해야 하는데, 그 전에 로드밸런서를 설정해두는 것이 좀 더 간편하고 일관성있게 할 수 있다고 판단하여 먼저 로드밸런서를 만들어보겠다.

로드밸런서는 EC2에서 찾고 설정할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/dad48b67-9ef5-4961-beee-34f0a9f34d66/image.png)

로드밸런서 유형은 Application Load Balancer(ALB)를 선택해준다.

![](https://velog.velcdn.com/images/yulmwu/post/151bd8de-be39-4c6f-84d5-1d337dd0a25c/image.png)

로드밸런서 이름을 정한 후 Internet Facing, IPv4 선택 후 다음으로 넘어간다.

![](https://velog.velcdn.com/images/yulmwu/post/25f1b17a-8a0b-41b2-aca7-88d414985ad9/image.png)

VPC는 맨 처음 만들어둔 VPC를 선택해주고 2개 이상의 서브넷을 선택해준다.

![](https://velog.velcdn.com/images/yulmwu/post/82b72fdd-d875-4f00-840e-93e09efc08d1/image.png)

그리고 리스너 및 라우팅을 설정해야 하는데, 일단 대상 그룹(Target Group)은 인스턴스 타입으로 임시로 만들어주자.

이후 ECS 설정에서 로드밸런서를 설정할 때 TG를 만들것이다. 그러면 로드밸런서 설정은 끝이 났다.

## 2-3. ECS(Elastic Container Service)

ECS는 컨테이너를 실행하고 관리할 수 있는 서비스이다. 앞서 설명한 ECR의 이미지를 pull하여 자동으로 실행해주는데, 컨테이너를 사용한다는 점에서 EC2와 비교했을 때 상당히 간단하다.

쿠베네티스를 사용한 EKS 서비스도 있지만 복잡하기 때문에 ECS를 사용하도록 하였다.

ECS에선 크게 클러스터와 서비스, 그리고 태스크가 있는데 먼저 클러스터(Cluster)는 서비스와 태스크가 모여있는 집합체이다.

즉 여러 컨테이너가 모여 하나의 클러스터가 되는 것이다.

그리고 서비스는 그 클러스터 아래에서 작동하는 논리적 단위로, 각자의 태스크들을 관리하며 서비스를 만들 때 태스크 정의(Task Definition)를 선택하라고 한다. 태스크 정의는 태스크들이 어떻게 작동되는지, 어떤 이미지를 사용하는지 등을 정한다.

즉 Docker Compose 파일과 흡사하다고 생각하면 된다.

마지막으로 태스크(Task)는 하나하나의 컨테이너를 말하며, 서비스의 오토스케일링 등의 규칙에 따라 생성되고 삭제될 수 있다. (인스턴스)

![](https://velog.velcdn.com/images/yulmwu/post/6ba2f3c2-b6c0-4fe9-acd6-35d7f6ef3a31/image.png)

먼저 클러스터를 만들자.

![](https://velog.velcdn.com/images/yulmwu/post/36d2e5a7-3cba-4293-8db7-587e338a38c1/image.png)

인프라는 Fargate를 사용하는데, ECS에서는 컨테이너를 실행할 때 Fargate와 EC2 인스턴스를 사용할 수 있다. 전자는 서버리스로 컨테이너만을 띄워주는 것으로, ECS에선 주로 Fargate를 사용한다. 후자는 말 그대로 EC2에 컨테이너를 띄워준다.

![](https://velog.velcdn.com/images/yulmwu/post/5f484b5f-a0ef-4f37-af2a-f860d59e39a1/image.png)

이렇게 클러스터가 만들어지만 다음으로 서비스를 만들어야 하는데, 그 전에 태스크 정의를 통해 서비스의 태스크들이 어떻게 작동할지를 정해주자.

![](https://velog.velcdn.com/images/yulmwu/post/1dbb7b40-24ed-465b-b1ab-9a3f555ff78c/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/5703c9f0-5552-4426-9a71-70b7f3499461/image.png)

"새 태스크 정의 생성" 버튼을 클릭하여 태스크 정의를 생성하자.

![](https://velog.velcdn.com/images/yulmwu/post/6cbbfbca-84ad-4f73-9170-7e36caf6bbf8/image.png)

그리고 Fargate로 선택해주고, CPU는 0.5 vCPU, 1GB의 메모리를 선택해주었다.

![](https://velog.velcdn.com/images/yulmwu/post/b34e2538-dc8b-4603-8aed-1bd822ef6a32/image.png)

그리고 ECR에서 어떤 이미지를 가져올지 정해주고, 컨테이너의 3000번 포트를 열어주었다.

![](https://velog.velcdn.com/images/yulmwu/post/3f2116f7-0ac6-4d7d-a445-d546f2c58bcf/image.png)

이렇게 백엔드/프론트엔드 태스크 정의 2개를 만들어준다.

![](https://velog.velcdn.com/images/yulmwu/post/aaf55177-e136-449f-adbe-ce7d41175866/image.png)

그리고 서비스를 생성하는데 태스크 정의는 방금 만들었던 태스크 정의로 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/d4be9393-f6a3-4bbd-a25c-af93840cb938/image.png)

그리고 Fargate에서도 EC2와 같이 스팟 요금을 지원한다. 앞서 NAT Gateway에 데여서 돈을 많이 쓰고 싶지 않기 때문에 스팟을 선택하였다.

![](https://velog.velcdn.com/images/yulmwu/post/ffe2adae-d604-466d-8f97-12b8c5c3933b/image.png)

네트워크에서는 만들어둔 VPC를 연결하고, 퍼블릭 IP는 활성화를 해두었다.
만약 NAT Gateway나 VPC 엔드포인트를 연결해두었다면 체크할 필요가 없다. 오히려 체크해두면 이것도 돈나간다.

![](https://velog.velcdn.com/images/yulmwu/post/3031ba54-9a13-428f-a8b3-5f3a2fe6e8df/image.png)

그리고 로드밸런서는 만들어둔 로드밸런서로, 리스너는 일단 80 포트로 연결해두었다. 이건 추후 다시 설정할 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/cb2e2ce2-1d4d-4b28-a276-5426795c8464/image.png)

대상 그룹도 새롭게 만들어주고, 백엔드의 경우 엔드포인트를 `/api`로 시작하도록 하였기 때문에 경로 패턴을 `/api/*`로 와일드카드로 지정해주었다.

로드밸런서에선 대상의 상태를 확인하기 위해 Health Check라는걸 하는데, 그 확인 경로를 `/api/health`로 해두었다.

이제 서비스 설정은 끝났고, 백엔드/프론트엔드 둘 다 만들어주었다.

![](https://velog.velcdn.com/images/yulmwu/post/07791967-ba53-4e37-9eae-2aac56d18107/image.png)

그럼 이렇게 자동으로 만들어지며, 컨테이너가 실행되게 된다.

![](https://velog.velcdn.com/images/yulmwu/post/4dbb52d8-149c-4e3d-a7ef-30f3f7dac580/image.png)

이제 로드밸런서에 들어와서 리스너 세팅을 해주자. 먼저 80번 포트 설정을 해주자.

이후 ACM을 사용하여 인증서 발급을 받아 HTTPS로 통신을 할 것이기 때문에 안해줘도 되긴 한다.

![](https://velog.velcdn.com/images/yulmwu/post/138956e3-5edf-4e1d-8ba2-6b49405a9656/image.png)

이렇게 설정을 해주었고, 다음으로 HTTPS(443)도 똑같이 설정을 해주자.

![](https://velog.velcdn.com/images/yulmwu/post/fd24cfb1-0700-4cbb-bba1-5332c5e4fcee/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/aada7b12-865a-489e-9587-2098d80683a0/image.png)

HTTPS엔 인증서 선택이 가능한데, ACM에서 인증서를 발급받고 선택을 해주자.

![](https://velog.velcdn.com/images/yulmwu/post/f842e133-92dc-4893-a08c-e5cd7594afee/image.png)

그럼 로드밸런서와 ECS 설정도 끝났다.

![](https://velog.velcdn.com/images/yulmwu/post/2b47d0c1-cfec-45de-bfe2-a1b7dbe51e5c/image.png)

참고로 보안 그룹의 경우 ECS 서비스나 클러스터와 로드밸런서 등의 서비스를 분리해두는게 좋겠지만 귀찮은 관계로 VPC의 기본 보안그룹에 위와 같이 전부 설정해주었다.

## 2-4. Auto Scaling

앞서 말했 듯 ECS도 오토스케일링을 지원한다. 서비스 단위에서 오토스케일링이 되는데, EC2와 같이 크게 CPU 사용량과 메모리 사용량을 기반으로 설정할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/9e26223d-a116-409c-9ef6-7f3049a08f44/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/47e1fb6c-52f5-4c60-9c1c-5f1a615f9e4d/image.png)

먼저 최소 태스크의 개수와 최대 태스크 개수를 설정해준다.

![](https://velog.velcdn.com/images/yulmwu/post/e83d730b-603f-4112-8d43-f29bb95fdf35/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/49f69ea2-748e-444c-ac3a-041dc3dafd59/image.png)

그리고 조정 정책을 통해 어느 기준에서 늘리거나 줄일지 정한다.

## 2-5. Route53

Route53은 AWS에서 제공하는 DNS 서비스이다. 도메인을 구매할 수 도 있지만 가비아 등에서 구매한 도메인을 연결할 수 도 있다.

가비아에서 도메인을 구입해뒀으므로 도메인 등록이 아닌 호스팅 영역 생성을 선택하였다.

호스팅 영역에서 서브 도메인이나 DNS 레코드 등을 관리한다.

![](https://velog.velcdn.com/images/yulmwu/post/ddd75e2d-2991-4ed4-a37d-bb3aa2c2f0e0/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/eac5943c-1f5f-4195-b4b0-11fe318af97b/image.png)

도메인 이름엔 우리가 구매한 도메인을 입력해두었다.

![](https://velog.velcdn.com/images/yulmwu/post/33760982-3e5c-4296-9bb3-3e2c84073031/image.png)

호스팅 영역을 만들면 위 사진과 같이 레코드에 기본 2개의 아이템이 들어가있다. 여기서 NS 유형의 "값/트래픽 라우팅 대상"을 가비아에 가서 DNS 설정해줘야 한다.

![](https://velog.velcdn.com/images/yulmwu/post/0bb5ef07-e75c-4710-94df-acd5a2b537b7/image.png)

그럼 기본적인 Route53 도메인 설정은 끝이 나며, 연결된 도메인이 작동할 때 까지 최대 하루정도 걸리는 듯 하다.

![](https://velog.velcdn.com/images/yulmwu/post/1cf24ecf-a7e4-4666-bc4d-655cf46e7bde/image.png)

그리고 도메인의 레코드를 설정하여 서브 도메인을 설정하고, 그 라우팅 대상을 로드밸런서로 설정하였다.

그리고 ACM에서 HTTPS 인증서를 발급할 수 있으며, 발급 후 Route53과 연결해야 한다.

![](https://velog.velcdn.com/images/yulmwu/post/ae14228a-2655-40cf-98e9-3d4269543482/image.png)

## 2-6. Github Actions

마지막으로 Github Actions CI/CD를 사용하여 코드를 수정했을 때 자동으로 ECR에 배포하고 ECS 서비스를 업데이트하는 워크플로우를 작성하였다.

```yaml
name: Deploy Backend

on:
    push:
        paths:
            - 'backend/**'
            - '.github/workflows/backend-deploy.yaml'

jobs:
    deploy:
        runs-on: ubuntu-latest

        env:
            AWS_REGION: ap-northeast-2
            AWS_ACCOUNT_ID: ${{ secrets.AWS_ACCOUNT_ID }}
            ECR_REPO_NAME: smc-07-project-backend-repo
            ECS_CLUSTER_NAME: smc-07-project-cluster
            ECS_SERVICE_NAME: smc-07-project-backend-task-service

        steps:
            - name: Checkout code
              uses: actions/checkout@v3

            - name: Configure AWS credentials
              uses: aws-actions/configure-aws-credentials@v2
              with:
                  aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
                  aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
                  aws-region: ${{ env.AWS_REGION }}

            - name: Login to Amazon ECR
              uses: aws-actions/amazon-ecr-login@v2

            - name: Build, tag, and push image to Amazon ECR
              run: |
                  cd backend
                  docker build --platform linux/amd64 -t $ECR_REPO_NAME .
                  docker tag $ECR_REPO_NAME:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:latest
                  docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:latest

            - name: Update ECS service
              run: |
                  aws ecs update-service \
                    --cluster $ECS_CLUSTER_NAME \
                    --service $ECS_SERVICE_NAME \
                    --force-new-deployment
```

도커 빌드 후 서비스를 업데이트하는 간단한 워크플로우이며, 조건과 변수를 다르게 하여 프론트엔드 배포용 워크플로우도 작성할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/1fd0ac92-1570-4d96-8030-7a542fa12475/image.png)

---

이로써 AWS 아키텍처 배포는 끝났다. 아무래도 ECS Fargate를 사용하여 컨테이너 이미지를 띄우는 것이기 때문에 간단하지 않나 싶다.

오늘은 여기까지.
