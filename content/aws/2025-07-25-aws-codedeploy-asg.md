---
title: "[AWS CI/CD] EC2 Deployment with CodeDeploy + Github Actions #2 (with Auto Scaling)"
description: "AWS CodeDeploy + Github Actions를 통한 EC2 배포 실습 (EC2 Auto Scaling)"
slug: "2025-07-25-aws-codedeploy-asg"
author: yulmwu
date: 2025-07-25T02:30:31.679Z
updated_at: 2026-01-02T02:36:31.454Z
categories: ["AWS"]
tags: ["CI/CD", "aws"]
series:
    name: AWS
    slug: aws
thumbnail: ../../thumbnails/aws/aws-codedeploy-asg.png
linked_posts:
    previous: 2025-07-25-aws-codedeploy-single-ec2
    next: 2025-07-25-aws-codepipeline
is_private: false
---

> 본 블로그의 [[AWS] EC2 Deployment with CodeDeploy + Github Actions (Single EC2 Instance)](https://velog.io/@yulmwu/aws-codedeploy-single-ec2) 글과 연계되며, 단일 EC2 인스턴스에 CodeDeploy를 적용하는 것을 응용하여 오토 스케일링이 적용된 아키텍처에 CodeDeploy를 적용하는 포스팅입니다.
>
> 개념 설명은 위 글에서 다루며, 본 포스팅에선 아키텍처를 구축하는 과정만 제공합니다.

# 0. Overview

작은 서버라면 단일 EC2 인스턴스에서 돌려도 괜찮겠지만 실제 서비스에선 오토스케일링이 핵심이다.

그러한 오토스케일링이 적용된 아키텍처에서도 당연히 CodeDeploy를 적용할 수 있는데, 저번에 단일 EC2 인스턴스엔 In Place 방식으로 간단히 진행해봤다면 이번엔 Blue/Green 배포 방식을 사용해볼 것이다.

초반 구축 과정과 AppSpec, 스크립트 등은 비슷하나 Blue/Green 방식이기 때문에 살짝의 차이는 있다.

소스 코드의 경우 전 포스팅과 구분하여 아래의 깃허브 레포지토리에 올려두었다.

https://github.com/eocndp/aws-codedeploy-example-asg

# 1. Architecture

![](https://velog.velcdn.com/images/yulmwu/post/fd9d24e5-449b-46d4-9fbc-5da98c6a7c96/image.png)

아키텍처는 위와 같다. CodeDeploy에 대한 큰 차이는 없고, 오토스케일링과 로드밸런싱이 적용됐다는 차이, 그리고 조금 더 응용되어 VPC 구성이 살짝 더 복잡해졌다는 점이다.

프라이빗 서브넷에 EC2를 올려두기 때문에 인터넷 엑세스를 위해선 NAT Gateway나 VPC 엔드포인트가 필요하다.

필자는 NAT Gateway를 사용할 것이고, 각 퍼블릭 서브넷에 NAT Gateway를 올려둬도 되지만 NAT Gateway 요금이 살짝 빡세기 때문에 하나만 만들고 라우팅 테이블을 고쳐 사용할 것이다.

그리고 앞서 설명했듯 배포 방식은 Blue/Green으로 사용하며, 이를 위해선 CodeDeploy 설정을 하기 전 로드밸런싱(ALB) 설정이 꼭 필요하다.

# 2. Let's build the Infra

전 포스팅과 마찬가지로 서비스의 이름은 `exam` 접두사로 통일한다.

## VPC

VPC를 만들고 아키텍처의 CIDR을 바탕으로 서브넷을 만든다. 참고로 프리티어에서 주로 사용하는 EC2 인스턴스 타입인 `t2.micro`는 `ap-northeast-2a`와 `ap-northeast-2c` AZ만 지원한다. 떄문에 `a`, `c` AZ를 선택해주었다.

![](https://velog.velcdn.com/images/yulmwu/post/4feda640-dbca-447d-a3eb-29de2b496278/image.png)

잘 만들어졌다.

## IAM

EC2와 CodeDeploy에 붙일 IAM을 먼저 만들어주는게 편한데, 전 포스팅에서 만들어둔 IAM이 있으므로 생략한다.

[[AWS] EC2 Deployment with CodeDeploy + Github Actions (Single EC2 Instance) - IAM](https://velog.io/@yulmwu/aws-codedeploy-single-ec2#iam)

## EC2 AMI

다음으로 오토스케일링 그룹의 시작 템플릿에 적용할 AMI 이미지를 만들어보자. 먼저 EC2 하나를 생성한다. 원활한 진행을 위해 퍼블릭 서브넷에 배치하고 퍼블릭 IP 할당을 하자. 꼭 만들어둔 VPC에 생성하지 않아도 된다.

SSH로 접속한 다음 아래의 명령어를 통해 CodeDeploy와 NodeJS, NPM 등을 설치한다. (원활히 진행하기 위해 루트로 실행하는 것을 추천한다.)

```shell
sudo apt-get update
sudo apt-get install -y ruby wget nodejs npm

cd /home/ubuntu
wget https://aws-codedeploy-ap-northeast-2.s3.ap-northeast-2.amazonaws.com/latest/install
chmod +x ./install
sudo ./install auto

npm install -g pm2
```

설치가 되었다면 아래의 명령어로 잘 설치되었는지 확인해보자.

```shell
sudo service codedeploy-agent status
node -v
npm -v
pm2 -v
```

![](https://velog.velcdn.com/images/yulmwu/post/58a0e874-b0e7-4cde-b25d-6f12cb917a17/image.png)

다음으로 이 EC2의 AMI를 만들자.

![](https://velog.velcdn.com/images/yulmwu/post/a086b227-3bce-4497-b18b-225afe2f6030/image.png)

## EC2 Bastion Host (Option)

AMI를 생성하는 동안 추후 로그 확인이나 디버깅 등을 위해 Bastion Host를 하나 만들어두자. 물론 필수는 아니다.

Bastion Host에 대해선 블로그에서 다룬 글이 있으니 참고하길 바란다.

![](https://velog.velcdn.com/images/yulmwu/post/ab30af34-e26c-494b-aa98-c938d2898f1b/image.png)

만들어둔 VPC의 퍼블릭 서브넷에 만들고 퍼블릭 IP를 할당한다.

그리고 SSH로 접속한 뒤 AMI를 만들때 생성하였던 키페어 파일을 옮겨놓도록 하자.

![](https://velog.velcdn.com/images/yulmwu/post/d8d86e62-930a-4708-823b-3885dcfc8770/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/76a53353-e24b-405f-9d94-6648caf8ccf4/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/48e889a3-c2a2-475e-b357-cb3ea6bb3b24/image.png)

## Launch Template

그리고 오토스케일링 그룹에 사용할 시작 템플릿을 만들어보자.

![](https://velog.velcdn.com/images/yulmwu/post/a8ebee93-a468-400e-bef6-9e66307a837e/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/4430dbf7-c70f-4436-9741-f97c27327806/image.png)

별다른 설정은 하지 않는다. 아래 고급 세부 정보에서 IAM 설정은 붙여주도록 하자.

![](https://velog.velcdn.com/images/yulmwu/post/7370dc28-8e00-41c4-a41f-7cf075fb3c9c/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/c9105107-bd12-4d88-be8f-1a2d3bfcb394/image.png)

## Auto Scaling Group

다음으로 오토스케일링 그룹을 설정해보자.

![](https://velog.velcdn.com/images/yulmwu/post/d5a3895b-5f2b-4365-8f70-d6f8e588a0bd/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/4a79879e-afc6-4a44-9690-1e86ce685e7a/image.png)

그리고 로드밸런싱은 아직 만들지 않았으니 선택하진 않는다.

![](https://velog.velcdn.com/images/yulmwu/post/d8703e48-c742-4e87-81f7-08c4a0adc009/image.png)

나머지는 그대로 냅두거나 적절하게 선택하고, ASG를 만들자.

![](https://velog.velcdn.com/images/yulmwu/post/3d9c2a62-5421-4d1c-9c37-e70defecc584/image.png)

만들면 새로운 인스턴스가 생성될 것이다.

## ALB(ELB)

다음으로 ALB 설정을 해보자. CodeDeploy에서 In Place 방식을 선택했다면 나중에 만들어도 되나 Blue/Green 방식을 선택하였기 때문에 미리 만들어둬야 한다.

먼저 대상 그룹을 하나 만들어주자.

![](https://velog.velcdn.com/images/yulmwu/post/4ad0834c-9da0-41ec-8ebc-820d7af586b1/image.png)

그리고 ASG에 대상 그룹을 붙인다.

![](https://velog.velcdn.com/images/yulmwu/post/2232ca52-596a-4162-92e5-325b9d0fae8f/image.png)

다음으로 ALB를 만들자.

![](https://velog.velcdn.com/images/yulmwu/post/3b741b58-2673-46db-8b64-22c552802d93/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/ec08fb8e-da32-4634-aa3b-f79bf561dfc7/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/a2f40453-37ca-45af-9d2d-26feb9e1956f/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/04d3adb8-9767-4983-af17-0855d94f90a2/image.png)

이제 로드밸런서까지 만들어졌으나 Health Check에서 실패할 것이다. 당연히 아직 코드를 올리진 않았기 때문.

![](https://velog.velcdn.com/images/yulmwu/post/725ffe5d-5a84-4af4-8127-0ada60abea6d/image.png)

## CodeDeploy

이제 CodeDeploy 세팅을 해보자.

![](https://velog.velcdn.com/images/yulmwu/post/e3b1888b-fc46-462f-b26a-f454ff77de03/image.png)

애플리케이션을 만드는데 전 포스팅과 마찬가지로 EC2/온프레미스를 선택한다.

다음으로 배포 그룹을 만들고 IAM은 전에 만들어둔 IAM으로 연결해주자.

![](https://velog.velcdn.com/images/yulmwu/post/00bc08a3-d28d-46f1-9291-1a15e714f677/image.png)

그리고 배포 방식은 Blue/Green 방식을 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/37322f2f-425e-4632-8b59-8973e99476d1/image.png)

그리고 오토스케일링 그룹을 선택한다. 이러면 업데이트 시 오토스케일링 단위로 Blue, Green으로 나뉘고 업데이트되며 업데이트 후엔 자동으로 Green 쪽으로 트래픽이 전환된다.

![](https://velog.velcdn.com/images/yulmwu/post/8ea28f70-8b1b-4ec8-9e1f-56ed6ce06a6d/image.png)

로드밸런서의 대상 그룹도 선택해준다.

## AppSpec and Scripts

이 목차는 이전 포스팅의 내용과 똑같으므로 아래의 링크로 대체한다.

[[AWS] EC2 Deployment with CodeDeploy + Github Actions (Single EC2 Instance) - IAM](https://velog.io/@yulmwu/aws-codedeploy-single-ec2#github-actions)

하지만 약간 다른 점이 있다면 CodeDeploy Lifecycle 중 `ApplicationStop`은 Blue/Green 방식에선 필요하지 않고, 오히려 추후 롤백 시 문제가 생길 수 있으므로 빼는 것이 좋다.

애초에 Blue/Green 방식에선 설정한 시간이 지나면 인스턴스가 종료되기 때문에 빼도 된다.

## Github Actions

이 목차도 이전 포스팅의 내용과 똑같으므로 아래의 링크로 대체한다.

[[AWS] EC2 Deployment with CodeDeploy + Github Actions (Single EC2 Instance) - IAM](https://velog.io/@yulmwu/aws-codedeploy-single-ec2#github-actions)

## Deployment

이제 깃허브에 Push하게 된다면 아래와 같이 Actions가 작동하면서 배포가 진행될 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/92774e27-3bf8-49de-8f12-537020070a35/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/64d04942-6fd3-45ff-be0e-fd712edbd6ce/image.png)

CodeDeploy에서 그 과정을 확인할 수 있으며, 아래와 같이 인스턴스와 오토스케일링 그룹이 새롭게 만들어지는 것을 볼 수 있다. (In Place에선 볼 수 없음)

![](https://velog.velcdn.com/images/yulmwu/post/c6636e61-5498-4899-9e2b-c782edd5bfd9/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/c651d368-a0cc-4a17-9de1-2c6c7bc0cbde/image.png)

또한 CodeDeploy에서 Lifecycle 이벤트에 대한 과정도 볼 수 있으며, In Place에선 없던 AllowTraffic과 AfterAllowTraffic이 보이는 것을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/8546f330-5f7e-4dc1-860d-464a6adc6563/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/1fb115d7-75d4-4a67-9654-a48ff281b7a5/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/87161e0e-ec5a-4aa8-980c-cba2363fa57d/image.png)

배포가 끝났다면 ALB의 DNS에 접속해보자.

![](https://velog.velcdn.com/images/yulmwu/post/79710022-5f87-4c13-b8ca-f770d6198d89/image.png)

잘 배포된 것을 볼 수 있다. 이제 자동화 배포 설정이 끝이 났다.

![](https://velog.velcdn.com/images/yulmwu/post/76557b8f-2806-41c7-b795-dbee8eccc18e/image.png)

위와 같이 코드를 수정한 뒤 다시 Push해보자.

![](https://velog.velcdn.com/images/yulmwu/post/c893887a-7bd6-4f83-8e05-ee9e4962fb2a/image.png)

잘 작동하는 것을 볼 수 있다. 끝...

---

## Error #1 - IAM

![](https://velog.velcdn.com/images/yulmwu/post/1f46b13f-574c-4f56-bffc-f103c73ae8a5/image.png)

CodeDeploy에서 배포 시 위와 같은 에러가 발생할 수 있다.

해외 포럼을 찾아보니 관련 오류가 있는 듯 하다.

- [not give you permission to perform operations in the following AWS service: AmazonAutoScaling. - AWS re:Post](https://repost.aws/ko/questions/QUZ4a9lLVoSTu9t4eF_Cmc0Q/not-give-you-permission-to-perform-operations-in-the-following-aws-service-amazonautoscaling)
- [Simple IAM Issue with CodeDeploy - Stackoverflow](https://stackoverflow.com/questions/53731017/simple-iam-issue-with-codedeploy)

찾아보니 추가적인 IAM 정책이 필요하다고 한다. 아래와 같이 IAM 정책을 추가한뒤 다시 배포를 실행하면 잘 작동한다.

![](https://velog.velcdn.com/images/yulmwu/post/82353d48-8d30-4c26-8b29-b883a1ddd077/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/2d129468-8e1e-400e-82b2-2803684d52a5/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/affb32cf-626e-47e0-9b0f-b7c6e5cf91db/image.png)

대충 보니 오래 전 부터 있던 오류같은데 왜 고쳐지지 않는지는 의문이다.

## Error #2 - Health Check Fail

그리고 `AllowTraffic`이나 `BlockTraffic` 과정에서 무한 로딩이 걸려 넘어가지 않을 때가 있다. 그럴땐 원본 인스턴스나 새롭게 생성된 인스턴스가 Health한지 체크해보도록 하자.

ALB 대상 그룹에서 Health하지 않으면 무한로딩이 되는 듯 싶다. 특히 필자는 테스트로 서버에서 3000번 포트로 열었기 때문에 대상 그룹에서 3000번 포트로 설정되어 있는지 체크해보자.
