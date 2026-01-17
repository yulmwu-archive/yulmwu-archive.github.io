---
title: "[AWS CI/CD] EC2 Deployment with CodeDeploy + Github Actions #1 (Single EC2 Instance)"
description: "AWS CodeDeploy + Github Actions를 통한 EC2 배포 실습 (Single EC2 Instance)"
slug: "2025-07-23-aws-codedeploy-single-ec2"
author: yulmwu
date: 2025-07-23T05:21:34.383Z
updated_at: 2026-01-10T03:03:54.023Z
categories: ["AWS"]
tags: ["CI/CD", "aws"]
series:
  name: AWS
  slug: aws
thumbnail: ../../thumbnails/aws/aws-codedeploy-single-ec2.png
linked_posts:
  previous: 2025-07-23-aws-source-destination-check
  next: 2025-07-23-aws-codedeploy-asg
is_private: false
---

> 본 글에선 단일 EC2 인스턴스에 대해 자동화 배포 아키텍처를 만들고 배포하며, 오토스케일링과 로드 밸런싱이 적용된 아키텍처에서 CodeDeploy를 사용한 자동화 배포 구축은 아래의 글에서 확인해보실 수 있습니다.
> 
> [[AWS] EC2 Deployment with CodeDeploy + Github Actions (with Auto Scaling)](https://velog.io/@yulmwu/aws-codedeploy-asg)
> 
> 본 글에서 CodeDeploy 등의 개념과 간단하게 단일 EC2 인스턴스에 CodeDeploy를 사용한 자동화 배포 방법을 설명합니다.

# 0. Overview

EC2에 도커 컨테이너만 올려서 쓸거면 차라리 ECS(Elastic Container Service)나 EKS(Elastic Kubernetes Service) 등을 사용하는 것이 훨씬 더 간편하게 빠르게 배포할 수 있다.

다만 세밀한 모니터링 또는 설정이 필요하다거나 OS를 만져야할 그런 좀 특수한 상황과 같이 EC2를 사용해야만 하는 경우도 있을 것이다.

아니면 애초에 도커 자체를 사용하지 않아 소스코드를 직접 EC2에 배포하여 pm2 등의 프로그램으로 무중단 배포 후 실행하는 경우도 있을 것이다.

이번 포스팅에선 도커를 사용하지 않으며 직접 소스코드를 오토스케일링이 적용된 EC2에 배포하고 업데이트하는 자동화된 CI/CD를 작성해볼 것이다.

그 중심으로 AWS CodeDeploy에 대해 다뤄볼까 하고, 마지막으로 Github Actions를 통한 자동화까지 해보려고 한다.

# 1. AWS Architecture

![](https://velog.velcdn.com/images/yulmwu/post/8770cec0-e9f0-4158-9883-f79445236933/image.png)

아키텍처를 설명하면 아래와 같다.

먼저 Github Actions CI/CD를 사용하여 Github에 소스코드를 Push하면 프로젝트 소스코드를 빌드하고 S3에 업로드한다.

그리고 Actions가 CodeDeploy 실행 명령어를 실행하고, 소스코드에 포함된(S3에 포함된) `appspec.yml` 파일을 바탕으로 CodeDeploy를 실행한다.

이렇게 되면 CodeDeploy가 Deployment 그룹에 속한 EC2 인스턴스(CodeDeploy Agent가 실행되야함)에서 코드를 실행하고 수정하거나(In Place) Blue/Green 배포 방식대로 인스턴스를 만들고 교체한다.

그 대상으론 단일 EC2, 온프레미스 서버, 오토스케일링 그룹(ASG), ECS, Lambda 등이 될 수 있으나 본 글에선 단일 EC2에 배포하는 방식을 설명하고, 2편에서 오토스케일링 그룹에 CodeDeploy를 적용한 예제를 다루겠다.

Github Actions와 CodeDeploy를 사용한 자동화 아키텍처는 위와 같고, 포스팅에서 사용할 아키텍처는 아래와 같다. (단일 EC2 인스턴스)

![](https://velog.velcdn.com/images/yulmwu/post/d91cb204-85ed-4ec6-969b-d9413bbfec71/image.png)

## What is CodeDeploy?

CodeDeploy는 AWS에서 제공하는 CD(Continuous Deployment, 지속적 배포) 서비스이다.
AWS에서 제공하는 CI 서비스엔 CodeBuild 서비스가 있고, 이들을 관리하는 CodePipeline 서비스도 존재한다.

Jenkins나 Github Actions 다양한 CI/CD 툴이 존재하는데, 굳이 AWS에서 제공하는 CodeDeploy를 사용하려는 이유는 AWS에서 제공하는 만큼 다양한 AWS 서비스를 쉽게 컨트롤 할 수 있기 때문이다.

이 포스팅에선 그 중 CodeDeploy를 사용한 자동화 배포/업데이트에 대해 다루며 EC2, ECS, 람다 함수, 온프레미스 서버 등 다양한 배포 환경을 지원하나 이 글에선 EC2에 대해 다룬다.

CodeDeploy는 배포 그룹(Deployment Group)으로 어디에, 어떤 방식으로 배포할지를 정의하며, 단일 EC2 인스턴스나 오토스케일링 그룹 등을 대상으로 정하고 In Place 방식이나 Blue/Green 방식을 선택할 수 있다.

> ### In Place, Blue/Green
> 
> 배포 방식엔 크게 In Place 방식과 Blue/Green 방식으로 나뉠 수 있는데, 먼저 **In Place** 방식은 기존의 인스턴스에 새로운 코드(애플리케이션)을 덮어쓰는 방식으로 업데이트한다.
> 
> CodeDeploy에서 제공하는 In Place 방식에선 한번에 몇개의 인스턴스를 업데이트할지 정할 수 있다.
> 
> - `AllAtOnce`: 배포 시 모든 인스턴스에 동시에 배포함 (무중단이 중요하지 않을 때, 빠름, 롤링 업데이트 X)
> - `HalfAtATime`: 절반씩 나눠서 인스턴스에 배포함 (10개라면 5개씩 나눠서)
> - `OneAtATime`: 하나씩 배포함, 무중단이 중요하다면 이걸 추천
> 
> 즉 롤링 업데이트의 일종인데, 인스턴스가 교체되는 동안 다른 유효 인스턴스에 트래픽이 몰릴 수 있다는 단점이 있으나, 기존의 인스턴스에 덮어 쓰기 때문에 새로운 인스턴스는 만들지 않는다.
>
> ![](https://velog.velcdn.com/images/yulmwu/post/6030932e-5dc7-42d5-876c-16e0bb6c0c72/image.png)
> 
> **Blue/Green** 방식은 정 반대로, 새로운 분기점을 만든다. 무슨 말이냐, 예를 들어 기존에 오토스케일링 그룹이 있고 그 안에 5개의 인스턴스가 돌아간다면 업데이트된 새로운 오토스케일링 그룹을 만들고 그 안에 새로운 인스턴스를 새로 만든다는 것이다.
> 
> 그리고 그 새로운 인스턴스를 사용할 수 있다면 로드밸런서 등에서 대상을 새로운 오토스케일링 그룹으로 변경하여 업데이트하는 방식이다.
> 
> 덕분에 무중단으로 서비스가 업데이트되고, 점차적으로 업데이트되는 In Place 방식과는 다르게 한번에 업데이트되기 때문에 관련된 오류도 없는 편이다. 
> 
> 하지만 업데이트되는 동안엔 새로운 인스턴스가 만들어지고 그 만큼 리소스가 2배로 소비되기 때문에 그럴 환경이 안된다면 사용할 수 없는 배포 방식이다. 다만 우리는 클라우드 환경이기 때문에 큰 문제 없이 사용할 수 있고, 업데이트 후 기존의 리소스는 제거되기 때문에 리소스 사용량 또한 큰 걱정을 할 필요는 없다.
> 
> ![](https://velog.velcdn.com/images/yulmwu/post/ceae6c98-fea0-4d2d-99d0-72221f78c2ce/image.png)
> 
> 이 포스팅에선 Blue/Green 배포 방식을 사용한다.

CodeDeploy에서 배포할 새로운 코드는 S3나 Github 레포지토리, CodeCommit 등의 서비스에서 가져올 수 있으나 S3에 업로드된 소스코드를 가져오는 식으로 사용해볼 것이다.

또한 CodeDeploy에선 AppSpec 파일(`appspec.yml`)을 통해 배포를 어떻게 진행할 지 명령이나 단계를 정의하고, 어떤 스크립트를 실행할 지 정할 수 있다.

```yaml
version: 0.0
os: linux
files:
  - source: /
    destination: /home/ec2-user/app
hooks:
  BeforeInstall:
    - location: scripts/before_install.sh
  AfterInstall:
    - location: scripts/after_install.sh
  ApplicationStart:
    - location: scripts/start.sh
```

여기서 Hooks의 각 단계를 Lifecycle Event Hooks라고 부르는데, 각 단계에서 어떤 스크립트를 실행할 지를 정의한다.

### Lifecycle Event Hooks

#### (1) ApplicationStop

배포가 진행되기 전, 기존의 애플리케이션을 중단할 때 실행되는 훅이다. 

`pm2 stop all`, `docker stop` 등의 명령어를 스크립트에 넣어 애플리케이션을 종료한다.

다만 Blue/Green 배포 방식에선 생략하는 경우가 많다. Blue 인스턴스는 살려두고 업데이트 전까진 Blue 인스턴스에 트래픽을 전달해야 하고, Green 인스턴스로 전환된다면 기존의 Blue 인스턴스는 삭제되기 때문이다.

#### (2) BeforeInstall

이 과정에서 `ApplicationStop` 단계의 절차를 처리하기도 하는데, 업데이트된 새로운 코드를 설치하기 전에 실행된다.

예를 들어 기존의 애플리케이션 디렉토리를 삭제한다던지, `ApplicationStop` 단계와 합쳐 애플리케이션을 종료한다던지 등을 수행한다.

#### (3) AfterInstall

CodeDeploy Agent가 코드를 가져와 `app` 디렉토리 등에 복사한 뒤 실행되는 단계이다.
NodeJS를 사용한다면 소스코드의 의존성을 설치하고, 필요에 따라 코드를 빌드하고 환경 변수를 세팅한다.

#### (4) ApplicationStart

애플리케이션이 실행되는 명령을 정의하는 단계이다. NodeJS를 사용한다면 무중단 서비스를 위해 pm2를 사용한다던지, `systemctl` 등의 명령어로 데몬 프로세스를 실행하는 등의 작업을 수행한다.

#### (5) ValidateService

애플리케이션 실행 후, 실행된 애플리케이션이 정상적으로 작동하는지 체크하는 단계이다.

예를 들어 웹서버라면 `curl -f http://localhost:3000/health` 등의 명령어를 실행하여 Health Check를 하는 등의 작업을 수행한다.

#### (6, 7) BeforeAllowTraffic, AfterAllowTraffic (Blue/Green)

Blue/Green 배포 방식에서만 실행되는 단계로, 업데이트되기 전의 Blue 인스턴스를 업데이트된 Green 인스턴스로 전환할 때 전환되기 전/후에 실행되는 단계이다.

위 7단계에서 하나라도 실패하여 오류를 띄우게 된다면 그 배포는 중단되며 실패 처리가 된다.

### CodeDeploy Agent

위에서 설명하지 못한 내용인데, CodeDeploy를 통해 배포를 하려면 EC2 등에서 CodeDeploy Agent를 백그라운드 데몬 프로세스로 돌려야한다.

CodeDeploy Agent는 해당 인스턴스에서 애플리케이션 소스코드를 다운로드하고 AppSpec을 처리, 정의된 스크립트를 실행하는 등 CodeDeploy 서비스를 사용하기 위한 필요적인 작업들을 처리한다.

# 2. Let's build the Infra

이제 인프라를 구축해보자. 서비스의 이름은 `exam` 접두사로 통일한다.

복잡한 구조는 아니니 VPC를 따로 만들진 않으나, ASG를 적용한 예제에선 VPC를 따로 만든다.

## EC2 Provisioning

서버로 사용할 EC2를 만들어주자. 퍼블릭 서브넷에 EC2를 만들고, 퍼블릭 IP를 부여한다.
실제로 사용할 서비스는 아니니 대충 만들어주자.

![](https://velog.velcdn.com/images/yulmwu/post/e4417e70-e681-4c1f-84e1-c92c48cabb59/image.png)

EC2가 프로비저닝되었다면 SSH 접속 후 아래의 명령어를 통해 CodeDeploy Agent와 NodeJS / NPM, 그리고 무중단 구동을 위한 PM2를 설치해주겠다.

```shell
sudo apt-get update
sudo apt-get install -y ruby wget nodejs npm

cd /home/ubuntu
wget https://aws-codedeploy-ap-northeast-2.s3.ap-northeast-2.amazonaws.com/latest/install
chmod +x ./install
sudo ./install auto

npm install -g pm2
```

설치가 완료되었다면 아래의 명령어를 통해 CodeDeploy Agent와 NodeJS, NPM, PM2가 잘 설치되었는지 확인해보자.

```shell
sudo service codedeploy-agent status
node -v
npm -v
pm2 -v
```

![](https://velog.velcdn.com/images/yulmwu/post/3ce2c7d7-278b-490c-9966-71fef5f660fd/image.png)

그리고 테스트를 위해 홈 디렉토리(`~`, `/home/ubuntu`)에 `app` 디렉토리를 만들고 돌리고자 하는 소스코드를 다운로드하여 PM2를 통해 실행해보자.

예제는 아래의 깃허브 레포지토리에 올려두었다.

https://github.com/eocndp/aws-codedeploy-example

![](https://velog.velcdn.com/images/yulmwu/post/9db23f93-b860-47b2-acfb-59751a348c2c/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/3255e0a5-bb34-4730-aad3-20250c2fd74e/image.png)

이러면 SSH 세션을 꺼도 무중단으로 실행된다.

![](https://velog.velcdn.com/images/yulmwu/post/a5839ed1-2f55-47b3-bab5-e8ef8575dd87/image.png)

이제 CodeDeploy를 통해 업데이트를 해보도록 하자.

## IAM

CodeDeploy를 설정하기 전에 IAM 정책을 몇가지 만들어둬야 편하다.

먼저 EC2에 설치된 CodeDeploy Agent가 S3 등에 접근할 수 있도록 하는 IAM과, CodeDeploy가 EC2나 ASG에 접근할 수 있도록 하는 IAM이 필요하다.

### EC2CodeDeployRole

EC2에 붙일 IAM 역할을 만든다.

![](https://velog.velcdn.com/images/yulmwu/post/9f27a35f-fb03-4b15-b3e0-f1e2f13ec17e/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/85f15338-c192-49ae-b728-4763e70a6945/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/9fb902e2-ac99-4011-b789-b89c0ba476f8/image.png)

그리고 아까 만들어둔 EC2에 이 IAM 역할을 붙이도록 하자.

![](https://velog.velcdn.com/images/yulmwu/post/43ab576f-5628-46c7-806b-0c469573bc64/image.png)

그리고 EC2 IAM 역할을 수정했다면 CodeDeploy Agent 서비스를 재시작해야한다. 

```shell
sudo service codedeploy-agent restart
```

안해주면 에러뜬다.

### CodeDeployServiceRole

다음으로 CodeDeploy를 위한 IAM 역할을 하나 만들자. CodeDeploy가 EC2, ASG 등에 접근할 수 있도록 하기 위함이다.

![](https://velog.velcdn.com/images/yulmwu/post/28d88fc4-41e5-421c-8e46-9dfb08263d4c/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/8a001de4-8b22-443c-b0a1-d9975ea06641/image.png)

CodeDeploy에 부여할 수 있는 정책은 저거 하나밖에 없다.

![](https://velog.velcdn.com/images/yulmwu/post/04899b4c-4a42-461d-afc0-e9da59766df0/image.png)

## CodeDeploy

이제 본격적으로 CodeDeploy 설정을 해보자.

![](https://velog.velcdn.com/images/yulmwu/post/a7d6fe51-d69e-4b86-a79d-cbbfece06558/image.png)

애플리케이션을 만드는데, 컴퓨팅 플랫폼은 EC2/온프레미스를 선택한다. EC2 ASG를 적용할때도 저걸 선택하면 된다.

![](https://velog.velcdn.com/images/yulmwu/post/04413a13-85a3-4bd5-bad6-3887503467e1/image.png)

이렇게 만들어졌다면 다음으로 배포 그룹을 만들어야 한다. CodeDeploy는 배포 그룹 단위로 배포를 진행한다.

![](https://velog.velcdn.com/images/yulmwu/post/cb86aa8d-34ff-4b75-b87a-62e88ba95569/image.png)

아까 만들어둔 IAM 역할을 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/4441316e-be4e-4510-8897-d54c320fbab0/image.png)

배포 유형은 현재 위치, 즉 In Place를 선택한다. 

![](https://velog.velcdn.com/images/yulmwu/post/a9d5c1da-9f9f-4c5f-a4bc-724a6161bce1/image.png)

아까 만들어둔 EC2를 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/d579d6e6-d5cc-4d55-93b6-11f4f0ac34d3/image.png)

그리고 Systems Manager를 사용하여 CodeDeploy Agent를 설치하라는데 우리는 아까 설치해뒀으니 생략한다.

![](https://velog.velcdn.com/images/yulmwu/post/a06f5d62-9e07-4f7b-92c5-c4951afc387f/image.png)

로드밸런싱도 선택하지 않는다.

## AppSpec and Scripts

이제 코드로 돌아와 CodeDeploy 배포를 위한 AppSpec(`appspec.yml`) 파일과 관련 스크립트 파일을 작성해보자.

프로젝트 루트 디렉토리에 `appspec.yml` 파일을 만들어주고, 아래와 같이 입력하자.

```yaml
version: 0.0
os: linux
files:
  - source: .
    destination: /home/ubuntu/app
```

S3에 업로드해둔 소스코드를 가져오고 그걸 `~/app`에 복사해둔다. 그 다음으로 CodeDeploy Lifecycle 이벤트에 맞는 Hook 스크립트를 작성하는데, 사용할 Hook들은 아래와 같다.

```yaml
hooks:
  ApplicationStop:
    - location: scripts/stop_server.sh
      timeout: 60
      runas: ubuntu

  BeforeInstall:
    - location: scripts/before_install.sh
      timeout: 60
      runas: ubuntu

  AfterInstall:
    - location: scripts/install_dependencies.sh
      timeout: 60
      runas: ubuntu

  ApplicationStart:
    - location: scripts/start_server.sh
      timeout: 60
      runas: ubuntu

  ValidateService:
    - location: scripts/validate_service.sh
      timeout: 60
      runas: ubuntu
```

먼저 `ApplicationStop` 이벤트를 처리할 스크립트는 아래와 같다.

```bash
#!/bin/bash
echo "Stopping existing app..."
pm2 stop ecosystem.config.js || true
```

기존에 PM2로 실행되고 있던 프로세스를 끈다. 다음으로 `BeforeInstall` 이벤트에 대한 스크립트는 아래와 같다.

```bash
#!/bin/bash
echo "Cleaning old app files..."
sudo chown -R ubuntu:ubuntu /home/ubuntu/app
rm -rf /home/ubuntu/app/*
```

기존의 `app` 디렉토리의 파일들을 삭제한다. 위 두 이벤트를 하나라 합쳐도 상관 없긴 하다.

`AfterInstall` 과정 이후 통해 소스코드를 설치했다면 NodeJS 의존성을 설치하도록 한다. 
(`install_dependencies.sh`)

```bash
#!/bin/bash
echo "Installing dependencies..."
sudo chown -R ubuntu:ubuntu /home/ubuntu/app
cd /home/ubuntu/app
npm install
```

그리고 PM2를 통해 실행하도록 한다. (`ApplicationStart`, `start_server.sh`)

```bash
#!/bin/bash
echo "Starting the app with PM2..."
cd /home/ubuntu/app
pm2 start ecosystem.config.js
```

마지막으로 잘 작동하는지 검증한다. PM2 실행 직후 바로 검증을 하면 레이턴시로 인해 잘 안될 수 있으니 여러번 시도하여 Health Check를 하는 코드를 작성해주었다. (`ValidateService`, `validate_service.sh`)

```bash
#!/bin/bash
echo "Validating application..."
for i in {1..10}; do
    curl -f http://localhost:3000/health && exit 0
    echo "Waiting for server to respond..."
    sleep 2
done
echo "Server did not respond in time."
exit 1
```

그럼 AppSpec 파일과 스크립트 파일을 작성해주었다면, Github Actions에서 사용할 워크플로우 코드를 작성해보자.

## Github Actions

```yaml
name: Deploy to EC2 with CodeDeploy

on:
  push:
    branches: main

jobs:
  deploy:
    name: Deploy CodeDeploy
    runs-on: ubuntu-latest

    env:
      AWS_REGION: ap-northeast-2
      S3_BUCKET: exam-codedeploy-bucket
      S3_KEY: dist.zip
      CODEDEPLOY_APP: ExamCodeDeployApp
      CODEDEPLOY_GROUP: ExamDeploymentGroup

    steps:
      - name: Checkout source
        uses: actions/checkout@v3

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-northeast-2
          
      - name: Zip source code
        run: |
          zip -r dist.zip . -x '*.git*' -x 'node_modules/*'
```

AWS 인증을 해주고, S3에 배포하고 CodeDeploy에서 사용하기 위해 소스코드를 압축한다.

```yaml
      - name: Delete old artifact from S3
        run: |
          aws s3 rm s3://$S3_BUCKET/$S3_KEY || true
          
      - name: Upload artifact to S3
        run: |
          aws s3 cp dist.zip s3://$S3_BUCKET/$S3_KEY
```

그리고 기존에 S3에 올렸던 아키텍트 파일을 삭제해주고, S3에 업로드한다.

```yaml
      - name: CodeDeploy deployment
        run: |
          aws deploy create-deployment \
            --application-name $CODEDEPLOY_APP \
            --deployment-group-name $CODEDEPLOY_GROUP \
            --s3-location bucket=$S3_BUCKET,key=$S3_KEY,bundleType=zip \
            --deployment-config-name CodeDeployDefault.AllAtOnce \
            --file-exists-behavior OVERWRITE
```

마지막으로 위와 같이 CodeDeploy에 배포 명령을 주도록 하여 CodeDeploy를 실행한다.

여기까지 사용했던 모든 소스코드는 아래의 깃허브 레포지토리에서 확인할 수 있다.

https://github.com/eocndp/aws-codedeploy-example

## Deployment

이제 코드를 깃허브에 업로드하면 아래와 같이 워크플로우가 잘 실행되는 것을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/2fc99540-8078-48db-9f91-965041e95d7c/image.png)

그리고 CodeDeploy의 로그를 확인해보자. 

![](https://velog.velcdn.com/images/yulmwu/post/7368f713-e146-4c13-81d7-757c2d419f2b/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/d113c593-a38b-4a48-9865-c570bedfd902/image.png)

잘 배포되는 모습을 볼 수 있으며, 속도도 빠르게 배포된다. (빌드하는 과정 없이 Express 하나만 있으니 빠른게 당연하긴 함)

그리고 예시로 코드를 수정하고 다시 배포해보자.

![](https://velog.velcdn.com/images/yulmwu/post/156f54ca-1656-4eff-ba3e-e17d2ff3b5ae/image.png)

이제 코드를 수정하고 깃허브 레포지토리에 Push하기만 하면 된다.

![](https://velog.velcdn.com/images/yulmwu/post/3777f5af-c21b-4293-a850-a90758be0aed/image.png)

접속해보면 아래와 같다.

![](https://velog.velcdn.com/images/yulmwu/post/6ca47be9-ad7a-47dc-af69-b81f7f2163bc/image.png)

---

만약 에러가 뜬다면 아래의 사진처럼 Lifecycle 이벤트별로 쉽게 확인할 수 도 있다.

![](https://velog.velcdn.com/images/yulmwu/post/8a168e35-d50a-442f-bee2-d903ec7e0329/image.png)

참고로 위 에러는 pm2 실행 직후 바로 `curl`을 통해 Health Check를 해서 그런데, 살짝의 틈을 주거나 루프를 돌려 좀 기다린다면 잘 작동한다.

다음 편에선 단일 EC2 인스턴스가 아닌 오토스케일링 그룹이 적용된 아키텍처에서 CodeDeploy를 설정하는 방법을 설명하겠다.

> 2편: [[AWS] EC2 Deployment with CodeDeploy + Github Actions (with Auto Scaling)](https://velog.io/@yulmwu/aws-codedeploy-asg)