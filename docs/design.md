# AI 튜터 시스템 아키텍처 설계서

## 1. 개요

초등 저학년(1-3학년) 아이를 위한 AI 학습 튜터 시스템.
Claude Code CLI를 백엔드로 활용하여 Max 요금제 사용량 내에서 추가 비용 없이 운영한다.
대화 히스토리는 마크다운(.md) 파일로 저장하여 학습 이력을 추적한다.

---

## 2. 핵심 설계 결정: CLI vs Agent SDK

### ⚠️ 중요한 차이

| 항목 | Claude Code CLI (`claude -p`) | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) |
|---|---|---|
| **인증** | claude.ai OAuth 로그인 (Max 요금제) | `ANTHROPIC_API_KEY` (별도 API 과금) |
| **비용** | Max 구독 내 포함 | 토큰 사용량별 별도 과금 |
| **연동 방식** | subprocess spawn | 네이티브 Node.js 함수 호출 |
| **스트리밍** | `--output-format stream-json` | AsyncGenerator 네이티브 스트리밍 |
| **세션 관리** | `--continue` / `--resume <session-id>` | 프로그래밍 방식 세션 관리 |
| **안정성** | TTY 이슈 가능 (알려진 버그들 존재) | 안정적 |

### 결론

**CLI 방식 채택** — Max 요금제 활용이 핵심 목적이므로 `claude -p` 모드를 사용한다.
Agent SDK는 API 키가 필요하여 별도 과금이 발생한다.

> **참고**: Anthropic 정책상 제3자가 claude.ai 로그인/사용량을 상업적으로 제공하는 것은 금지되어 있으나,
> 본 시스템은 가정 내 개인 사용 목적이므로 정책 위반에 해당하지 않을 것으로 판단된다.
> 다만, 공식적으로 보장된 사용 방식은 아닌 점을 인지해야 한다.

---

## 3. 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                    Client (브라우저)                      │
│  ┌───────────────────────────────────────────────────┐  │
│  │              Web Chat UI (React)                   │  │
│  │  - 과목 선택 (수학/과학/영어/국어)                     │  │
│  │  - 채팅 인터페이스 (큰 글씨, 아이 친화적 UI)           │  │
│  │  - 히스토리 조회                                     │  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │ HTTP/WebSocket                 │
└─────────────────────────┼───────────────────────────────┘
                          │
    ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
    VPN (WireGuard) 또는 Cloudflare Tunnel
    ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
                          │
┌─────────────────────────┼───────────────────────────────┐
│                    홈 서버 (Linux)                        │
│                         │                                │
│  ┌──────────────────────▼────────────────────────────┐  │
│  │           Node.js Backend (Express/Fastify)        │  │
│  │                                                    │  │
│  │  ┌──────────────┐  ┌───────────────────────────┐  │  │
│  │  │ API Router   │  │ Session Manager           │  │  │
│  │  │ /chat        │  │ - 세션 ID ↔ 과목 매핑       │  │  │
│  │  │ /history     │  │ - 동시 요청 큐잉            │  │  │
│  │  │ /subjects    │  │ - 타임아웃 관리              │  │  │
│  │  └──────┬───────┘  └───────────────────────────┘  │  │
│  │         │                                          │  │
│  │  ┌──────▼──────────────────────────────────────┐  │  │
│  │  │         Claude Code Bridge                   │  │  │
│  │  │                                              │  │  │
│  │  │  child_process.spawn('claude', [             │  │  │
│  │  │    '-p',                                     │  │  │
│  │  │    '--output-format', 'stream-json',         │  │  │
│  │  │    '--system-prompt', tutorPrompt,           │  │  │
│  │  │    '--resume', sessionId,     // 세션 유지    │  │  │
│  │  │    '--model', 'sonnet',       // 비용 효율    │  │  │
│  │  │    '--allowedTools', 'none',  // 도구 차단    │  │  │
│  │  │  ])                                          │  │  │
│  │  │                                              │  │  │
│  │  │  stdin ← user message                        │  │  │
│  │  │  stdout → stream-json → WebSocket → client   │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│                         │                                │
│  ┌──────────────────────▼────────────────────────────┐  │
│  │              File System (히스토리)                  │  │
│  │                                                    │  │
│  │  ~/tutor-history/                                  │  │
│  │  ├── 2026-02-05/                                   │  │
│  │  │   ├── 0930_수학_덧셈뺄셈.md                      │  │
│  │  │   ├── 1015_영어_알파벳.md                        │  │
│  │  │   └── 1400_과학_식물관찰.md                      │  │
│  │  ├── 2026-02-06/                                   │  │
│  │  │   └── ...                                       │  │
│  │  └── _sessions/                                    │  │
│  │      └── session-map.json  (sessionId ↔ md 매핑)   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## 4. 컴포넌트 상세

### 4.1 Claude Code Bridge (핵심 모듈)

CLI 프로세스를 관리하는 레이어. 핵심 동작:

```
[새 대화 시작]
claude -p \
  --output-format stream-json \
  --system-prompt "$(cat prompts/math-tutor.md)" \
  --model sonnet \
  --verbose \
  "3+5는 어떻게 풀어?"

[대화 이어가기]
claude -p \
  --output-format stream-json \
  --resume <session-id> \
  --continue \
  "그러면 10+7은?"
```

**주요 고려사항:**

- **동시성 제한**: Claude Code CLI는 동일 계정에서 동시 세션에 제한이 있을 수 있음.
  → 요청 큐를 두어 순차 처리 (아이 1명이 쓰는 용도이므로 문제 없음)
- **TTY 이슈**: `-p` 모드에서 subprocess 호출 시 TTY 관련 버그가 보고된 바 있음.
  → `script -q /dev/null claude -p ...` 래퍼 또는 PTY 에뮬레이션으로 우회
- **타임아웃**: 응답이 60초 이상 걸리면 프로세스 kill 후 재시도
- **도구 차단**: `--allowedTools` 빈값 또는 `--disallowedTools`로 Bash, Write 등 위험 도구 비활성화

### 4.2 시스템 프롬프트 설계

과목별 프롬프트를 별도 파일로 관리:

```
prompts/
├── base-tutor.md          # 공통 페르소나 (어투, 난이도, 안전장치)
├── math-tutor.md           # 수학 전용
├── science-tutor.md        # 과학 전용
├── english-tutor.md        # 영어 전용
└── korean-tutor.md         # 국어 전용
```

**공통 프롬프트 핵심 요소 (base-tutor.md):**

```markdown
당신은 초등학교 저학년(1~3학년) 아이의 학습 도우미입니다.

## 기본 원칙
- 항상 한국어로 대답합니다 (영어 과목 제외)
- 쉽고 친근한 말투를 사용합니다 ("~해볼까?", "잘했어!", "대단한데?")
- 답을 바로 알려주지 말고, 힌트를 주면서 아이가 스스로 생각하도록 유도합니다
- 한 번에 너무 많은 내용을 설명하지 않습니다
- 틀려도 격려합니다 ("아깝다! 거의 맞았어!")
- 이모지를 적절히 사용합니다 🎉✨📚

## 안전 장치
- 학습과 무관한 주제로 대화가 넘어가면 부드럽게 학습으로 돌아옵니다
- 부적절한 콘텐츠 요청은 거절합니다
- 개인정보를 묻지 않습니다

## 응답 형식
- 짧고 간결하게 (3-5문장 이내)
- 필요하면 예시를 들어줍니다
- 어려운 한자어는 쉬운 말로 풀어줍니다
```

### 4.3 히스토리 저장 형식

각 대화는 마크다운 파일로 저장:

```markdown
# 수학 - 덧셈과 뺄셈
- 날짜: 2026-02-05 09:30
- 과목: 수학
- 세션ID: abc-123-def
- 모델: sonnet

---

## 👧 아이
3 더하기 5는 뭐야?

## 🤖 튜터
3 더하기 5를 같이 풀어볼까? 🤔
손가락으로 세어보자! 먼저 3개를 펴고, 거기에 5개를 더 펴면 몇 개가 될까?

## 👧 아이
8!

## 🤖 튜터
정답이야! 🎉 대단해!
3 + 5 = 8 맞아! 손가락으로 셀 수 있었구나.
그러면 이번엔 좀 더 큰 숫자로 해볼까? 7 + 4는 얼마일까? 😊
```

### 4.4 Node.js 백엔드 구조

```
tutor-server/
├── package.json
├── src/
│   ├── index.ts                 # Express 서버 진입점
│   ├── routes/
│   │   ├── chat.ts              # POST /api/chat (WebSocket 업그레이드)
│   │   ├── history.ts           # GET /api/history/:date
│   │   └── subjects.ts          # GET /api/subjects
│   ├── services/
│   │   ├── claude-bridge.ts     # Claude CLI subprocess 관리
│   │   ├── session-manager.ts   # 세션 생명주기 관리
│   │   └── history-writer.ts    # .md 파일 읽기/쓰기
│   ├── prompts/
│   │   ├── base-tutor.md
│   │   ├── math-tutor.md
│   │   ├── science-tutor.md
│   │   ├── english-tutor.md
│   │   └── korean-tutor.md
│   └── types/
│       └── index.ts
├── public/                      # 정적 프론트엔드 파일
│   ├── index.html
│   ├── app.js
│   └── style.css
├── Dockerfile
└── docker-compose.yml
```

### 4.5 프론트엔드 (아이 친화적 UI)

아이가 직접 쓰는 인터페이스이므로 **단순하고 직관적**이어야 함:

```
┌─────────────────────────────────────────┐
│  🎓 AI 선생님                    [히스토리]│
├─────────────────────────────────────────┤
│                                         │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │
│  │ 📐  │ │ 🔬  │ │ 🔤  │ │ 📖  │      │
│  │수학  │ │과학  │ │영어  │ │국어  │      │
│  └─────┘ └─────┘ └─────┘ └─────┘      │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │                                 │    │
│  │  🤖 안녕! 오늘은 무엇을          │    │
│  │     공부해볼까? 😊               │    │
│  │                                 │    │
│  │  👧 3 더하기 5는 뭐야?           │    │
│  │                                 │    │
│  │  🤖 같이 풀어볼까? 🤔            │    │
│  │     손가락으로 세어보자!          │    │
│  │                                 │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────┐ ┌──────┐  │
│  │ 여기에 질문을 써봐! 📝   │ │ 보내기│  │
│  └─────────────────────────┘ └──────┘  │
└─────────────────────────────────────────┘
```

**UI 요구사항:**
- 글씨 크기: 기본 18-20px (저학년 눈높이)
- 큰 버튼, 넉넉한 터치 영역 (태블릿 고려)
- 과목별 색상 구분 (수학=파랑, 과학=초록, 영어=빨강, 국어=보라)
- 로딩 중 귀여운 애니메이션 ("선생님이 생각하고 있어요...")
- 다크모드 불필요 (밝은 테마 고정)

---

## 5. 데이터 플로우

### 5.1 새 대화 시작

```
1. 아이가 과목 선택 (수학)
2. 아이가 메시지 입력 ("3+5는?")
3. Client → WebSocket → Server
4. Server: 시스템 프롬프트 로드 (base-tutor.md + math-tutor.md)
5. Server: claude -p --system-prompt <prompt> --output-format stream-json
6. Server: stdin으로 아이 메시지 전달
7. Claude stdout → stream-json 파싱 → WebSocket → Client (실시간)
8. 응답 완료 시: session-id 기록 + .md 파일 생성
```

### 5.2 대화 이어가기

```
1. 아이가 같은 세션에서 추가 질문 ("그러면 10+7은?")
2. Client → WebSocket → Server
3. Server: claude -p --resume <session-id> --continue
4. Server: stdin으로 추가 질문 전달
5. Claude stdout → stream-json → WebSocket → Client
6. .md 파일에 대화 내용 append
```

---

## 6. 배포

### Docker Compose

```yaml
version: '3.8'
services:
  tutor:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./history:/app/history          # 히스토리 영속화
      - ./prompts:/app/prompts          # 프롬프트 수정 용이
      - ~/.claude:/root/.claude:ro      # Claude Code 인증 정보
    environment:
      - NODE_ENV=production
    restart: unless-stopped
```

### 네트워크 접근

- **내부**: `http://서버IP:3000` (LAN 내 직접 접근)
- **외부**: WireGuard VPN 경유 또는 Cloudflare Tunnel
  - 기존 WireGuard 인프라가 있다면 추가 포트 포워딩만으로 가능

---

## 7. 리스크 및 완화 방안

| 리스크 | 심각도 | 완화 방안 |
|---|---|---|
| Claude Code CLI `-p` 모드 TTY 버그 | 중 | `script` 래퍼 또는 PTY 에뮬레이션 (`node-pty`) |
| Max 요금제 사용량 소진 | 중 | 일일 사용량 제한 (예: 50회/일), Sonnet 모델 사용 |
| CLI 응답 지연/행 | 중 | 60초 타임아웃 + kill + 재시도 로직 |
| Claude Code 버전 업데이트로 CLI 동작 변경 | 중 | 특정 버전 고정 또는 업데이트 전 테스트 |
| 아이가 학습 외 주제로 대화 시도 | 저 | 시스템 프롬프트에서 가드레일 설정 |
| Docker 내 Claude Code 인증 만료 | 중 | 호스트의 `~/.claude` 마운트 + 주기적 갱신 확인 |
| `--resume` 세션 ID 만료/유실 | 저 | 세션 만료 시 새 세션으로 자동 전환, 히스토리는 md에 보존 |

---

## 8. 향후 확장 가능성

- **학습 리포트**: 주간/월간 .md 파일 분석하여 학습 진도 리포트 생성
- **음성 입력**: Web Speech API로 음성→텍스트 변환 (저학년 타이핑 부담 감소)
- **TTS 출력**: 튜터 응답을 음성으로 읽어주기
- **학부모 대시보드**: 학습 이력 조회, 과목별 통계
- **Agent SDK 전환**: 추후 API 비용이 수용 가능하면 SDK 방식으로 안정성 향상

---

## 9. 구현 우선순위

### Phase 1 — MVP (1-2일)
- [ ] Claude Code Bridge (subprocess spawn + stream-json 파싱)
- [ ] 기본 Express 서버 + WebSocket
- [ ] 최소 채팅 UI (HTML/CSS/JS, 프레임워크 없이)
- [ ] 수학 튜터 프롬프트 1개

### Phase 2 — 기능 완성 (3-5일)
- [ ] 과목별 프롬프트 (4과목)
- [ ] 히스토리 .md 저장/조회
- [ ] 세션 관리 (`--resume`)
- [ ] 일일 사용량 제한

### Phase 3 — 안정화 (1주)
- [ ] Docker 패키징
- [ ] TTY 이슈 우회 적용
- [ ] 에러 핸들링/재시도 로직
- [ ] 기본 학부모 조회 페이지

### Phase 4 — 개선 (선택)
- [ ] React 프론트엔드 전환
- [ ] 음성 입력/출력
- [ ] 학습 리포트 자동 생성
