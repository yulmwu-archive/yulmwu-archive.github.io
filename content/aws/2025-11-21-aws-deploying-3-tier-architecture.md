---
title: '[AWS Computing] Deploying 3 Tier Architecture (ALB, Bastion, RDS)'
description: 'AWS ALB - EC2 - RDS로 3 Tier 아키텍처 구현하기'
slug: '2025-11-21-aws-deploying-3-tier-architecture'
author: yulmwu
date: 2025-11-21T12:27:07.839Z
updated_at: 2026-01-13T04:04:55.885Z
categories: ['AWS']
tags: ['aws']
series:
    name: AWS
    slug: aws
thumbnail: ../../thumbnails/aws/aws-deploying-3-tier-architecture.png
linked_posts:
    previous: 2025-11-21-aws-deployment-with-ec2-ecs-and-documentdb-elasticache
    next: 2025-11-21-aws-deploying-ecs-fargate-dynamodb
is_private: false
---

> _본 포스팅의 자료는 세명컴퓨터고등학교 보안과 전공동아리 Null4U(출제: 양OO 선배님)에 있음을 알립니다._
>
> 과제 제출일: 2025/11/21

# 0. Overview — Problem

> 이 과제는 AWS의 **고가용성(High Availability)**과 **3-Tier 아키텍처** 구조를 실습하기 위해 설계된 환경입니다.
>
> 전체 구성은 다음 세 계층으로 이루어집니다:
>
> - **Public Tier** — ALB, Bastion
> - **Private Tier** — WAS
> - **Protected(Data) Tier** — RDS
>
> 자세한 아키텍처 다이어그램은 아래에 첨부된 자료를 참조하십시오. 채점 기준은 아래와 같습니다.
>
> - ALB 뒤에 위치한 두 개의 WAS EC2 인스턴스는 로드밸런싱되어 번갈아 응답됩니다. 웹 페이지에서 새로고침을 반복했을 때 EC2 Instance ID 및 EC2 Private IP 값이 변경되어야 합니다.
> - ALB 뒤에 위치한 두 개의 WAS EC2 인스턴스에 대한 SSH 접근은 오로지 Bastion Host를 통해서만 접근해야 합니다.
> - RDS 인스턴스는 반드시 Protected Subnet에만 생성되어야 하며, WAS를 제외한 어떠한 대상과도 통신할 수 없어야 합니다.

![](https://velog.velcdn.com/images/yulmwu/post/d4d6303b-d015-48e2-99b6-e6102cae0c39/image.png)

WAS로써 배포해야 할 애플리케이션 소스 코드는 아래 레포지토리에서 다운받으실 수 있습니다.

https://github.com/yulmwu/blog-example-demo/tree/main/aws-3-tier-architecture-example

_배포 방식은 따로 명시되어 있지 않아 NodeJS를 설치하여 직접 실행해도 되고 도커를 통해 이미지화하여 배포해도 되나, 본 포스팅에선 전자의 방식을 택하였습니다._

# 1. VPC

![](https://velog.velcdn.com/images/yulmwu/post/0d583cc0-db1f-4312-a011-9dff6cf075d1/image.png)

먼저 CIDR `10.0.0.0/16`의 VPC를 만들어보자. Public 서브넷 2개와 Protected 서브넷을 포함한 Private 서브넷 4개를 만들어줘야 한다.

각 서브넷의 가용 영역은 따로 명시되어 있지는 않지만 `ap-northeast-2a`와 `ap-northeast-2c`로 통일하고, 아키텍처에 명시된 서브넷 CIDR을 따르도록 한다. _(Bastion Host를 올려두지 않는 유휴 Public 서브넷 하나는 생성만 해둘 것)_

![](https://velog.velcdn.com/images/yulmwu/post/3ab33e1c-2754-44e6-938d-7cb91f4de5c5/image.png)

최종적인 VPC 리소스맵은 아래와 같다.

![](https://velog.velcdn.com/images/yulmwu/post/48d1127e-c8e5-4ff4-be7c-5adfced13e6c/image.png)

# 2. EC2 Provisioning

![](https://velog.velcdn.com/images/yulmwu/post/f409a7d2-66d2-490c-9db0-747b7108ef00/image.png)

다음으로 EC2 인스턴스 3개를 프로비저닝하자. 첫번째로 만들 인스턴스는 Public 서브넷에 위치하고 Public IP를 허용하는 유일한 EC2 인스턴스인 Bastion Host이다.

Bastion Host에 대해선 필자가 따로 포스팅한 자료가 있으니 참고하면 좋을 것 같다.

https://velog.io/@yulmwu/ec2-bastion-host

# (2-1). Bastion Host

Bastion Host는 앞서 설명했듯 Public 서브넷에 위치하며 Public IP를 갖는다. 두 Public 서브넷 중 어디에 위치해도 크게 상관은 없지만 아키텍처에 명시되어 있는 대로 10.0.1.0/24 서브넷에 프로비저닝하겠다.

![](https://velog.velcdn.com/images/yulmwu/post/7ef4042b-526b-4485-8240-bdf369666d75/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/6d38a400-3b37-4f19-bc64-8d671a102261/image.png)

Bastion Host는 SSH 접속 후 Private/Protected 서브넷에 접근할 수 있도록 하기 위함이기 때문에 따로 테스트해보지 않고 추후 테스트 목차에서 확인해보겠다.

# (2-2). WAS Instances

그리고 WAS 애플리케이션을 배포할 2개의 인스턴스를 프로비저닝해볼 것이다.
이 2개의 인스턴스는 Private 서브넷에 위치하도록 한다.

오토스케일링 그룹을 사용한다고 명시되어 있지 않기 때문에 직접 만들어 보도록 하겠다.

NodeJS와 NPM을 기본적으로 설치하고 PM2를 통해 무중단 서비스를 간단하게 구성해보겠다. WAS의 기본 포트는 3000번으로 이후 ALB에서 해당 포트로 통신하도록 할것이기 때문에 3000번 포트를 열어두자.

![](https://velog.velcdn.com/images/yulmwu/post/7d4e3a7f-75c7-4348-acdf-a89f21800112/image.png)

위와 같이 모두 프로비저닝 되었다면 Bastion Host로 접속하여 아래와 같은 명령어를 차례대로 입력한다.

_User data를 통해 설치하도록 해도 되었겠지만 직접 Bastion Host로 접속하여 실습해보겠다._

```shell
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g npm
```

```shell
git clone https://github.com/yulmwu/blog-example-demo.git
cd blog-example-demo/aws-3-tier-architecture-example

npm install
npm run pm2-start
```

> 아키텍처 상 Private 서브넷 및 Protected 서브넷은 IGW가 없어 인터넷과 통신할 수 없기 때문에 NAT Gateway를 구성해야 한다. 아키텍처 상 NAT Gateway는 없으나 아래와 같이 만들어주면 된다.
>
> ![](https://velog.velcdn.com/images/yulmwu/post/c17680ef-51b6-449b-964e-5acf89104a50/image.png)
>
> Private/Protected 서브넷의 라우팅 테이블에 `0.0.0.0` (인터넷) 라우팅을 만든 NAT Gateway로 설정하면 된다.
>
> ![](https://velog.velcdn.com/images/yulmwu/post/f240eec7-3ae8-4a72-8f5f-1dbbc33603c4/image.png)
>
> 모든 구성이 끝났다면 NAT Gateway를 제거해도 될 것이다.

필자가 PM2 구성까지 해뒀기 때문에 최종적으로 아래와 같이 PM2 프로세스에 app.js가 등록된 것을 확인할 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/0ece847b-6aaa-4c40-a0da-9ceb7b1de9a7/image.png)

그런데 로그를 확인해보면 아래와 같은 에러가 발생하는 것을 확인할 수 있는데, 아직 DB 정보를 환경 변수로 설정하지 않았기 때문이다.

![](https://velog.velcdn.com/images/yulmwu/post/04d67289-05fd-4082-a98e-f9ec3c93e1bc/image.png)

나중에 DB 인스턴스 프로비저닝 후 환경 변수를 수정하여 다시 시작하면 된다.

추가적으로 두 개의 WAS에 연결된 보안 그룹의 이름을 구분하기 쉽도록 수정해두자.
Protected 서브넷에 위치한 DB 인스턴스는 이 보안 그룹과만 통신할 수 있어야 한다.

![](https://velog.velcdn.com/images/yulmwu/post/509456a9-76c1-481a-8ce8-27a3e2c38607/image.png)

# 3. Application Load Balancer Provisioning

![](https://velog.velcdn.com/images/yulmwu/post/2d5ba142-22b4-4b67-9547-3e126c9a6c5a/image.png)

그리고 ALB를 구성해보자. 먼저 ASG 없이 타겟 그룹을 만들고 두 개의 WAS 인스턴스를 직접 등록하겠다.

![](https://velog.velcdn.com/images/yulmwu/post/f49d902a-387f-4f6a-9978-de580c499f93/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/049f9a42-f7ec-4397-a848-2db68a893202/image.png)

대상 그룹을 만들고 인스턴스를 등록했다면 ALB를 만들자. Internet facing ALB를 만들어야 한다.

![](https://velog.velcdn.com/images/yulmwu/post/9035a9b1-16f5-4bf1-9cec-51a3d31c1f03/image.png)

ALB가 배치될 서브넷은 두 개의 Public 서브넷을 선택해주겠다.

![](https://velog.velcdn.com/images/yulmwu/post/85161e02-afec-42ef-9cd7-2fd5e329f763/image.png)

보안 그룹은 80번 포트를 허용한 보안 그룹을 만들고 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/fd7c1ad4-4361-4265-a6ef-55176daa31e4/image.png)

그리고 리스너 HTTP 80을, 대상 그룹은 만들어둔 `was-tg`를 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/6bf18f96-46fa-4de2-b461-a2206d7fcca2/image.png)

이로써 ALB 구성을 마쳤다.

![](https://velog.velcdn.com/images/yulmwu/post/a430489e-cde3-4a0a-ac01-9dbfcf843396/image.png)

대상 그룹이 Healthy한지 확인해보자.

![](https://velog.velcdn.com/images/yulmwu/post/f7e7aa16-bf13-45bc-8504-3ef066d42320/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/7bb2d862-169e-4f20-8c33-9206eeccdcc3/image.png)

마지막으로 DB만 프로비저닝하면 된다.

# 4. RDS Aurora Provisioning

![](https://velog.velcdn.com/images/yulmwu/post/254c41fd-9b88-4a09-9b77-1b281ab6abc5/image.png)

아키텍처엔 Aurora DBMS로 명시되어 있는데, MySQL을 선택해도 무방하다.

DB 인스턴스를 프로비저닝하기 전 서브넷 그룹을 만들고 Protected 서브넷에만 올라가도록 구성하자.

![](https://velog.velcdn.com/images/yulmwu/post/e34a5402-bddf-47b4-a392-04160c30c38f/image.png)

---

![](https://velog.velcdn.com/images/yulmwu/post/303f243e-3a59-46bb-bf59-8a2c7e4c8098/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/fc73ade2-9dde-47f6-819f-8569c1a77582/image.png)

고가용성을 위해 다중 AZ에 배포되도록 옵션을 체크하자. 그럼 Protected 서브넷 1과 2에 동시에 프로비저닝 될 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/6c9687da-d96b-4669-937c-e2f4eb29b8e4/image.png)

서브넷 그룹은 아까 Protected 서브넷만 선택된 서브넷 그룹을 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/54ca9eb0-6edc-42c5-b346-914eaa6fce5e/image.png)

보안 그룹은 아래와 같은 보안 그룹을 만들고 WAS 인스턴스에 연결한 보안 그룹을 선택한다.

![](https://velog.velcdn.com/images/yulmwu/post/eb55e816-154d-44ec-9728-83d08cd358f7/image.png)

MySQL/Aurora DB의 기본 포트는 3306번이다.

![](https://velog.velcdn.com/images/yulmwu/post/dc541c8f-8ab8-4add-ab64-7f61f1df1df9/image.png)

이상으로 DB 인스턴스를 프로비저닝하자. 그럼 아래와 같이 두 Protected 서브넷에 RDS 인스턴스가 생성된 것을 볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/36385d7a-84a8-4f11-b8a2-92968e24c2a1/image.png)

이제 Primary DB 엔드포인트 주소와 Read Only 엔드포인트 주소도 같이 나오는데, Primary DB 엔드포인트 주소를 복사하여 WAS 애플리케이션의 환경 변수로 등록해주자.

```js
DB_HOST=mysql-rds.cluster-....ap-northeast-2.rds.amazonaws.com
DB_USER=admin
DB_PASSWORD=...
DB_DATABASE=mydb
```

그리고 Bastion Host에서 MySQL 클라이언트로 접속하여 데이터베이스를 생성해줘야 한다.

```shell
> mysql -h mysql-rds.cluster-cp4cewyumxw7.ap-northeast-2.rds.amazonaws.com -u admin -p

mysql> CREATE DATABASE `mydb`;
```

그리고 WAS 애플리케이션 EC2에 접속하여 위 환경 변수로 수정하고, `npm run pm2-restart`를 통해 재시작하자.

# 5. Testing

![](https://velog.velcdn.com/images/yulmwu/post/fbbe3e04-3766-4427-9ee4-1148a02036ad/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/5b04ac0a-bafe-45fa-bcb7-7ba36aed02c4/image.png)

잘 동작하는 것을 볼 수 있다. 실습 후 RDS의 경우 요금이 많이 청구될 수 있으니 바로 종료시키는 것을 추천한다.
