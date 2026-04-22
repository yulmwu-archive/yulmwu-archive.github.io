---
title: "[Development] Remote Docker로 Go testcontainers(PostgreSQL) 리소스 쌀먹하기"
description: "Remote Docker로 M1 + 8GB 깡통 MacBook Pro에서 원활한 개발 환경 구축하기 (Cloudflare ZTNA Tunnel + WARP)"
slug: "2026-04-22-development-remote-docker"
author: yulmwu
date: 2026-04-22T01:54:34.258Z
updated_at: 2026-04-22T09:30:48.684Z
categories: ["Development"]
tags: ["development", "docker"]
series:
  name: Development
  slug: development
thumbnail: https://mirror-cdn.swua.kr/thumbnails/development/development-remote-docker_960x540.png
linked_posts:
  previous: 2026-04-21-development-mitigating-thundering-herd-with-redis
  next: 
is_private: false
---

# 0. Overview

> 이 포스팅에선 Cloudflare Cloudflare ZTNA Tunnel 및 WARP 구성에 대해선 다루지 않는다. 이 내용에 내해선 전작 포스팅을 참고하자.
> 
> - https://articles.swua.kr/cloudflare/2026-04-15-cloudflare-zero-trust-ssh

최근 필자가 집에서 굴러다니는 데스크탑에 Windows를 날리고 Ubuntu Desktop을 설정해두었다. 가장 큰 이유가 필자가 사용하는 노트북 성능이 그리 좋지 않기 때문이다. 

_구매 당시 간단한 작업을 염두하고 M1 8GB RAM 깡통의 MacBook Pro를 구입하였기 때문인데, 지금와서 생각해보면 16GB RAM으로 구입하지 않은 것이 매우 후회된다.._

로컬에서 개발을 하다보면 어쩔 수 없이 Docker를 비롯한 컨테이너를 사용할 수 밖에 없는데, 이 경우 애플 실리콘(M1, ARM64)이기 때문에 HyperKit이나 Qemu/KVM과 같은 VM이 추가적으로 필요할 수 밖에 없다. 

![](https://mirror-cdn.swua.kr/images/development/2026-04-21-development-remote-docker/b4c3da51-be0c-45e0-b114-22244fb1a4ae.png)

필자의 경험상 원활하게 Docker Desktop을 사용하려면 최소한 1GB - 2GB 정도여야 하는데, 8GB RAM으로는 도저히 버티기가 어려웠다. 간단하게 생각해봐도 Go 서버 2대 + React/NextJS + LSP(Go/...) + IDE + 많은 Chrome 탭들을 동시에 켜두긴 어려울 것이다.

때문에 필자가 결정했던 것이 위 포스팅에서 알 수 있듯, Ubuntu를 설치하고 Cloudflare ZTNA(Zero Trust Network Access) Tunnel 및 WARP 구성을 통해 안전하게 접근하도록 한 것이다.

![](https://mirror-cdn.swua.kr/images/development/2026-04-21-development-remote-docker/2c595c76-323e-4c49-840e-478d1c67d5c4.png)

이제 네트워크 설정이 끝났으니 Remote Docker를 구성해보겠다. 필자는 미리 Ubuntu에 Docker를 설치해뒀으니 설치 과정은 생략하겠다.

> Ubuntu Desktop을 설치했지만 필자와 같이 SSH 환경을 주로 사용한다면, 아래의 명령어를 통해 부팅 타겟을 텍스트(터미널) 모드로 구성하면 된다.
> 
> ```shell
> sudo systemctl set-default multi-user.target
> ```
> 
> 다시 복구하고 싶다면 `graphical.target`으로 구성하고 재부팅하면 된다. 또는 터미널 모드에서 `startx` 명령어를 통해 그래픽 모드로 전환할 수 있다.

# 1. Remote Docker Configuration

먼저 원격으로 Docker Daemon에 접근하는 방법은 크게 2가지가 있을 것이다. 하나는 기본적으로 동작하는 SSH 포워딩(터널링)을 사용하는 것이다.

```shell
export DOCKER_HOST=ssh://user@10.10.0.1
```

Docker CLI에서 이를 지원하기 때문에 아래와 같이 잘 동작하는 것을 확인해볼 수 있다.

```shell
> export DOCKER_HOST=ssh://user@10.10.0.1

> docker ps
CONTAINER ID   IMAGE                  COMMAND                  CREATED        STATUS          PORTS                                         NAMES
111ee7d9f88d   kindest/node:v1.32.0   "/usr/local/bin/entr…"   24 hours ago   Up 52 minutes                                                 dev-worker2
9b5410e13d6d   kindest/node:v1.32.0   "/usr/local/bin/entr…"   24 hours ago   Up 52 minutes                                                 dev-worker
e2f6aa2daf4c   kindest/node:v1.32.0   "/usr/local/bin/entr…"   24 hours ago   Up 52 minutes   0.0.0.0:6443->6443/tcp                        dev-control-plane
180172f90dcc   postgres:16            "docker-entrypoint.s…"   24 hours ago   Up 52 minutes   0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp   local-postgres
ad29f2d5778d   redis:7                "docker-entrypoint.s…"   24 hours ago   Up 52 minutes   0.0.0.0:6379->6379/tcp, [::]:6379->6379/tcp   local-redis
```

하지만 필자가 아래에서 사용하는 Testcontainers 환경에선 SSH 터널링을 위한 SSH 프로토콜을 지원하지 않아 이는 사용할 수 없다.

```shell
> go test -v -count=1 ./internal/http/integration
panic: check host "ssh://user@10.10.0.1": docker info: error during connect: Get "http://user%4010.10.0.1/v1.51/info": dial tcp: lookup user@10.10.0.1: no such host
        rootless Docker not found
...
```

때문에 SSH 터널링이 아닌 직접 TCP를 노출시키는 방법을 사용하였다. Docker 소켓은 2375 또는 2376 포트를 사용한다. 전자는 암호화되지 않았고, 후자는 TLS 암호화를 사용한다.

> Docker 소켓(TCP)을 직접적으로 노출시킨다는 것은 해당 서버의 루트 권한을 외부에 그대로 공개한다는 의미가 된다. 때문에 아예 권장하지 않거나 TLS 암호화를 걸어두는 것을 추천한다.
> 
> 필자의 경우 Cloudflare ZTNA(Zero Trust Network Access)를 통해 신뢰된 네트워크 안에서 안전하게 접근하기 때문에 큰 문제가 없지만, 다시 한번 주의해야 한다.

일반적으로 Docker Daemon 구성 파일은 아래에 위치한다. 처음 구성한다면 아예 없을 수 있는데, 그럼 만들면 된다.

```shell
vi /etc/docker/daemon.json
```

그리고 아래의 구성을 추가하고 저장한다.

```js
{
  "hosts": ["unix:///var/run/docker.sock", "tcp://0.0.0.0:2375"]
}
```

다만 이 구성 파일은 Docker Daemon이 기본적으로 읽지 않는데, systemd 서비스 정의를 수정해야 한다.

```shell
sudo systemctl edit docker
```

위 명령어를 입력하고 편집기로 확인해본다면 기본적으로 아래와 같은 구성이 보일 것이다. (주석 처리가 되어있지만 기본값이라는 의미이다.)

```
# ExecStart=/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock
```

systemd 환경에서 dockerd가 `-H fd://` 옵션으로 실행되면 systemd가 전달한 파일 디스크립터 기반 소켓만 사용하게 되어, `daemon.json`의 `hosts` 설정이 무시되고 추가적인 TCP 리스너가 생성되지 않는다.

때문에 아래와 같이 오버라이드해야 정상적으로 구성 파일이 읽히고 TCP 리스너가 생성된다.

```
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd

# ExecStart=/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock
```

저장을 하고 아래의 명령어로 Docker Daemon을 재시작해주면 된다.

```shell
sudo systemctl daemon-reexec
sudo systemctl daemon-reload
sudo systemctl restart docker
```

![](https://mirror-cdn.swua.kr/images/development/2026-04-21-development-remote-docker/76e9b09c-afe6-4c92-bf48-f8fe10b7d42e.png)

`ss -tlnp | grep 2375`로 리스너가 생성되었는지 확인해보자. `*`는 `0.0.0.0`을 의미하니 잘 적용된 것을 볼 수 있다.

이제 로컬 환경에서 `docker -H tcp://10.10.0.1:2375 ps` 명령어를 통해 실행해보자. (필자는 해당 프라이빗 IP로 ZTNA 구성을 했지만, 접근할 수 있는 인터페이스의 IP이면 된다.)

![](https://mirror-cdn.swua.kr/images/development/2026-04-21-development-remote-docker/5a7336da-dc84-438e-8370-6e07344b620e.png)

하지만 늘 이렇게 `-H`(호스트) 옵션을 주기엔 귀찮고, 아래의 Testcontainers 구성에서 어려움이 있으니 `DOCKER_HOST` 환경 변수를 지정하도록 한다. (`.bashrc` 또는 `.zshrc` 등에 넣고 쓰면 된다.)

```shell
export DOCKER_HOST=tcp://10.10.0.1:2375
```

이제 SSH 터널링이 아닌 직접 TCP 접근이 가능해진다. 이 상태에서 `docker ps` 따위의 명령어가 잘 동작해야 한다.

![](https://mirror-cdn.swua.kr/images/development/2026-04-21-development-remote-docker/4b61f599-c1a2-49b8-86d3-490a41b60bc6.png)

# 2. Testcontainers in Go

Testcontainers는 Docker 컨테이너를 사용하여 DB, 메시지 브로커 등 외부 컨테이너를 가볍게 통합 테스트할 수 있도록 하는 라이브러리이다. Java 뿐만 아니라 Python, NodeJS, Go 언어 등 다양한 언어를 지원하며 필자는 주로 테스트 코드 작성시 DB 컨테이너를 띄우기 위해 사용한다.

설명과 같이 Docker를 사용하며, 필자는 아까 Remote Docker를 구성하였기 때문에 큰 어려움 없이 사용할 수 있다.

```go
package repo

import (
	"context"
	"time"

	"wargame/internal/config"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

func startPostgres(ctx context.Context) (testcontainers.Container, config.DBConfig, error) {
	req := testcontainers.ContainerRequest{
		Image:        "postgres:16-alpine",
		ExposedPorts: []string{"5432/tcp"},
		Env: map[string]string{
			"POSTGRES_USER":     "wargame",
			"POSTGRES_PASSWORD": "wargame",
			"POSTGRES_DB":       "wargame_test",
		},
		WaitingFor: wait.ForAll(
			wait.ForListeningPort("5432/tcp"),
			wait.ForLog("database system is ready to accept connections"),
		),
	}

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		return nil, config.DBConfig{}, err
	}

	host, err := container.Host(ctx)
	if err != nil {
		_ = container.Terminate(ctx)
		return nil, config.DBConfig{}, err
	}

	port, err := container.MappedPort(ctx, "5432")
	if err != nil {
		_ = container.Terminate(ctx)
		return nil, config.DBConfig{}, err
	}

	cfg := config.DBConfig{
		Host:            host,
		Port:            port.Int(),
		User:            "wargame",
		Password:        "wargame",
		Name:            "wargame_test",
		SSLMode:         "disable",
		MaxOpenConns:    5,
		MaxIdleConns:    5,
		ConnMaxLifetime: 2 * time.Minute,
	}

	return container, cfg, nil
}
```

여기서 코드를 살펴보면 특이한 코드를 발견해볼 수 있다.

```go
WaitingFor: wait.ForAll(
	wait.ForListeningPort("5432/tcp"),
	wait.ForLog("database system is ready to accept connections"),
),
```

이는 2가지 과정을 거쳐야 해당 컨테이너가 정상적으로 사용할 수 있다는 것을 의미하며, 각 과정은 아래와 같다.

1. TCP 5432(PostgreSQL) 포트가 정상적으로 열려있는가. (TCP 리스닝이 잘 되는가)
2. 컨테이너 내에 `database system is ready to accept connections` 로그가 찍혔는가.

두번째의 경우 PostgreSQL 컨테이너가 실행 후 DB 초기화(initdb), 설정 적용, WAL 등의 과정이 생각보다 오래걸려, 테스트 코드가 정상적으로 처리되지 않을 수 있으니 해당 로그가 발생할때 까지 대기하는 것이다. 해당 로그는 모든 준비가 끝나 비로소 커넥션이 가능해질때 출력된다.

그리고 필자는 아래와 같이 `startPostgres` 함수를 사용한다. 

```go
package db

import (
	"context"
	"os"
	"testing"

	"wargame/internal/config"

	"github.com/testcontainers/testcontainers-go"
	"github.com/uptrace/bun"
)

var (
	testDB            *bun.DB
	testCfg           config.DBConfig
	pgContainer       testcontainers.Container
	skipDBIntegration bool
)

func TestMain(m *testing.M) {
	skipDBIntegration = os.Getenv("WARGAME_SKIP_INTEGRATION") != ""
	if skipDBIntegration {
		os.Exit(m.Run())
	}

	ctx := context.Background()
	container, dbCfg, err := startPostgres(ctx)
	if err != nil {
		panic(err)
	}

	pgContainer = container
	testCfg = dbCfg

	testDB, err = New(dbCfg, "test")
	if err != nil {
		panic(err)
	}

	code := m.Run()

	if testDB != nil {
		_ = testDB.Close()
	}

	if pgContainer != nil {
		_ = pgContainer.Terminate(ctx)
	}

	os.Exit(code)
}
```

```go
package db

import (
	"database/sql"
	"fmt"

	"wargame/internal/config"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
	"github.com/uptrace/bun/extra/bundebug"
)

func New(cfg config.DBConfig, appEnv string) (*bun.DB, error) {
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s", cfg.User, cfg.Password, cfg.Host, cfg.Port, cfg.Name, cfg.SSLMode)
	connector := pgdriver.NewConnector(pgdriver.WithDSN(dsn))

	sqldb := sql.OpenDB(connector)
	sqldb.SetMaxOpenConns(cfg.MaxOpenConns)
	sqldb.SetMaxIdleConns(cfg.MaxIdleConns)
	sqldb.SetConnMaxLifetime(cfg.ConnMaxLifetime)

	db := bun.NewDB(sqldb, pgdialect.New())
	if appEnv != "production" {
		db.AddQueryHook(bundebug.NewQueryHook(bundebug.WithVerbose(false)))
	}

	return db, nil
}
```

해당 코드에 대해 더 자세히 확인하려면 아래의 Github 레포지토리를 참고하면 된다.

- https://github.com/nullforu/wargame/blob/main/internal/http/handlers/testenv_test.go
- https://github.com/nullforu/wargame/blob/main/internal/repo/testenv_test.go
- https://github.com/nullforu/wargame/blob/main/internal/service/testenv_test.go

소스코드에 대해선 자세히 설명하지 않겠다. 

# 3. Conclusion 

![](https://mirror-cdn.swua.kr/images/development/2026-04-21-development-remote-docker/41cce23b-5eec-48b8-b4a1-f54da9f11f92.png)

결론적으로 위 화면과 같이 로컬(노트북)에서 Docker를 굴리지 않고도 Cloudflare ZTNA Tunnel + WARP으로 원활한, 안전한 Remote Docker 환경을 만들 수 있었다. `DOCKER_HOST` 환경 변수만 적절하게 구성하면 되고 필요시 `unset`으로 로컬 Docker Daemon을 사용할 수도 있으니 꽤나 유용할 것이다.

Testcontainers 관련 코드를 수정하지 않았기 때문에 Github Actions CI 환경에서도 문제 없이 돌아가는 것을 볼 수 있다.

![](https://mirror-cdn.swua.kr/images/development/2026-04-21-development-remote-docker/dcbc0ce5-8f91-4555-abc6-b9588ba4c9f3.png)

_무엇보다 더이상 ARM 환경에서 x86-64 환경을 시뮬레이션하기 위해 HyperKit, Qemu 등을 사용하지 않아도 된다는 것이 가장 큰 장점이지 않을까 싶다..._

## Small TMI

오늘은 저에게 있어 기념적인 날입니다. 물론 정보통신의 날과 지구의 날, 새마을의 날이기도 하지만, 제가 이 세상에 발을 디딘 날이기도 합니다. 그 날로 부터 18번째 해를 보냈네요.

제가 특별한 날을 특별하게 챙기는 사람은 아닙니다만, 누군가가 탄생한 날 만큼은 특별하게 챙겨주는 성격을 가지고 있습니다.

조금은 역설적이게도 저는 누군가에게 물질적인 것을 받는걸 좋아하지 않아 생일을 조용하게 보내곤 합니다. 그저 누군가가 기억해주고, 안부 인사만 보내주어도 저로썬 크나큰 선물이지 싶습니다.

![](https://mirror-cdn.swua.kr/images/development/2026-04-21-development-remote-docker/8b85a132-5e53-4297-bf2e-4e8f43e593db.jpg)

이 글을 읽어주시는 분들 또한 늘 감사 인사를 드립니다. 감사합니다.