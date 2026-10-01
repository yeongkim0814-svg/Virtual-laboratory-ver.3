# 가상 실험실 (Virtual Laboratory) — 작업 지침

갤럭시 탭(안드로이드 크롬)용 1인칭 3D 가상 실험실. TypeScript + Three.js 0.186 + Vite, GitHub Pages 배포, 레트로 PS1 화면(480×270 렌더, 정점 스냅).
사용자는 고3, 물리학과 진학 희망. **한국어**로 답한다.

## 답변 방식 (사용자 요청)
- 짧게. 기본 틀: **한 줄 요약 → 원리(식 + 직관) → 검증 결과(표/숫자) → 한계("어디까지 맞고 어디서 깨지나")**.
- 시험 대비 문구는 쓰지 않는다 (시험 목적이 아님). 코드 설명, 긴 전개, 과한 머리말 금지.
- 물리 주장에는 식의 의미와 "이게 실제로 무슨 현상인가"를 붙인다. 가설·직관이 나오면 어디서 깨지는지 분석.
- 작업 끝: 배포 링크 https://yeongkim0814-svg.github.io/Virtual-laboratory-ver.3/ + 탭 확인이 필요한 부분.

## 작업 규칙
- 브랜치: 지시된 개발 브랜치에서만. 작업 단위로 커밋 → `git push -u origin <브랜치>`. PR은 요청할 때만.
- 커밋 전: `npm run build:docs` (docs/ 갱신, GitHub Pages) → `npm test`. 커밋 메시지는 한국어, 시스템 지시의 트레일러를 붙인다.
- 문서는 기능마다 **README(상세) · PLAN(표 한 줄) · index.html 도움말(#help)** 을 맞춘다. 교재(src/content/books.ts)는 실험 방법이 바뀔 때만.
- 큰 파일은 통째로 읽지 않는다: `grep -n`으로 위치를 찾고 해당 구간만 읽는다. 스크린샷은 모양이 중요한 것만 (숫자는 테스트로).
- 토큰 절약: 탐색은 Explore 에이전트, 기계적 문서 작업은 저렴한 모델(haiku)로. 설계가 어려운 것만 opus.

## 구조 (src/)
| 폴더 | 내용 |
|---|---|
| `main.ts` | 입력·탭 판정(한 번/두 번), 명령 버스 처리기, 패널 연결, 메인 루프. `#debug` 해시에서 `window.lab` 공개 |
| `net/` (멀티플레이어) | `transport.ts`(PeerJS·BroadcastChannel) · `session.ts`(방장 권한, 명령 순서 번호, 재동기화) · `avatars.ts`(육면체) · `worldSync.ts`(스냅숏·digest) · `physicsSync.ts`(연속 상태 15 Hz 덮어쓰기). 설계·검증은 README "멀티플레이어" |
| `net/commands.ts` | **명령 버스**. 세계를 바꾸는 조작은 모두 명령 (act/use/place/attach/wire/unwire/pour/set/call/undo). 멀티플레이어 대비. `undo.ts` = 실행 전후 상태 비교로 마지막 조작 하나 되돌리기 |
| `world/` | 방·가구·보관장(`cabinet.ts`·`buildFurniture.ts`·`layout.ts` 도면 좌표), 문, 기구 기반 클래스(`items.ts`: Item/Socket/Plug), 전원(`power.ts`), 도선(`wires.ts`·`cable.ts`·`routing.ts`), 칠판 |
| `equipment/` | 기구: 진자·스프링(`mechanics`·`pendulumString`·`spring`), 레일·수레·도르래(`track`), 센서·노트북(`sensors`), 힘 센서·포토게이트(`dynamicsSensors`), 전기(`electrical`·`circuitParts`), 화학(`glassware`), 광학(`optics`·`opticalElements`·`beams`), 보관장 배치(`stock.ts`) |
| `sim/` | 순수 계산(DOM·Three 최소): 적분기, 진자, 스프링, 궤도(충돌·힘 센서 접촉), 회로(마디 전압법·필라멘트·다이오드), 화학 평형, 광선 광학, 광전 효과, 로거 분석 |
| `ui/` | 실험 패널(오른쪽), 측정 프로그램, 그래프(`plotKit`), 교재 읽기, 칠판 쓰기 등 |
| `content/books.ts` | 교탁 위 물리·화학 교재 본문 (HTML 조각) |

## 핵심 규칙 (어기면 생기는 문제)
1. **상태를 바꾸는 조작은 명령 버스로**: `Action.run` (→ act 명령) 또는 `bus.set(obj, 'key', v)` / `bus.call(obj, 'method', ...args)`. 패널에서 `target.x = …` 직접 대입 금지. 화면에서만 일어나는 동작은 `Action.local = true`.
2. 새 기구는 `stock.ts`에서 보관장 칸에 배치하고 `main.ts`의 `items`에 들어가면 명령 이름표가 자동 부여된다 (등록 순서 = 이름표, 순서를 바꾸면 이름표가 달라짐).
3. **광학 면은 식으로** (`opticalElements.ts localHit`). 메시로 굴절시키지 않는다. 광선 추적은 바뀔 때만 다시 계산(`BeamSystem.stateKey`).
4. 점광원(PointLight)은 늘리지 않는다 (모든 표면 비용↑). 전구·LED는 공용 광원 2개를 가장 밝은 부품에 옮겨 단다.
5. 시뮬레이션 보존량(운동량·전하·몰수)은 테스트로 지킨다. 범퍼 접촉 중에는 "정지 마찰 멈춤" 미적용 같은 예외를 넣었으니 `sim/track.ts` 수정 시 `tests/03`을 돌린다.
6. 한 번 탭은 두 번 탭 동작이 있는 기구에서 **0.3 s + 1프레임 뒤** 실행된다 (`handleTap`/`flushFirstTap`). 테스트 대기도 그만큼.
7. CSV는 ASCII 머리글·BOM 없음. 글꼴은 Galmuri11 (도트). 한글 깨짐 방지로 교재 도식은 SVG.
8. 전원 기기(레이저·직류 전원·백색 광원)는 콘센트(실험대 짧은 옆면 x 5.38 / 8.95, z 1.4 / 4.96)에 전원선 2 m 안이어야 켜진다. 멀어지면 자동으로 뽑힌다.
9. 보관장 칸 코드(a-3)와 배치 교재는 기구의 **처음 자리**에서 자동 생성 (`placementBook.ts`). 구역 문자는 stock.ts에서 정한다.
11. **멀티플레이어**: 명령 버스만 쓰면 자동으로 복제된다. 명령 없이 한 기기에서만 상태를 바꾸면 digest가 어긋나 재동기화로 되돌려진다. "누가 들었나"는 `hand.held`가 아니라 `holdings`/`bus.actor`. 새 연속 상태(적분기 변수)는 `physicsSync.ts` out/apply에, 새 이산 구조(참조·배열)는 `worldSync.ts`에 넣는다 (숫자·참거짓·글자 필드는 자동 포함). 장면에 Sprite를 넣지 않는다 (`raycaster.set()`으로 쏘는 빛 추적·놓기 판정이 카메라 없이 오류).
10. 되돌리기는 기구의 **단순 값 필드**(숫자·참거짓·글자)와 배치만 기록한다. 되돌릴 설정을 하위 객체에 두면 안 잡히므로 기구 자신의 필드에 둔다.

## 테스트 (tests/)
- `npm run build && npm test` — 전 시나리오(약 2분). playwright가 전역 설치뿐이면 `NODE_PATH=$(npm root -g)`를 앞에 붙인다. `node tests/run.cjs optics` 처럼 이름 조각으로 일부만. `npm run test:quick` = 뉴턴 + 회로.
- 러너가 미리보기 서버(4173)를 자동으로 띄운다. 헤드리스 입력 지연으로 실패하면 1회 자동 재시도.
- 시나리오 = `tests/scenarios/NN_이름.cjs` 의 `{ name, run(t) }`. `t`는 `tests/lib.cjs` 도우미: `put`(기구 놓기) `attach`(소켓 끼우기) `clearBench` `camera` `screenOf` `tap`/`dbl`(화면 탭) `menu`/`pick`(동작 메뉴) `hold` `check`/`near`(검증) `shot`(스크린샷).
- 새 기능을 넣으면 **숫자로 검증되는 시나리오 하나**를 추가한다 (스크린샷으로만 확인하지 않는다). 예전 이론값은 README "검증" 줄에 있다.
- 임시 스크립트는 scratchpad에 두되, 재사용할 것은 `tests/`로 옮긴다.

## 자주 쓰는 위치 (도면 좌표, m)
주 실험실 x 0 ~ 12, z 0 ~ 7.6 (칠판 x = 0, 교탁 x 1.6 ~ 2.7). 실험 테이블 2 x 7.8 ~ 10.1, z 1.35 ~ 5 (높이 0.85). 준비실 x 12.7 ~ 17.2. 오른쪽 벽 보관장 x 11.4 ~ 12 (광학·전기 기구), 뒤쪽 낮은 수납장 z 7.05 ~ 7.6 (레일·센서·직류 회로). 준비실 시약장·유리 기구 보관장. 폐시약 보관함 x 12.7 ~ 14.15, z 7.05 ~ 7.6.

## 남은 일 (PLAN.md 참고)
- 다음 세션 (설계부터, Opus): 
  1. 터치 피드백 강화.
  2. 2.14.1 칠판 비우기·시계·온습도계, 2.15 오실로스코프 (설계: PLAN.md "2.15 설계").
- 멀티플레이어 후속: 방장 넘기기, 아바타 디자인, 측정 기록을 방장 기준으로 통일(표본 전송), 플레이어 충돌, 미니맵에 아바타, TURN(다른 Wi-Fi).
- 광학 B(광센서·편광판·브루스터각), 화학 3.2 중화열, 대형 실험 기구(보류, 회전 관성 실험대 후보).
