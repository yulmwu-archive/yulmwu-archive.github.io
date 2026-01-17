---
title: "[Terraform CI/CD] Terraform CI/CD Pipeline with Github Actions"
description: "Github Actions를 통한 Terraform CI/CD 파이프라인 구축"
slug: "2025-12-12-terraform-ci-cd-with-github-actions"
author: yulmwu
date: 2025-12-12T08:59:59.463Z
updated_at: 2026-01-15T19:55:36.465Z
categories: ["Terraform"]
tags: ["CI/CD", "aws", "terraform"]
series:
  name: Terraform
  slug: terraform
thumbnail: ../../thumbnails/terraform/terraform-ci-cd-with-github-actions.png
linked_posts:
  previous: 
  next: 
is_private: false
---

# 0. Overview

요즘 클라우드나 온프레미스 인프라는 IaC(Infrastructure as Code)라고 해서 인프라를 코드로 작성한다. 그 중 대표적인게 Terraform, Ansible 이나 AWS 한정으로 CloudFormation 등이 있다. 

필자가 사용해보거나 자주 사용하는 IaC 도구가 Terraform, CloudFormation과 Pulumi 등이 있지만 그 중에서 Terraform을 가장 많이 사용하는 듯 하다. 이번 포스팅에선 Terraform에 대하여 Github Actions를 통한 CI/CD 파이프라인을 구축해보겠다. (다음 Terraform CI/CD 파이프라인 구축편에서 Atlantis를 사용해보도록 하겠다.)

---

크게 PR이 Open 되었을 때 트리거되는 CI와 PR이 Merge 되었을 때 트리거되는 CI/CD 파이프라인이 있다. 

PR이 Open 되었을 때 트리거(1)되는 CI 워크플로우는 포맷 체크 및 Terraform Validate를 수행한다. 결과를 별도로 Slack 등으로 보내진 않고, PR 화면에서 포맷 체크와 Validate를 통과했는지만 확인하는 용도로 사용하겠다.

> 해당 구조(레포지토리를 Fork하여 PR을 보내는 구조)에서 Github Actions 만으론 이 위치의 CI에서 Plan 등을 실행할 수 없다.
> 
> Terraform Plan을 위해선 AWS 자격 증명이 필요한데, Forked 레포지토리에서 온 PR의 코드에 RCE 등을 실행하는 코드가 있을 수 있어 보안상 취약해질 수 있다. 때문에 자체적으로 Forked 레포지토리의 PR에 대해 Secrets 접근, OIDC 토큰 생성 등을 제한하게 된다.
> 
> 단 `pull_request_target` 이벤트로 대신하게 된다면 워크플로우가 원본 레포지토리(Base)에서 실행되는데, 이 이벤트는 보안상 매우 취약해질 수 있기 때문에 사용을 자제하는 것이 좋다. 이 포스팅에서 또한 사용하지 않는다. 

그리고 PR이 승인되어 Merge 되었을 때 트리거(2-1)되는 CI/CD 워크플로우는 AWS 자격 증명을 요구한다. 이를 위해서 OIDC Assume Role을 통해 임시 자격 증명을 얻어보도록 구성하였고, 이 워크플로우의 CI에선 Terraform Planning과 Plan 결과를 Actions Artifacts로 업로드 및 Slack Webhook으로 전송한다. 

다음으로 CD는 Dispatch를 통해서 수동으로 트리거(2-2)할 수 있도록 하고, Artifacts에서 다운로드 받은 Plan을 Apply 한다.

![](https://velog.velcdn.com/images/yulmwu/post/9a96a438-0602-400e-8027-cf99d645a632/image.png)

옵션이지만 필자의 팀 내부에선 Terraform 코드를 운영하는 원본 레포지토리에 직접 Push 하는 것을 막고, 오로지 PR을 통해서만 기여할 수 있도록 제한하는데, 이때 Github Branch Protection Rule을 설정할 수 있지만 이 포스팅에선 다루지 않겠다.

# 1. Demo — Terraform Example

Terraform을 중심적으로 다루는 것이 아닌 Github Actions를 통한 CI/CD 파이프라인을 구축해보는 것이 목표이기 때문에 단순한 HCL을 작성하도록 하겠다. AWS S3와 CloudFront를 OAC를 통해 연동하여 정적 웹을 호스팅하는 예제이다. (AWS Provider)

모든 예시는 아래의 블로그 깃허브 레포지토리에서 확인해볼 수 있다. 

https://github.com/yulmwu/blog-example-demo/tree/main/terraform-ci-cd

```py
# terraform/provider.tf

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
```

```py
# terraform/variables.tf

variable "aws_region" {
  type    = string
  default = "ap-northeast-2"
}

variable "project_name" {
  type    = string
  default = "..." # 값 변경 필요
}
```

```py
# terraform/outputs.tf

output "s3_bucket_name" {
  value = aws_s3_bucket.static_site.bucket
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.this.domain_name
}
```

그리고 아래는 S3, CloudFront(OAC) 및 Policy를 구성하는 Terraform HCL 코드이다.

```py
# terraform/s3.tf

resource "aws_s3_bucket" "static_site" {
  bucket = "${var.project_name}-bucket"

  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.static_site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.static_site.id

  versioning_configuration {
    status = "Enabled"
  }
}
```

```py
# terraform/policy.tf

data "aws_iam_policy_document" "s3_policy" {
  statement {
    sid = "AllowCloudFrontAccess"

    actions = [
      "s3:GetObject"
    ]

    resources = [
      "${aws_s3_bucket.static_site.arn}/*"
    ]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values = [
        aws_cloudfront_distribution.this.arn
      ]
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.static_site.id
  policy = data.aws_iam_policy_document.s3_policy.json
}
```

```py
# terraform/cloudfront.tf

resource "aws_cloudfront_origin_access_control" "oac" {
  name                              = "${var.project_name}-oac"
  description                       = "OAC for S3 static site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  default_root_object = "index.html"

  origin {
    domain_name              = aws_s3_bucket.static_site.bucket_regional_domain_name
    origin_id                = "s3-origin"
    origin_access_control_id = aws_cloudfront_origin_access_control.oac.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-origin"
    viewer_protocol_policy = "redirect-to-https"

    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
```

필자가 동작하는 Terraform 코드를 준비했지만, 필요에 따라 로컬에서 `terraform init` 및 `terraform plan`이나 `terraform apply -auto-approve`를 통해 적용해볼 수 있다. CD에서 Apply가 진행되는 것을 실습해보기 위해 로컬에서 Apply 시 Destroy 까지 해주자.


# 2. Demo — Github Actions Workflows

예제의 Github Actions Workflows의 디렉토리 구조는 아래와 같다.

```
.
├── .github
│   └── workflows
│       ├── terraform-ci-cd-plan.yaml        # main merge -> plan (Plan CI)
│       ├── terraform-ci-cd-apply.yaml       # (manually) apply (Apply CD)
│       └── terraform-pr-ci-validate.yaml    # PR -> fmt check, validate (PR Validation CI)
└── terraform
    ├── cloudfront.tf
    ├── outputs.tf
    ├── policy.tf
    ├── provider.tf
    ├── s3.tf
    └── variables.tf
```

## 2-1. PR CI Validation Workflow

![](https://velog.velcdn.com/images/yulmwu/post/9183b6aa-5206-451f-aeaf-c945988d9602/image.png)

PR이 Open 되었을 때 포맷 체크와 Validate를 위한 CI를 구성해보자. 이는 간단하게 구성할 수 있다.

### (1) Trigger

CI 워크플로우의 트리거 조건은 아래와 같이 구성한다.

```yaml
name: Terraform PR Validate

on:
  pull_request:
    types: [opened, synchronize, reopened]
```

### (2) Terraform Setup, Format Check, Validation

아래는 Terraform(v1.5.7 기준) Actions를 사용하여 설치하고 포맷 체크 및 Validate를 수행하는 코드이다.

```yaml
jobs:
  terraform-validate:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: terraform

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.5.7

      - name: Terraform Init
        run: terraform init -input=false

      - name: Terraform Format Check
        run: terraform fmt -check -recursive

      - name: Terraform Validate
        run: terraform validate -input=false
```

만약 포맷이 올바르지 않거나 Validate를 실패하였다면 워크플로우가 실패하게 되어 PR 화면에 실패되었음을 알 수 있게 된다. 이는 나중에 테스트 해보겠다.

## 2-2. Terraform Plan CI

![](https://velog.velcdn.com/images/yulmwu/post/ee67cbdb-c76c-48de-9f26-914657cc2435/image.png)

다음으로 PR이 Merge 되었을 때 Plan을 생성 및 Slack 알림, 그리고 TOCTOU를 방지하기 위해 Artifacts에 업로드 후, 수동(Dispatch)으로 Apply CD Job을 실행한다면 해당 Plan을 기준으로 Apply하는 워크플로우를 작성해보겠다.

### (1) Plan CI — Trigger, Permissions

CI/CD 파이프라인 중 Planning을 담당하는 CI의 트리거 조건은 main Branch에 Push가 되었거나 (같은 레포지토리에서) PR이 왔을 경우이다.

```yaml
# terraform-ci-cd-plan.yaml

name: Terraform CI/CD (Plan)

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main
```

또한 OIDC 토큰을 발급받을 수 있도록 아래와 같이 `id-token` 권한을 write로 설정하자.

```yaml
permissions:
  id-token: write # OIDC 토큰 발급 허용
  contents: read
```

```yaml
jobs:
  terraform-plan:
    if: github.repository == 'yulmwu/terraform-ci-cd-example'
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: terraform
    steps:
      - name: Checkout
        uses: actions/checkout@v4
```

### (2) Plan CI — Configure AWS Credentials (IAM OIDC Assume Role)

이를 위해선 (필요 시) GitHub OIDC Provider를 생성하고 아래의 IAM Policy를 생성해야 한다. (Account ID, 레포지토리 주소 등은 직접 수정해야 한다.)

```shell
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

```yaml
# trust-policy.json

{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::986129558966:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:yulmwu/terraform-ci-cd-example:*"
        }
      }
    }
  ]
}
```

```shell
aws iam create-role \
  --role-name github-actions-terraform \
  --assume-role-policy-document file://trust-policy.json
```

그리고 Terraform에 적용할 역할, 즉 정책을 줘야 한다. 실습에선 모든 권한을 Allow 해도 되지만, 실제 운영 환경에선 제한하는 것이 좋다. 여기선 S3와 CloudFront 리소스에 대한 권한만 주도록 하겠다.

```yaml
# terraform-policy.json

{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3BucketManagement",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:PutBucketPolicy",
        "s3:GetBucketPolicy",
        "s3:PutBucketPublicAccessBlock",
        "s3:GetBucketPublicAccessBlock",
        "s3:PutEncryptionConfiguration",
        "s3:PutBucketOwnershipControls",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::tf-static-site-demo-1213-bucket",
        "arn:aws:s3:::tf-static-site-demo-1213-bucket/*"
      ]
    },
    {
      "Sid": "CloudFrontOAC",
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateOriginAccessControl",
        "cloudfront:GetOriginAccessControl",
        "cloudfront:DeleteOriginAccessControl",
        "cloudfront:UpdateOriginAccessControl",
        "cloudfront:ListOriginAccessControls",
        "cloudfront:CreateDistribution",
        "cloudfront:GetDistribution",
        "cloudfront:UpdateDistribution",
        "cloudfront:DeleteDistribution"
      ],
      "Resource": "*"
    },
    {
      "Sid": "IAMPassRole",
      "Effect": "Allow",
      "Action": [
        "iam:GetRole",
        "iam:PassRole"
      ],
      "Resource": "*"
    }
  ]
}
```

아래와 같이 Policy를 생성하고 `github-actions-terraform` 역할에 Attach 하자.

```shell
aws iam create-policy \
  --policy-name terraform-github-actions-policy \
  --policy-document file://terraform-policy.json
  
aws iam attach-role-policy \
  --role-name github-actions-terraform \
  --policy-arn arn:aws:iam::986129558966:policy/terraform-github-actions-policy
```

이제 Github Actions 워크플로우에서 사용할 수 있는 ARN 형식은 아래와 같다.

```
arn:aws:iam::986129558966:role/github-actions-terraform
```

Actions에선 아래와 같이 AWS 자격 증명을 설정할 수 있다.

```yaml
      - name: Configure AWS Credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::986129558966:role/github-actions-terraform
          aws-region: ap-northeast-2
```

### (3) Plan CI — Terraform Setup, Caching

Terraform Provider(AWS) 관련 파일을 다운받을 때 시간이 걸릴 수 있는데, 이를 아래와 같이 캐싱할 수 있다. 캐싱 키는 모든 Terraform 소스코드(HCL)와 `.terraform.lock.hcl`를 기준으로 한다.

```yaml
      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.5.7

      - name: Cache Terraform Providers
        uses: actions/cache@v4
        with:
          path: terraform/.terraform
          key: ${{ runner.os }}-terraform-${{ hashFiles('terraform/**/*.tf', 'terraform/.terraform.lock.hcl') }}
          restore-keys: |
            ${{ runner.os }}-terraform-

      - name: Terraform Init
        run: terraform init -input=false

      - name: Save commit SHA
        run: echo "${GITHUB_SHA}" > plan.sha
```

추가적으로 필자는 `.terraform.lock.hcl`를 Apply CD에서 사용할 것이기 때문에 소스코드 내 Terraform 관련 파일을 유지하기 위해 현재의 Commit SHA를 따로 저장한다. 이후 Apply CD에서 Checkout 시 해당 커밋을 Checkout 한다.

### (4) Plan CI — Terraform Plan, Artifacts upload

다음은 Terraform Plan을 tfplan 바이너리로 저장하고 Actions Artifacts에 저장하여 CD에서 사용할 수 있도록 한다.

이는 TOCTOU 문제를 방지하기 위함인데, 이러한 방식을 사용하지 않으면 CI에서 Planning된 결과가 CD에서 동일하게 Apply 될 것이라는 보장이 없다.

Apply를 하기 전 까지의 순간에 Terraform 코드에 변동이 있어 동일하게 Apply 되지 못한다는 것인데, 이를 위해 Plan 결과가 저장된 바이너리 파일을 Actions Artifact에 업로드하여 CD 시 동일한 tfplan을 사용하도록 한다. 

추가적으로 만들어두었던 `plan.sha`와 `.terraform.lock.hcl`도 함께 업로드하며, 보존 기간은 7일이다.

```yaml
      - name: Terraform Plan
        run: terraform plan -out=tfplan -input=false -no-color

      - name: Debugging list files
        run: ls -al .

      - name: Upload tfplan artifact
        uses: actions/upload-artifact@v4
        with:
          name: tfplan
          path: |
            terraform/tfplan
            terraform/.terraform.lock.hcl
            terraform/plan.sha
          include-hidden-files: true
          retention-days: 7

```

## 2-3. Terraform Apply CD

![](https://velog.velcdn.com/images/yulmwu/post/204b1646-7a3a-49ce-aece-302a2efb1b45/image.png)

수동으로 워크플로우를 트리거할 수 있도록 아래와 같이 `workflow_dispatch`를 설정해주고, Plan CI 워크플로우의 Run ID를 입력 값으로 받도록 한다. 이는 해당 Run ID의 Artifacts를 가져오기 위함이다.

```yaml
# terraform-ci-cd-apply.yaml

name: Terraform Apply (Approved Plan)

on:
  workflow_dispatch:
    inputs:
      plan_run_id:
        description: "Terraform Plan workflow run_id (approved)"
        required: true
```

권한의 경우 기존과 동일하나, 이전 워크플로우의 Artifacts를 읽기 위해 `actions: read` 권한을 추가해두었다.

```yaml
permissions:
  id-token: write # OIDC 토큰 발급 허용
  contents: read
  actions: read
```

```yaml
jobs:
  terraform-apply:
    runs-on: ubuntu-latest
    environment:
      name: production
    defaults:
      run:
        working-directory: terraform
```

### (1) Apply CD — Download Artifacts, Checkout

다음으로 Plan CI에서 업로드해두었던 tfplan 및 Commit SHA 파일과 Lock 파일을 다운로드 받는다. 이때 Dispatch 입력으로 받았던 Run ID를 지정하고, Github Token을 줘서 다른 워크플로우의 Artifacts에 접근할 수 있도록 한다. 
(참고: [Github: Downloading artifact from different workflow #106300](https://github.com/orgs/community/discussions/106300))

```yaml
    steps: 
      - name: Download tfplan artifact
        uses: actions/download-artifact@v4
        with:
          name: tfplan
          path: /tmp/terraform-artifact
          run-id: ${{ github.event.inputs.plan_run_id }}
          github-token: ${{ github.token }}
```

그리고 Commit SHA를 바탕으로 해당 커밋을 Checkout 한다. 

```yaml
      - name: Read planned commit SHA
        id: planmeta
        run: echo "sha=$(cat /tmp/terraform-artifact/plan.sha)" >> $GITHUB_OUTPUT
        working-directory: /

      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ steps.planmeta.outputs.sha }}
```

여기까지 완료되었다면 Artifacts를 원래의 `working-directory`로 옮겨두도록 하자. 방금은 Checkout 전 Commit SHA를 설정하기 위해 `working-directory: /`을 통해 덮어쓰고 `/tmp`에 Artifacts가 저장되도록 하였다.

```yaml
      - name: Move artifacts to working directory
        run: |
          cp -a /tmp/terraform-artifact/. .

      - name: Verify plan exists
        run: |
          ls -al .
          test -f tfplan
          test -f .terraform.lock.hcl
```

추가적으로 디버깅 및 검증을 위한 과정도 추가해두었다. (`ls`, `test`)

### (2) Apply CD — Configure AWS Credentials (IAM OIDC Assume Role)

여기선 동일한 IAM 역할을 사용하도록 하였기 때문에 독같이 작성하였지만, CI에선 Read 권한만, CD에선 Read/Write 권한을 줘서 더욱 더 보안에 신경쓸 수 있을 것이다. 

```yaml
      - name: Configure AWS Credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::986129558966:role/github-actions-terraform
          aws-region: ap-northeast-2  
```

### (3) Apply CD — Terraform Setup, Caching

이 과정 또한 Plan CI와 동일하지만, 다만 Terraform Init 시 Lock 파일을 고정하도록 옵션을 주었다. (Plan CI Artifacts의 `.terrform.lock.hcl` 사용)

```yaml
      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.5.7

      - name: Cache Terraform Providers
        uses: actions/cache@v4
        with:
          path: terraform/.terraform
          key: ${{ runner.os }}-terraform-${{ hashFiles('terraform/**/*.tf', 'terraform/.terraform.lock.hcl') }}
          restore-keys: |
            ${{ runner.os }}-terraform-

      - name: Terraform Init
        run: terraform init -input=false -lockfile=readonly
```

### (4) Apply CD — Terraform Apply, Slack Notification

이제 Terraform Apply(Plan CI Artifacts의 `tfplan` 사용)를 시도하고 결과를 저장한다.

```yaml
      - name: Terraform Apply (Approved Plan)
        run: terraform apply -auto-approve tfplan
        
      - name: Terraform Outputs
        run: terraform output -json > tf-outputs.json
```

마지막으로 결과를 Slack Webhook으로 전송한다. (Actions를 사용해도 되겠지만 직접 POST 요청을 보내도록 하였다.)

이때 `if: success()`나 `if: failure()`를 줘서 워크플로우의 결과에 따라 다르게 보내지도록 하였다. 메시지의 내용은 적당히 수정해도 좋다.

```yaml
      - name: Slack Notify (Apply)
        if: success()
        continue-on-error: true
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: |
          curl -X POST -H 'Content-type: application/json' \
            --data "{
              \"text\": \"*Terraform Apply Completed*\nRepo: ${GITHUB_REPOSITORY}\nCommit: ${GITHUB_SHA}\nOutputs: \n\`\`\`$(cat tf-outputs.json)\`\`\`"
            }" \
            $SLACK_WEBHOOK_URL

      - name: Slack Notify (Apply Failed)
        if: failure()
        continue-on-error: true
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: |
          curl -X POST -H 'Content-type: application/json' \
            --data "{
              \"text\": \"*Terraform Apply Failed*\nCheck GitHub Actions logs.\"
            }" \
            $SLACK_WEBHOOK_URL
```

이제 CI/CD 파이프라인을 모두 작성하였으니 Github 레포지토리를 만들어보자. 이후 원본에 대한 Fork를 생성하여 PR을 테스트해보고, Plan/Apply CI/CD 까지 동작하는지 확인해보겠다.

# 3. Demo — Github Repository

원본 레포지토리(필자 기준 `yulmwu/terraform-ci-cd-example`)를 아래와 같이 만들고 커밋, Push 해주자. 이때 CD 워크플로우가 실행될 수 있는데 아직 Artifacts가 없어 에러가 날 것이다. 그 전에 워크플로우를 취소해도 된다.

![](https://velog.velcdn.com/images/yulmwu/post/64f6256c-fc91-43d6-8119-e34108eaa6ff/image.png)

그리고 이에 대한 Fork 레포지토리를 생성하자. 레포지토리 이름은 `eocndp/terraform-ci-cd-example-fork`이다.

![](https://velog.velcdn.com/images/yulmwu/post/a5787b7a-4da8-4c6e-b74c-d7f7f10b73fc/image.png)

기본적으로 Forked 레포지토리에선 Actions가 비활성화 되어있다. 만약 활성화를 해야한다면 워크플로우에 조건을 두는 등 적당한 조치를 하도록 하자.

다음으로 원본 레포지토리의 Secrets에 `SLACK_WEBHOOK_URL`을 넣어줘야 하는데, Slack Webhook 발급 과정은 따로 설명하지 않겠다. 아래와 같이 `incoming-webhook` 앱을 찾으면 된다.

![](https://velog.velcdn.com/images/yulmwu/post/cad5fc93-1950-413a-a5fa-cb2c7c48c65d/image.png)

이제 원본 레포지토리 설정에서 해당 Webhook URL을 넣어주면 된다.

![](https://velog.velcdn.com/images/yulmwu/post/f2ad6494-6c51-4670-b7c3-c47068d8177e/image.png)

# 4. Demo — Testing

이제 Fork 레포지토리의 소스코드를 살짝 수정하고 원본 레포지토리로 PR을 날려보자. 

![](https://velog.velcdn.com/images/yulmwu/post/822ca812-7f79-4341-9391-e555c56820c4/image.png)

살짝 기다리면 아래와 같이 PR Validation CI가 실행되고, 문제가 없다면 Pass되는 것을 확인해볼 수 있다. 

![](https://velog.velcdn.com/images/yulmwu/post/54c40a4e-30ae-4925-b4a6-e6aaa034180a/image.png)

만약 의도적으로 포맷팅에 문제를 발생시키고 PR을 날리면 어떻게 될까?

![](https://velog.velcdn.com/images/yulmwu/post/9b18a86a-8e88-4eee-bdd2-b3ab78faf280/image.png)


![](https://velog.velcdn.com/images/yulmwu/post/002e0f99-7ade-49ab-9f52-51adf08224d7/image.png)

그럼 위와 같이 CI가 실패되었다고 확인해볼 수 있다. 포맷팅을 정상적으로 완료했다고 치고, PR을 Merge 해보자. 그러면 아래와 같이 Plan CI가 실행되는 것을 확인해볼 수 있다.

![](https://velog.velcdn.com/images/yulmwu/post/4df8f56b-2738-40ec-b298-d0763d3a034c/image.png)

![](https://velog.velcdn.com/images/yulmwu/post/b3a7d016-4140-47b1-826f-434949d3a35f/image.png)

Artifacts 또한 정상적으로 생성되었고, 이제 해당 워크플로우의 Run ID를 복사하여 "Terraform Apply (Approved Plan)"에서 수동으로 Apply CD를 실행시켜보자.

![](https://velog.velcdn.com/images/yulmwu/post/e4f6fad3-76d7-4dc9-8d88-2532c25e99eb/image.png)

성공적으로 실행이 되었다면 아래와 같이 표시될 것이다.

![](https://velog.velcdn.com/images/yulmwu/post/907a96e2-3351-4fe3-b741-42e3d3769362/image.png)

여기서 "Terraform Apply (Approved Plan)" Job을 클릭해보자.

![](https://velog.velcdn.com/images/yulmwu/post/444dc1d0-98a1-4e0c-8957-2a413ae4ca86/image.png)

그럼 위와 같이 잘 Apply 된 것을 확인해볼 수 있다. 마찬가지로 Slack에서도 정상적으로 메시지가 온 것을 확인해볼 수 있다. (이전에 찍어둔 스크린샷이라 살짝 다를 수 있다.)

![](https://velog.velcdn.com/images/yulmwu/post/346c281b-f9ef-46ce-8725-5f17414fb95c/image.png)

아래의 명령어를 통해 S3 버킷에 `index.html`을 업로드하고 CloudFront 주소로 접속해보자. 

```shell
echo "<h1>Testing</h1>" > ./index.html
aws s3 cp ./index.html s3://$(terraform output -raw s3_bucket_name)/index.html
```

![](https://velog.velcdn.com/images/yulmwu/post/3cbe0fc0-2c94-4bad-96db-1c4a67c9149c/image.png)

Terraform을 통해 S3 + CloudFront 및 OAC를 구성하였기 때문에 바로 접속이 되는 것을 확인해볼 수 있다.

---

이로써 Github Actions를 통해 간단하게 Terrform CI/CD 파이프라인을 구축해보았다. 물론 Atlantis 등을 사용하는 것이 Terraform CI/CD 파이프라인을 구성하는 (사실상) 표준적인 솔루션이지만, 맛보기 형태로 Github Actions로만 구성을 해보았다.

다음 포스팅에선 Atlantis를 통한 Terraform CI/CD 파이프라인을 구축해보는 실습을 진행해보겠다.
