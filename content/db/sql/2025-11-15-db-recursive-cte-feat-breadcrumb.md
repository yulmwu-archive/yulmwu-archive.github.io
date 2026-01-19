---
title: '[DB/SQL] Recursive CTE(Common Table Expression)을 통한 N+1 문제 개선해보기'
description: 'Recursive CTE를 통해 Directory Breadcrumb를 구현하면서 Depth 만큼의 N+1 문제 해결해보기'
slug: '2025-11-15-db-recursive-cte-feat-breadcrumb'
author: yulmwu
date: 2025-11-15T11:08:28.310Z
updated_at: 2026-01-18T16:23:44.354Z
categories: ['DB/SQL']
tags: ['PostgreSQL', 'db', 'sql', 'typeOrm']
series:
    name: DB/SQL
    slug: database
thumbnail: ../../thumbnails/db/sql/db-recursive-cte-feat-breadcrumb.png
linked_posts:
    previous:
    next:
is_private: false
---

# 0. Overview

추운 겨울이 다가오기 시작하면서 집에 있는 시간이 많아진 것 같다.

요즘들어 필자의 라이프 사이클은 "기상 → 스타듀밸리 → 점심 → 공부 → 외출 → 저녁 → 스타듀밸리 → 잠"으로 굉장히 나태해진 것 같아, 어떤 프로젝트라도 틈틈이 해보자고 생각하였고..

그래서 지난 여름방학 시즌 묵혀두었던 프로젝트 코드베이스를 바탕으로, AWS S3를 기반으로 한 STaaS(Storage as a Service) 스토리지 서비스를 제작하기에 들어섰다.

![](https://velog.velcdn.com/images/yulmwu/post/28cf2567-d8e9-4f44-a184-6bb946bd96cd/image.png)

---

서론이 길어지는데, 아무튼 S3 버킷은 오브젝트를 플랫하게(단일 레이어) 저장하기 때문에 디렉토리 내 파일 조회 등이 불가능하다.

때문에 아래와 같은 DB 스키마를 만들어 사용자가 파일을 업로드하거나 디렉토리를 만들면 DB에 메타데이터 형태로 저장되도록 고안하였다.

![](https://velog.velcdn.com/images/yulmwu/post/46331c60-c71b-4d77-9259-e9e896faf1ac/image.png)

파일이나 디렉토리(이하 오브젝트) 모두 File 엔티티를 사용하도록 하고, `type` 컬럼을 통해 구분하도록 한다.

이때 `parentId` 컬럼을 통해 부모 요소, 즉 상위 디렉토리와 Self Referential ManyToOne 관계를 갖는다. 여기까진 문제가 없었으나...

# 1. Breadcrumb ..?

![](https://velog.velcdn.com/images/yulmwu/post/3e97f1cc-4abc-4db3-8b62-1982c0ca9989/image.jpg)

_(사진 허락 받음)_

여러 의견을 받았으나, 그 중 필자의 눈에 들어온건 브레드크럼(Breadcrumb)를 구현해달라는 의견이였다.

필자도 그게 뭔지 몰랐는데, 쉽게 말해서 웹 사이트나 애플리케이션에서 사용자의 현재 위치(이동 경로)를 나타내는 것이라고 한다.

어렵게 생각할 필요도 없이

![](https://velog.velcdn.com/images/yulmwu/post/c0133cf4-78a2-436f-bd29-6fd298c8bde8/image.png)

이걸 말하는 것이다.

# 2. First Attempt — while

단순히 텍스트 디스플레이용이라면 `path` 컬럼을 split하여 적절히 사용하면 되겠지만, 페이지(경로) 이동을 위해 UUID가 필요하기 때문에 API를 따로 구현하도록 하였다.

먼저 처음엔 프로토타입 구현을 위해 while 문을 통해 루트 디렉토리 까지의 상위 디렉토리들을 구하는 코드를 작성하였다.

_(블로그 예시를 위해 비즈니스 로직과 API를 따로 분리해두었으나, 이후 디렉토리 조회 API와 통합하였다.)_

```ts
async getBreadcrumb(uuid: string, userId: number): Promise<FileResponseDto[]> {
    const file = await this.getFileByUuid(uuid, userId)

    if (file.type !== FileType.DIRECTORY) {
        throw new BadRequestException('Breadcrumb is only available for directories')
    }

    const breadcrumb: FileResponseDto[] = []
    let current: FileResponseDto | null = file

    while (current) {
        breadcrumb.push(current)

        if (!current.parentId) break

        const parent = await this.fileRepo.findOne({
            where: { id: current.parentId, userId },
        })

        if (!parent) break

        current = parent
    }

    return breadcrumb.reverse()
}
```

이걸 작성할 때 디스코드 화면 공유를 키면서 작성했었는데..

![](https://velog.velcdn.com/images/yulmwu/post/c843c95b-417a-49f0-9d9f-541cf9f709c1/image.png)

로직은 현재 디렉토리를 기준으로 하여 부모 디렉토리를 가져오고(findOne), 또 부모 요소의 부모 요소.. 이걸 부모 요소가 없을 때 까지 반복한다.

즉 상당히 비효율적인, Depth 만큼의 N+1 문제가 발생하고 DB 쿼리나 네트워크 면에서도 매우 비효율적으로 동작한다.

사실 UI 테스트를 위해 간단하게 제작된 비즈니스 로직이였던터라.. 아래와 같이 UI를 구현하는게 주된 목적이였다.

![](https://velog.velcdn.com/images/yulmwu/post/e27df7a3-8248-41c5-bb63-be4d6441c1ea/image.png)

# 3. Second Attempt — Recursive CTE

최적화를 강조해왔던 필자로써 절대 참을 수 없는 문제라서 바로 해결 방법을 찾았다.

Nested Set이나 Closure Table 등 다른 방법이 있을 수 있겠지만, 필자는 크게 2가지를 생각하였다.

- Materialized Path
- Recursive CTE(Common Table Expression)

먼저 Materialized Path는 계층 구조를 DB에 저장하는 방법 중 하나인데, 시작 노드 부터 끝의 노드까지 전체 경로를 문자열로 저장한다.

예를 들어 필자의 상황이라면 `uuidPath`와 같은 컬럼을 추가하고
`/6c7d457a-fe2a-45fd-bbec-fb57c058ddfe/acb2610d-e73f-4240-b01b-aa98d15e608c/...`

위 형식과 같은 형태로 저장한다. 스토리지의 용량이 커질 순 있겠지만 SSD 기반의 DB 서버라면 큰 문제가 되진 않을 것이다.

문제라면 상위 디렉토리의 경로가 이동되었을 때 하위 모든 오브젝트의 `uuidPath`를 변경해야 한다는 점, 또한 기존 DB를 마이그레이션해야 한다는 점에서도 귀찮을 따름이다.

---

필자는 DB 스키마를 변경하고 싶지 않았기 때문에 재귀적으로 상위 디렉토리들을 조회하도록 했으면 했고, 여기서 WITH RECURSIVE 절을 사용해보기로 했다.

## 3-1. SQL — WITH

먼저 WITH 절이 무엇인지 부터 알고 넘어가자. SQL에서 WITH 절은 **CTE, Common Table Expression**를 정의하는 문법이다.

쉽게 설명한다면 쿼리 안에서 임시 테이블을 만들고 재사용할 수 있는 구조인데, 아래와 같은 예제를 살펴보자.

```sql
SELECT name
FROM Employee
WHERE salary > (SELECT AVG(salary) FROM Employee);
```

위 SQL은 서브 쿼리를 통해 급여가 평균 이상인 직원을 가져오는 쿼리이다. 그런데 만약 "급여가 평균 이상이면서 보너스가 평균 이상"인 직원을 찾는 쿼리는 어떻게 작성해야 할까?

```sql
SELECT name
FROM Employee
WHERE salary > (SELECT AVG(salary) FROM Employee)
  AND bonus  > (SELECT AVG(bonus)  FROM Employee);
```

그럼 위와 같이 비슷한 코드를 여러번 작성해야 한다. 개발자는 이렇게 반복되는 구문이나 코드를 싫어하고 싫어해야 하기 때문에, SQL에선 **WITH**을 통해 임시 테이블, 즉 **CTE**을 정의할 수 있다.

```sql
WITH cte_name [(column1, column2, ...)] AS (
    -- CTE 내부 쿼리
    SELECT ...
    FROM ...
    WHERE ...
)
SELECT ...
FROM cte_name
WHERE ...;
```

_(`[(column1, column2, ...)]`은 CTE에서 반환될 컬럼 명으로, 생략할 수 있다.)_

이를 방금 설명했던 SQL 쿼리에 적용하면 아래와 같다.

```sql
WITH AvgValues AS (
    SELECT AVG(salary) AS avg_salary,
           AVG(bonus)  AS avg_bonus
    FROM Employee
)
SELECT e.name
FROM Employee e
JOIN AvgValues a
  ON e.salary > a.avg_salary
 AND e.bonus  > a.avg_bonus;
```

이렇게 임시적인 테이블을 만들어 가독성과 서브 쿼리의 중복 제거, 유지 보수의 편리성 등을 보장할 수 있다.

## 3-2. SQL — WITH RECURSIVE

그런데 이러한 CTE에 재미있는 기능을 만들어뒀는데, 바로 CTE 내부의 쿼리에서 자기 자신의 CTE를 사용하는, 즉 자기 자신을 참조할 수 있는 재귀적인 구문인 **WITH RECURSIVE**를 만들어 뒀다는 것이다.

문법은 아래와 같다.

```sql
WITH RECURSIVE cte_name AS (
    -- Anchor Member (기본값)
    SELECT ...
    FROM table_name
    WHERE ...

	-- 중복을 제거하지 않고 모두 합침
    UNION ALL

    -- Recursive Member (재귀 참조)
    SELECT ...
    FROM table_name t
    JOIN cte_name c ON t.parent_id = c.id
)
SELECT ...
FROM cte_name
WHERE ...;
```

먼저 Anchor Member에서 Recursive CTE의 기본 값을 정의한다. Employee 예시는 이제 잊어버리고 디렉토리 트리 구조로 돌아와, Anchor Member엔 현재 오브젝트를 찾는 쿼리를 넣으면 된다.

```sql
WITH RECURSIVE parent_chain AS (
    SELECT id, uuid, name, type, "s3Key", "mimeType", size, path, "parentId", "userId", "createdAt", "updatedAt"
    FROM files
    WHERE id = $1 AND "userId" = $2 -- [file.id, userId]

    UNION ALL

... (TODO)
```

그리고 두번째 Recursive Member엔 자기 자신의 CTE를 참조하는, 계층을 따라 반복적으로 탐색하는 쿼리를 작성한다.

이때 부모 요소와 JOIN하고, JOIN 결과가 없다면 재귀가 종료되어 반환된다.

즉 다음 탐색에서 이전의 Recursive Member의 값이 Anchor Member 값으로 들어가는 구조로, Anchor → Recursive → Recursive ...를 반복한다.

최종적으로 구현된 비즈니스 로직은 아래와 같다.

```ts
async getBreadcrumb(uuid: string, userId: number): Promise<FileResponseDto[]> {
    const file = await this.getFileByUuid(uuid, userId)

    if (file.type !== FileType.DIRECTORY) {
        throw new BadRequestException('Breadcrumb is only available for directories')
    }

    const breadcrumb = await this.fileRepo.query(
        `
        WITH RECURSIVE parent_chain AS (
            SELECT id, uuid, name, type, "s3Key", "mimeType", size, path, "parentId", "userId", "createdAt", "updatedAt"
            FROM files
            WHERE id = $1 AND "userId" = $2

            UNION ALL

            SELECT f.id, f.uuid, f.name, f.type, f."s3Key", f."mimeType", f.size, f.path, f."parentId", f."userId", f."createdAt", f."updatedAt"
            FROM files f
            INNER JOIN parent_chain pc ON f.id = pc."parentId"
            WHERE f."userId" = $2
        )
        SELECT * FROM parent_chain
        ORDER BY path, name
        `,
        [file.id, userId],
    )

    return breadcrumb
}
```

TypeORM에서 Recursive CTE를 위한 빌트인 메서드를 공식적으로 지원하진 않는 것 같아 Raw SQL을 작성하였다. 마지막으로 `path` + `name`을 기준으로 정렬을 하도록 하면 비즈니스 로직 구현을 완료하였다.

## 3-3. SQL Query Speed Comparison

다음으로 벤치마크를 테스트 해보았다. 비교 대상은 이 전의 N+1 문제가 있는 로직과 Recursive CTE를 사용한 로직을 비교하였고, 깊이가 있는 디렉토리 구조에 API의 응답 시간을 체크하는 방식으로 테스트하였다.

먼저 기존의 방식인 Depth 만큼의 N+1개의 SQL 쿼리를 통해 상위 디렉토리를 조회했을 때 응답 속도이다. (200 depth)

```shell
registering user: bench_8b918562ae93
logging in
creating directory chain depth=200
created 50/200 directories: 03a82aae-c8ef-4e47-b229-b7bbc52ee842
created 100/200 directories: 0fcab696-8b6d-41c6-9a5f-81f90838f304
created 150/200 directories: 0928bd3a-0fb0-42e8-a8a3-06873b73b458
created 200/200 directories: a826e31f-36d0-4ddb-a44a-a19d6f8f6c1e
warming up breadcrumb
measuring breadcrumb for uuid=a826e31f-36d0-4ddb-a44a-a19d6f8f6c1e
first_call_ms=71.32
avg_ms=49.03
p95_ms=54.31
```

쿼리가 많은 편이 아닌지라 빠르다고 느껴질 수 있겠지만, 아래의 Recursive CTE로 개선된 쿼리의 결과를 보면 말이 달라질 것이다.

```shell
registering user: bench_8a8b5c3988d9
logging in
creating directory chain depth=200
created 50/200 directories: 6f7ea72b-e9a0-4d50-a217-a4f54e35079b
created 100/200 directories: 8adeea45-67c2-4ef3-a289-12b60dde0b8d
created 150/200 directories: baa91a99-f4aa-4dc4-a3eb-9a92f56b7f44
created 200/200 directories: aa318211-dd43-41a0-8872-0fbebc9b95b6
warming up breadcrumb
measuring breadcrumb for uuid=aa318211-dd43-41a0-8872-0fbebc9b95b6
first_call_ms=9.87
avg_ms=10.02
p95_ms=10.61
```

단순히 봐도 5배 가량 빨라진 것을 볼 수 있으며, 심지어 네트워크 접근 또한 200번이 아닌 1번의 접근으로 쿼리 실행이 가능하기 때문에 안 쓸 이유가 전혀 없다.

DBMS 내부적으로 Recursive CTE를 최적화한다고 하는데, 그건 따로 찾아보시길 바란다.

추가적으로 Redis와 같은 인메모리 DB를 활용하여 결과를 캐싱한다면 더욱 더 빨라진 벤치마킹 성능을 볼 수 있다.

```ts
async getBreadcrumb(uuid: string, userId: number): Promise<FileResponseDto[]> {
    const cacheKey = `breadcrumb:${userId}:${uuid}`
    const cached = await this.redisService.get(cacheKey)

    if (cached) {
        return JSON.parse(cached)
    }

	// ... (중략)

	await this.redisService.set(cacheKey, JSON.stringify(breadcrumb), 3600)

	return breadcrumb
}
```

```shell
registering user: bench_f0708da9d46a
logging in
creating directory chain depth=200
created 50/200 directories: c6583aa1-f74f-443b-84c7-c04410eeb986
created 100/200 directories: 5401b374-5096-405a-88f1-6b0a290caae4
created 150/200 directories: 24335173-7a0b-4f3b-bf14-1a6d47311e8a
created 200/200 directories: 37cdbe4b-5836-4134-9575-a9b2f65acd58
warming up breadcrumb
measuring breadcrumb for uuid=37cdbe4b-5836-4134-9575-a9b2f65acd58
first_call_ms=6.18
avg_ms=4.91
p95_ms=5.42
```

자세한 소스 코드는 [깃허브 레포지토리](https://github.com/yulmwu/als3)를 참고하면 좋을 듯 하다.

---

추가적으로 파일/디렉토리 삭제 로직에서도 디렉토리 내 여러 파일(S3 키)을 가져오기 위해 아래와 같은 Recursive CTE SQL을 작성하였다.

```sql
WITH RECURSIVE descendants AS (
    SELECT id, "parentId", type, "s3Key", "userId"
    FROM files
    WHERE id = $1 AND "userId" = $2  -- [file.id, userId]

    UNION ALL

    SELECT f.id, f."parentId", f.type, f."s3Key", f."userId"
    FROM files f
    INNER JOIN descendants d ON f."parentId" = d.id
    WHERE f."userId" = $2
)
SELECT "s3Key" FROM descendants WHERE type = 'file' AND "s3Key" IS NOT NULL
```

# 4. A better way?: Materialized Path

사실 필자의 상황에선 Materialized Path를 사용하는 것이 더 나은 선택일 수 있다.

필요한 값이 오브젝트(상위 디렉토리)의 UUID 밖에 없고, 이러한 경우 `/UUID1/UUID2/...`와 같은 Materialized Path를 추가적으로 삽입하고, 실제 경로(`/A/B/C/...` = `path`)와 UUID 경로(`uuidPath`)가 제공되니 프론트엔드에선 이를 Split 하여 Breadcrumb를 구현할 수 있다.

다만 상위 디렉토리의 경로 이동이 발생될 경우 하위 오브젝트들의 모든 `uuidPath`를 업데이트해야 하는데, 필자는 이 경우의 오버헤드를 생각하여 Recursive CTE 방식을 선택하였다.
(오브젝트의 UUID는 고정된 값이니 상위 디렉토리의 이름 변경엔 문제가 없다.)

---

처음엔 "애초에 Breadcrumb API와 List DIR API에서 UUID 기반이 아닌 경로 기반으로 하면 되지 않을까?" 라고 생각하긴 했었다.

그런데 그럴 경우 이동/이름 변경 시 레이스 컨디션, 유효성 확인 등 추후 API 설계에서 있어 안전한 Primary Identifier인 UUID 기반보다 이점이 없을 것 같아 도입하지 않았다.

추후 API 설계에 있어 미리 고민을 좀 해봐야 할 주제긴 한데, 아마 UUID 방식이 최선의 선택이지 않을까 싶다.

혹시 피드백이나 "~~해보면 더 좋을 것 같아요" 라는 의견이 있다면 언제든 감사히 받겠다.
